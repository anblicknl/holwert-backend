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
    const html = absolutizeHtmlUrls(rawHtml, baseUrl || link);
    const imageUrl = resolveUrl(enclosure, baseUrl || link);

    items.push({
      title: title.trim(),
      link: resolveUrl(link, baseUrl) || link.trim(),
      guid: guid ? String(guid).trim() : null,
      pubDate: pubDate || null,
      imageUrl,
      html,
      excerpt: stripTags(description || contentEncoded || '').slice(0, 280),
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
    errors: [],
    details: [],
  };

  for (const org of orgs) {
    const orgId = org.id;
    const feedUrl = String(org.rss_feed_url || '').trim();
    const sourceName = String(org.name || 'RSS').trim() || 'RSS';
    const detail = { organization_id: orgId, feed_url: feedUrl, created: 0, updated: 0, skipped: 0, error: null };

    try {
      const xml = await fetchFeedXml(feedUrl);
      const { items } = parseRssItems(xml);
      const authorId = await findAuthorId(executeQuery, orgId);

      for (const item of items) {
        const sourceUrl = item.link;
        if (!sourceUrl) {
          detail.skipped += 1;
          summary.skipped += 1;
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
            notifyFollowersOfNewsArticle(orgId, newsId, title).catch((err) =>
              logger.warn('[rss-sync] push:', err.message),
            );
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
};
