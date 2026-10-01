'use strict';

/**
 * RSS → news sync for organizations with rss_feed_url set.
 * Dedupes on organization_id + source_url (item <link>).
 */

const USER_AGENT = 'HolwertDorpsappRSS/1.0 (+https://holwert.appenvloed.com)';
const FETCH_TIMEOUT_MS = 15000;
const NEWS_CATEGORY = 'dorpsnieuws';
/** Only push for brand-new items published within this window (avoids spam on first sync). */
const PUSH_MAX_AGE_MS = 48 * 60 * 60 * 1000;

function decodeXmlEntities(input) {
  if (input == null) return '';
  let s = String(input);
  s = s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1');
  s = s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => {
      const code = parseInt(n, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => {
      const code = parseInt(h, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : _;
    })
    .replace(/&amp;/g, '&');
  return s;
}

function stripTags(html) {
  return String(html || '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function resolveUrl(maybeRelative, baseUrl) {
  const raw = String(maybeRelative || '').trim();
  if (!raw) return null;
  try {
    return new URL(raw, baseUrl || undefined).href;
  } catch {
    return raw.startsWith('http') ? raw : null;
  }
}

function absolutizeHtmlUrls(html, baseUrl) {
  if (!html || !baseUrl) return html || '';
  return String(html).replace(
    /\b(src|href)=(["'])([^"']+)\2/gi,
    (match, attr, quote, url) => {
      const abs = resolveUrl(url, baseUrl);
      return abs ? `${attr}=${quote}${abs}${quote}` : match;
    },
  );
}

/** Drupal/gemeente-HTML opschonen tot leesbare paragrafen, koppen en afbeeldingen. */
function cleanRssHtml(html, baseUrl) {
  let s = String(html || '');
  if (!s.trim()) return '';

  s = absolutizeHtmlUrls(s, baseUrl);

  // Verwijder scripts/styles en verborgen koppen
  s = s.replace(/<script[\s\S]*?<\/script>/gi, '');
  s = s.replace(/<style[\s\S]*?<\/style>/gi, '');
  s = s.replace(/<h[1-6][^>]*class="[^"]*visually-hidden[^"]*"[^>]*>[\s\S]*?<\/h[1-6]>/gi, '');

  // <picture>…<img>… → alleen img
  s = s.replace(/<picture\b[^>]*>([\s\S]*?)<\/picture>/gi, (_, inner) => {
    const img = inner.match(/<img\b[^>]*>/i);
    return img ? img[0] : '';
  });

  // Colorbox-links: behoud img (cover zit al in enclosure; body-foto's blijven zichtbaar)
  s = s.replace(/<a\b[^>]*class="[^"]*colorbox[^"]*"[^>]*>([\s\S]*?)<\/a>/gi, (_, inner) => {
    const img = inner.match(/<img\b[^>]*>/i);
    return img ? img[0] : '';
  });

  // Span-wrappers eraf
  for (let i = 0; i < 4; i += 1) {
    s = s.replace(/<\/?span\b[^>]*>/gi, '');
  }

  // Losse komma's/whitespace tussen blokken (komt voor in deze feed)
  s = s.replace(/>\s*,\s*</g, '><');

  // Img: alleen src + alt bewaren, absolute URL
  s = s.replace(/<img\b([^>]*)\/?>/gi, (full, attrs) => {
    const srcM = attrs.match(/\bsrc=["']([^"']+)["']/i);
    if (!srcM) return '';
    const src = resolveUrl(srcM[1], baseUrl) || srcM[1];
    // Gallery thumbs overslaan als enclosure de cover is — kleine thumbs houden we wel
    const altM = attrs.match(/\balt=["']([^"']*)["']/i);
    const alt = altM ? altM[1].replace(/"/g, '&quot;') : '';
    return `<p><img src="${src}" alt="${alt}" loading="lazy"></p>`;
  });

  // Toegestane block-tags: unwrap overige divs naar hun inhoud
  for (let i = 0; i < 8; i += 1) {
    s = s.replace(/<div\b[^>]*>([\s\S]*?)<\/div>/gi, '$1');
  }

  // Lege paragrafen / nbsp
  s = s.replace(/<p\b[^>]*>\s*(?:&nbsp;|\u00a0|\s)*<\/p>/gi, '');
  s = s.replace(/<p\b[^>]*>\s*<br\s*\/?>\s*<\/p>/gi, '');

  // Heading/paragraph: strip class/style/id
  s = s.replace(/<(p|h[1-6]|ul|ol|li|blockquote|strong|em|br)\b([^>]*)>/gi, (_, tag, attrs) => {
    if (tag.toLowerCase() === 'br') return '<br>';
    const href = attrs && attrs.match(/\bhref=["'][^"']+["']/i);
    return href ? `<${tag} ${href[0]}>` : `<${tag}>`;
  });

  // Ankers: alleen href
  s = s.replace(/<a\b([^>]*)>/gi, (_, attrs) => {
    const hrefM = attrs.match(/\bhref=["']([^"']+)["']/i);
    if (!hrefM) return '<a>';
    const href = resolveUrl(hrefM[1], baseUrl) || hrefM[1];
    return `<a href="${href}">`;
  });

  // Compact: geen newlines tussen tags (oude app-builds zetten \n om naar <br />)
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/[ \t]+\n/g, '\n');
  s = s.replace(/\n{3,}/g, '\n\n');
  s = s.replace(/\s{2,}/g, ' ');
  s = s.replace(/>\s+</g, '><');
  s = s.trim();

  // Als er alleen lege rommel overblijft
  if (!stripTags(s)) return '';

  return s;
}

function extractTag(block, tagName) {
  const re = new RegExp(
    `<${tagName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tagName}>`,
    'i',
  );
  const m = block.match(re);
  if (!m) return null;
  return decodeXmlEntities(m[1].trim());
}

function extractEnclosureImage(block) {
  const re = /<enclosure\b([^>]*?)\/?>/gi;
  let match;
  while ((match = re.exec(block))) {
    const attrs = match[1] || '';
    const typeM = attrs.match(/\btype=["']([^"']+)["']/i);
    const urlM = attrs.match(/\burl=["']([^"']+)["']/i);
    const type = (typeM && typeM[1]) || '';
    const url = urlM && urlM[1];
    if (url && (!type || /^image\//i.test(type))) {
      return decodeXmlEntities(url.trim());
    }
  }
  return null;
}

function parseRssItems(xml) {
  const baseMatch =
    xml.match(/\bxml:base=["']([^"']+)["']/i) ||
    xml.match(/<link>([^<]+)<\/link>/i);
  const baseUrl = baseMatch ? decodeXmlEntities(baseMatch[1].trim()) : null;
  const channelTitle = extractTag(xml, 'title');

  const items = [];
  const itemRe = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let m;
  while ((m = itemRe.exec(xml))) {
    const block = m[1];
    const title = extractTag(block, 'title');
    const link = extractTag(block, 'link');
    if (!title || !link) continue;

    let contentEncoded = null;
    const ce = block.match(
      /<content:encoded\b[^>]*>([\s\S]*?)<\/content:encoded>/i,
    );
    if (ce) contentEncoded = decodeXmlEntities(ce[1].trim());

    const description = extractTag(block, 'description');
    const pubDate = extractTag(block, 'pubDate');
    const guid = extractTag(block, 'guid');
    const enclosure = extractEnclosureImage(block);

    const rawHtml = contentEncoded || description || '';
    const html = cleanRssHtml(rawHtml, baseUrl || link);
    const imageUrl = resolveUrl(enclosure, baseUrl || link);

    items.push({
      title: title.trim(),
      link: resolveUrl(link, baseUrl) || link.trim(),
      guid: guid ? String(guid).trim() : null,
      pubDate: pubDate || null,
      imageUrl,
      html,
      excerpt: stripTags(description || html || '').slice(0, 280),
    });
  }

  return { baseUrl, channelTitle, items };
}

function toMysqlDateTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const s0 = String(value).trim();
  const t = Date.parse(s0);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return null;
}

function contentChanged(a, b) {
  const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim();
  return norm(a) !== norm(b);
}

async function fetchFeedXml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        Accept: 'application/rss+xml, application/xml, text/xml, */*',
        'User-Agent': USER_AGENT,
      },
    });
    if (!res.ok) {
      throw new Error(`Feed HTTP ${res.status}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function findAuthorId(executeQuery, orgId) {
  try {
    const r = await executeQuery(
      'SELECT id FROM users WHERE organization_id = ? ORDER BY id ASC LIMIT 1',
      [orgId],
    );
    return r.rows?.[0]?.id ?? null;
  } catch {
    return null;
  }
}

let _rssSuppressTableReady = false;

async function ensureRssSuppressedTable(executeQuery) {
  if (_rssSuppressTableReady) return;
  try {
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS rss_suppressed (
        id INT AUTO_INCREMENT PRIMARY KEY,
        organization_id INT NOT NULL,
        source_url VARCHAR(2000) NOT NULL,
        suppressed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uniq_rss_suppress_org_url (organization_id, source_url(500)),
        KEY idx_rss_suppress_org (organization_id)
      )
    `);
    _rssSuppressTableReady = true;
  } catch (e) {
    console.warn('[rss-sync] ensureRssSuppressedTable:', e.message);
  }
}

async function suppressRssSourceUrl(executeQuery, organizationId, sourceUrl) {
  const orgId = parseInt(organizationId, 10);
  const url = sourceUrl != null ? String(sourceUrl).trim() : '';
  if (!orgId || Number.isNaN(orgId) || !url) return false;
  await ensureRssSuppressedTable(executeQuery);
  try {
    await executeQuery(
      `INSERT INTO rss_suppressed (organization_id, source_url, suppressed_at)
       VALUES (?, ?, NOW())
       ON DUPLICATE KEY UPDATE suppressed_at = NOW()`,
      [orgId, url.slice(0, 2000)],
    );
    return true;
  } catch (e) {
    console.warn('[rss-sync] suppressRssSourceUrl:', e.message);
    return false;
  }
}

async function loadSuppressedUrls(executeQuery, orgId) {
  await ensureRssSuppressedTable(executeQuery);
  try {
    const r = await executeQuery(
      'SELECT source_url FROM rss_suppressed WHERE organization_id = ?',
      [orgId],
    );
    return new Set((r.rows || []).map((row) => String(row.source_url || '').trim()).filter(Boolean));
  } catch {
    return new Set();
  }
}

/**
 * @param {object} deps
 * @param {Function} deps.executeQuery
 * @param {Function} deps.executeInsert
 * @param {Function} [deps.ensureOrgColumns]
 * @param {Function} [deps.ensureNewsColumns]
 * @param {Function} [deps.invalidatePublicNewsCaches]
 * @param {Function} [deps.notifyFollowersOfNewsArticle]
 * @param {number|null} [deps.organizationId] — sync one org; otherwise all with feed URL
 */
async function runRssNewsSync(deps) {
  const {
    executeQuery,
    executeInsert,
    ensureOrgColumns,
    ensureNewsColumns,
    invalidatePublicNewsCaches,
    notifyFollowersOfNewsArticle,
    organizationId = null,
    logger = console,
  } = deps;

  if (typeof ensureOrgColumns === 'function') await ensureOrgColumns();
  if (typeof ensureNewsColumns === 'function') await ensureNewsColumns();
  await ensureRssSuppressedTable(executeQuery);

  let orgs;
  if (organizationId != null) {
    const r = await executeQuery(
      `SELECT id, name, rss_feed_url FROM organizations
       WHERE id = ? AND rss_feed_url IS NOT NULL AND TRIM(rss_feed_url) <> ''`,
      [organizationId],
    );
    orgs = r.rows || [];
  } else {
    const r = await executeQuery(
      `SELECT id, name, rss_feed_url FROM organizations
       WHERE rss_feed_url IS NOT NULL AND TRIM(rss_feed_url) <> ''`,
    );
    orgs = r.rows || [];
  }

  const summary = {
    orgs: orgs.length,
    created: 0,
    updated: 0,
    skipped: 0,
    suppressed: 0,
    errors: [],
    details: [],
  };

  for (const org of orgs) {
    const orgId = org.id;
    const feedUrl = String(org.rss_feed_url || '').trim();
    const sourceName = String(org.name || 'RSS').trim() || 'RSS';
    const detail = {
      organization_id: orgId,
      feed_url: feedUrl,
      created: 0,
      updated: 0,
      skipped: 0,
      suppressed: 0,
      error: null,
    };

    try {
      const xml = await fetchFeedXml(feedUrl);
      const { items } = parseRssItems(xml);
      const authorId = await findAuthorId(executeQuery, orgId);
      const suppressed = await loadSuppressedUrls(executeQuery, orgId);

      for (const item of items) {
        const sourceUrl = item.link;
        if (!sourceUrl) {
          detail.skipped += 1;
          summary.skipped += 1;
          continue;
        }

        if (suppressed.has(sourceUrl)) {
          detail.suppressed += 1;
          summary.suppressed += 1;
          continue;
        }

        const existing = await executeQuery(
          'SELECT id, title, content, image_url FROM news WHERE organization_id = ? AND source_url = ? LIMIT 1',
          [orgId, sourceUrl],
        );
        const pubAt = toMysqlDateTime(item.pubDate) || null;
        const title = item.title.slice(0, 500);
        const content = item.html || '';
        const imageUrl = item.imageUrl || null;

        if (existing.rows?.length) {
          const row = existing.rows[0];
          const needsUpdate =
            contentChanged(row.title, title) ||
            contentChanged(row.content, content) ||
            contentChanged(row.image_url, imageUrl);

          if (!needsUpdate) {
            detail.skipped += 1;
            summary.skipped += 1;
            continue;
          }

          if (pubAt) {
            await executeQuery(
              `UPDATE news SET title = ?, content = ?, excerpt = ?, image_url = ?, source_name = ?,
               category = ?, is_published = 1, published_at = ?, updated_at = NOW()
               WHERE id = ? AND organization_id = ?`,
              [title, content, item.excerpt || null, imageUrl, sourceName, NEWS_CATEGORY, pubAt, row.id, orgId],
            );
          } else {
            await executeQuery(
              `UPDATE news SET title = ?, content = ?, excerpt = ?, image_url = ?, source_name = ?,
               category = ?, is_published = 1, updated_at = NOW()
               WHERE id = ? AND organization_id = ?`,
              [title, content, item.excerpt || null, imageUrl, sourceName, NEWS_CATEGORY, row.id, orgId],
            );
          }
          if (typeof invalidatePublicNewsCaches === 'function') {
            invalidatePublicNewsCaches(row.id);
          }
          detail.updated += 1;
          summary.updated += 1;
        } else {
          let insertSql;
          let insertParams;
          const cols =
            'title, content, excerpt, author_id, organization_id, image_url, source_name, source_url, category, custom_category, is_published';
          const vals = '?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1';
          const base = [
            title,
            content,
            item.excerpt || null,
            authorId,
            orgId,
            imageUrl,
            sourceName,
            sourceUrl,
            NEWS_CATEGORY,
            null,
          ];

          if (pubAt) {
            insertSql = `INSERT INTO news (${cols}, published_at, created_at, updated_at) VALUES (${vals}, ?, NOW(), NOW())`;
            insertParams = [...base, pubAt];
          } else {
            insertSql = `INSERT INTO news (${cols}, published_at, created_at, updated_at) VALUES (${vals}, NOW(), NOW(), NOW())`;
            insertParams = base;
          }

          const result = await executeInsert(insertSql, insertParams);
          let newsId = result.insertId || (result.rows && result.rows[0] && result.rows[0].id);
          if (!newsId) {
            const fallback = await executeQuery(
              'SELECT id FROM news WHERE organization_id = ? AND source_url = ? ORDER BY id DESC LIMIT 1',
              [orgId, sourceUrl],
            );
            newsId = fallback.rows?.[0]?.id;
          }

          if (typeof invalidatePublicNewsCaches === 'function' && newsId) {
            invalidatePublicNewsCaches(newsId);
          }

          const pubMs = item.pubDate ? Date.parse(item.pubDate) : NaN;
          const isRecent =
            !Number.isNaN(pubMs) && Date.now() - pubMs <= PUSH_MAX_AGE_MS;
          if (
            isRecent &&
            newsId &&
            typeof notifyFollowersOfNewsArticle === 'function'
          ) {
            try {
              await notifyFollowersOfNewsArticle(orgId, newsId, title);
            } catch (err) {
              logger.warn('[rss-sync] push:', err.message);
            }
          }

          detail.created += 1;
          summary.created += 1;
        }
      }

      await executeQuery(
        'UPDATE organizations SET rss_last_synced_at = NOW(), updated_at = NOW() WHERE id = ?',
        [orgId],
      );
    } catch (err) {
      const msg = err && err.message ? err.message : String(err);
      detail.error = msg;
      summary.errors.push({ organization_id: orgId, message: msg });
      logger.warn('[rss-sync] org', orgId, msg);
    }

    summary.details.push(detail);
  }

  return summary;
}

function createRssNewsSyncHandler(deps) {
  return async (req, res) => {
    res.set('Cache-Control', 'no-store');
    const cronSecret = process.env.CRON_SECRET;
    if (cronSecret) {
      const auth = req.headers.authorization || '';
      if (auth !== `Bearer ${cronSecret}`) {
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }
    try {
      const result = await runRssNewsSync(deps);
      return res.json({ ok: true, ...result });
    } catch (error) {
      console.error('[rss-sync] cron error:', error);
      return res.status(500).json({
        error: 'RSS sync failed',
        message: error.message,
      });
    }
  };
}

module.exports = {
  runRssNewsSync,
  createRssNewsSyncHandler,
  parseRssItems,
  decodeXmlEntities,
  cleanRssHtml,
  suppressRssSourceUrl,
  ensureRssSuppressedTable,
};
