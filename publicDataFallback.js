/**
 * Persistente "last known good" snapshots voor publieke Dorpsapp-data.
 * Opslag: externe host (bijv. holwert.frl op Antagonist) — onafhankelijk van VDX.
 * Tenant-aware voor hergebruik bij andere dorpen.
 */

const crypto = require('crypto');
const axios = require('axios');

const READ_TIMEOUT_MS = Math.max(
  1000,
  parseInt(
    process.env.FALLBACK_READ_TIMEOUT_MS ||
      process.env.PUBLIC_FALLBACK_READ_TIMEOUT_MS ||
      '4000',
    10
  ) || 4000
);

/** Minimale tijd tussen remote writes per key (bespaart I/O op de fallback-host). */
const WRITE_INTERVAL_MS = Math.max(
  60 * 1000,
  parseInt(
    process.env.FALLBACK_WRITE_INTERVAL_MS ||
      process.env.PUBLIC_FALLBACK_WRITE_INTERVAL_MS ||
      String(6 * 60 * 60 * 1000),
    10
  ) || 6 * 60 * 60 * 1000
);

/** Alleen nieuws/agenda jonger dan dit in snapshots (dagen). */
const RETENTION_DAYS = Math.max(
  1,
  parseInt(
    process.env.FALLBACK_RETENTION_DAYS ||
      process.env.PUBLIC_FALLBACK_RETENTION_DAYS ||
      '21',
    10
  ) || 21
);

const TENANT_ID = String(
  process.env.FALLBACK_TENANT ||
    process.env.PUBLIC_FALLBACK_TENANT ||
    process.env.TENANT_ID ||
    'default'
)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '') || 'default';

const FORCE_FALLBACK =
  process.env.FORCE_PUBLIC_FALLBACK === '1' || process.env.FORCE_PUBLIC_FALLBACK === 'true';

/** @type {Map<string, number>} */
const lastWriteAttempt = new Map();
/** @type {Map<string, string>} key -> content hash of last successful save */
const lastSavedHash = new Map();

function storeBaseUrl() {
  return (
    process.env.FALLBACK_STORE_URL ||
    process.env.PUBLIC_FALLBACK_STORE_URL ||
    ''
  )
    .trim()
    .replace(/\/+$/, '') || null;
}

function storeSecret() {
  return (
    process.env.FALLBACK_STORE_SECRET ||
    process.env.PUBLIC_FALLBACK_STORE_SECRET ||
    ''
  ).trim() || null;
}

function storeConfigured() {
  return !!(storeBaseUrl() && storeSecret());
}

function safeKey(key) {
  return String(key || '')
    .replace(/[^a-zA-Z0-9/_-]/g, '_')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
}

/** Publieke lees-URL via store.php (werkt voor geneste keys). */
function publicJsonUrl(key) {
  const base = storeBaseUrl();
  if (!base) return null;
  const u = new URL(base.includes('://') ? base : `https://${base}`);
  u.searchParams.set('tenant', TENANT_ID);
  u.searchParams.set('key', safeKey(key));
  return u.toString();
}

function contentHash(payload) {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
}

function looksLikeHtml(value) {
  if (typeof value === 'string') {
    const t = value.trim().slice(0, 80).toLowerCase();
    return t.startsWith('<!doctype') || t.startsWith('<html') || t.startsWith('<?xml');
  }
  return false;
}

function isPlainObject(v) {
  return v != null && typeof v === 'object' && !Array.isArray(v);
}

function isStructurallyValid(payload) {
  if (payload == null) return false;
  if (typeof payload === 'string' && looksLikeHtml(payload)) return false;
  if (!isPlainObject(payload)) return false;
  if (payload.error && !hasPublicDataKeys(payload)) return false;
  return true;
}

function hasPublicDataKeys(payload) {
  return (
    Array.isArray(payload.news) ||
    Array.isArray(payload.events) ||
    Array.isArray(payload.organizations) ||
    Array.isArray(payload.items) ||
    Array.isArray(payload.blocks) ||
    payload.article != null ||
    payload.event != null ||
    payload.organization != null ||
    payload.config != null ||
    typeof payload.enabled === 'boolean' ||
    typeof payload.active === 'boolean' ||
    typeof payload.text === 'string'
  );
}

function isWorthSaving(kind, payload) {
  if (!isStructurallyValid(payload)) return false;
  if (payload.error && !hasPublicDataKeys(payload)) return false;

  switch (kind) {
    case 'bootstrap':
      return (
        Array.isArray(payload.news) &&
        payload.news.length > 0 &&
        Array.isArray(payload.organizations) &&
        payload.organizations.length > 0
      );
    case 'news-list':
    case 'news-head':
      return Array.isArray(payload.news) && payload.news.length > 0;
    case 'news-detail':
      return (
        isPlainObject(payload.article) &&
        payload.article.id != null &&
        typeof payload.article.title === 'string' &&
        payload.article.title.trim() !== ''
      );
    case 'events-list':
      return Array.isArray(payload.events) && payload.events.length > 0;
    case 'events-detail':
      return (
        isPlainObject(payload.event) &&
        payload.event.id != null &&
        typeof payload.event.title === 'string' &&
        payload.event.title.trim() !== ''
      );
    case 'organizations-list':
      return Array.isArray(payload.organizations) && payload.organizations.length > 0;
    case 'organizations-detail':
      return (
        isPlainObject(payload.organization) &&
        payload.organization.id != null &&
        typeof payload.organization.name === 'string' &&
        payload.organization.name.trim() !== ''
      );
    case 'profile-blocks':
      return Array.isArray(payload.blocks);
    case 'practical-info':
      return Array.isArray(payload.items) && payload.items.length > 0;
    case 'afvalkalender':
      return (
        isPlainObject(payload.config) &&
        Array.isArray(payload.oudPapierDates) &&
        Array.isArray(payload.containerDates) &&
        (payload.oudPapierDates.length > 0 || payload.containerDates.length > 0)
      );
    case 'dorpsomroeper':
      return typeof payload.active === 'boolean';
    default:
      return hasPublicDataKeys(payload);
  }
}

function retentionCutoffMs() {
  return Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;
}

function itemDateMs(item, fields) {
  for (const f of fields) {
    if (item?.[f]) {
      const t = new Date(item[f]).getTime();
      if (Number.isFinite(t)) return t;
    }
  }
  return null;
}

/** Beperk nieuws/agenda in snapshots tot de retentieperiode. */
function applyRetentionWindow(kind, payload) {
  const clone = JSON.parse(JSON.stringify(payload));
  const cutoff = retentionCutoffMs();

  const filterNews = (arr) =>
    (arr || []).filter((n) => {
      const t = itemDateMs(n, ['published_at', 'created_at', 'updated_at']);
      return t == null || t >= cutoff;
    });

  const filterEvents = (arr) =>
    (arr || []).filter((e) => {
      const t = itemDateMs(e, ['event_date', 'event_end_date', 'created_at']);
      // Toekomstige events altijd houden
      if (t != null && t >= Date.now() - 24 * 60 * 60 * 1000) return true;
      return t == null || t >= cutoff;
    });

  if (kind === 'bootstrap' || kind === 'news-list' || kind === 'news-head') {
    if (Array.isArray(clone.news)) clone.news = filterNews(clone.news);
  }
  if (kind === 'news-detail' && clone.article) {
    const t = itemDateMs(clone.article, ['published_at', 'created_at']);
    if (t != null && t < cutoff) return null; // te oud om te bewaren
  }
  if (kind === 'events-list' && Array.isArray(clone.events)) {
    clone.events = filterEvents(clone.events);
  }
  if (kind === 'events-detail' && clone.event) {
    const t = itemDateMs(clone.event, ['event_date', 'event_end_date', 'created_at']);
    const upcoming = t != null && t >= Date.now() - 24 * 60 * 60 * 1000;
    if (t != null && t < cutoff && !upcoming) return null;
  }
  return clone;
}

function sanitizeForSnapshot(kind, payload) {
  const retained = applyRetentionWindow(kind, payload);
  if (!retained) return null;
  const clone = retained;
  const stripBookmarks = (arr) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (item && typeof item === 'object') item.is_bookmarked = false;
    }
  };
  if (kind === 'bootstrap' || kind === 'news-list' || kind === 'news-head') {
    stripBookmarks(clone.news);
  }
  if (kind === 'news-detail' && clone.article) {
    clone.article.is_bookmarked = false;
  }
  return clone;
}

const VDX_HOST_RE = /(^https?:\/\/)?([^/]*\.)?holwert\.appenvloed\.com/i;

function shouldMirrorUrl(url) {
  if (!url || typeof url !== 'string') return false;
  const s = url.trim();
  if (!s || s.startsWith('data:') || s.startsWith('blob:')) return false;
  if (VDX_HOST_RE.test(s)) return true;
  // relatieve uploads op VDX-hosting
  if (s.startsWith('/uploads/') || s.startsWith('uploads/')) return true;
  return false;
}

function absoluteVdxUrl(url) {
  const s = String(url).trim();
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('//')) return `https:${s}`;
  if (s.startsWith('/')) return `https://holwert.appenvloed.com${s}`;
  if (s.startsWith('uploads/')) return `https://holwert.appenvloed.com/${s}`;
  return s;
}

function extFromUrlOrType(url, contentType) {
  const path = String(url).split('?')[0].toLowerCase();
  const m = path.match(/\.(jpe?g|png|webp|gif|pdf)$/);
  if (m) return m[1] === 'jpeg' ? 'jpg' : m[1];
  const ct = String(contentType || '').toLowerCase();
  if (ct.includes('png')) return 'png';
  if (ct.includes('webp')) return 'webp';
  if (ct.includes('gif')) return 'gif';
  if (ct.includes('pdf')) return 'pdf';
  return 'jpg';
}

function publicMediaUrl(mediaKey) {
  const base = storeBaseUrl();
  if (!base) return null;
  const u = new URL(base.includes('://') ? base : `https://${base}`);
  u.searchParams.set('tenant', TENANT_ID);
  u.searchParams.set('key', mediaKey);
  u.searchParams.set('raw', '1');
  return u.toString();
}

/** Max unieke media-uploads per snapshot-write (Vercel-tijdlimiet). */
const MAX_MEDIA_PER_SAVE = Math.max(
  1,
  parseInt(process.env.FALLBACK_MAX_MEDIA_PER_SAVE || '18', 10) || 18
);

/** @type {Map<string, string>} */
const mirrorMemo = new Map();

function payloadHasMirrorableMedia(node, found = { n: 0 }) {
  if (found.n > 0) return true;
  if (typeof node === 'string') {
    if (shouldMirrorUrl(node)) found.n += 1;
    return found.n > 0;
  }
  if (Array.isArray(node)) {
    for (const item of node) {
      if (payloadHasMirrorableMedia(item, found)) return true;
    }
    return false;
  }
  if (isPlainObject(node)) {
    for (const v of Object.values(node)) {
      if (payloadHasMirrorableMedia(v, found)) return true;
    }
  }
  return false;
}

async function uploadMediaBuffer(mediaKey, buffer, contentType) {
  const res = await axios.post(storeBaseUrl(), buffer, {
    headers: {
      'Content-Type': contentType || 'application/octet-stream',
      'X-Fallback-Secret': storeSecret(),
      'X-Fallback-Action': 'put-media',
      'X-Fallback-Tenant': TENANT_ID,
      'X-Fallback-Media-Key': mediaKey,
    },
    timeout: 20000,
    maxBodyLength: 2_500_000,
    validateStatus: () => true,
    transformRequest: [(d) => d],
  });
  if (res.status >= 200 && res.status < 300 && res.data?.ok === true) {
    return publicMediaUrl(mediaKey);
  }
  throw new Error(res.data?.error || `media_upload_http_${res.status}`);
}

async function mirrorOneUrl(url, budget) {
  if (!shouldMirrorUrl(url)) return url;
  if (mirrorMemo.has(url)) return mirrorMemo.get(url);
  if (budget.left <= 0) return url;

  const abs = absoluteVdxUrl(url);
  try {
    const dl = await axios.get(abs, {
      responseType: 'arraybuffer',
      timeout: 10000,
      maxContentLength: 2_000_000,
      validateStatus: (s) => s >= 200 && s < 300,
    });
    const buf = Buffer.from(dl.data);
    if (!buf.length || buf.length > 2_000_000) {
      mirrorMemo.set(url, url);
      return url;
    }
    const ext = extFromUrlOrType(abs, dl.headers['content-type']);
    const hash = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
    const mediaKey = `media/${hash}.${ext}`;
    const mirrored = await uploadMediaBuffer(
      mediaKey,
      buf,
      dl.headers['content-type'] || contentTypeGuess(ext)
    );
    budget.left -= 1;
    mirrorMemo.set(url, mirrored || url);
    return mirrored || url;
  } catch (e) {
    console.warn('[public-fallback] media mirror fail:', abs.slice(0, 80), e.message);
    // niet cachen als fail: volgende save mag opnieuw
    return url;
  }
}

function contentTypeGuess(ext) {
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'pdf') return 'application/pdf';
  return 'image/jpeg';
}

async function mirrorValue(value, stats, budget) {
  if (typeof value === 'string') {
    if (!shouldMirrorUrl(value)) return value;
    stats.seen += 1;
    const next = await mirrorOneUrl(value, budget);
    if (next !== value) stats.mirrored += 1;
    return next;
  }
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(await mirrorValue(item, stats, budget));
    return out;
  }
  if (isPlainObject(value)) {
    // Alle geneste string-URL's (o.a. image_variants.original/full/…) meenemen
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      out[k] = await mirrorValue(v, stats, budget);
    }
    return out;
  }
  return value;
}

/**
 * Spiegel VDX-media naar fallback-host en herschrijf URL's in de payload.
 * Beperkt tot max N unieke URL's per snapshot (Vercel-tijdlimiet).
 */
async function mirrorMediaInPayload(payload) {
  if (!storeConfigured() || !isPlainObject(payload)) return payload;
  const stats = { seen: 0, mirrored: 0 };
  const budget = { left: MAX_MEDIA_PER_SAVE };
  const cloned = JSON.parse(JSON.stringify(payload));
  const result = await mirrorValue(cloned, stats, budget);
  if (stats.seen > 0) {
    console.log(
      `[public-fallback] media mirror seen=${stats.seen} uploaded=${stats.mirrored} remaining_budget=${budget.left} tenant=${TENANT_ID}`
    );
  }
  return result;
}

function attachMeta(payload, { fallback, lastUpdated, error } = {}) {
  const out = isPlainObject(payload) ? { ...payload } : { data: payload };
  out.fallback = fallback === true;
  if (fallback === true && lastUpdated) {
    out.lastUpdated = lastUpdated;
  }
  if (error) out.error = error;
  return out;
}

function withTimeout(promise, ms = READ_TIMEOUT_MS) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`public_fallback_timeout_${ms}ms`)), ms);
    }),
  ]);
}

function parseEnvelope(text) {
  if (looksLikeHtml(text)) return null;
  let envelope;
  try {
    envelope = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isPlainObject(envelope?.data) || !envelope.lastUpdated) return null;
  if (!isStructurallyValid(envelope.data)) return null;
  return {
    data: envelope.data,
    lastUpdated: envelope.lastUpdated,
    hash: envelope.hash,
    sourceHash: envelope.sourceHash || null,
  };
}

/**
 * @returns {Promise<{ ok: boolean, saved?: boolean, reason?: string, lastUpdated?: string }>}
 */
async function saveSnapshotIfDue(key, kind, payload) {
  if (!storeConfigured()) {
    return { ok: false, reason: 'no_store_config' };
  }
  if (!isWorthSaving(kind, payload)) {
    console.log(
      `[public-fallback] snapshot NIET opgeslagen key=${key} reason=not_worth_saving kind=${kind}`
    );
    return { ok: false, reason: 'not_worth_saving' };
  }

  if (kind === 'profile-blocks' && Array.isArray(payload.blocks) && payload.blocks.length === 0) {
    const existing = await loadSnapshot(key);
    if (existing?.data?.blocks?.length > 0) {
      console.log(
        `[public-fallback] snapshot NIET opgeslagen key=${key} reason=empty_would_overwrite`
      );
      return { ok: false, reason: 'empty_would_overwrite' };
    }
    return { ok: false, reason: 'empty_blocks' };
  }

  const sanitized = sanitizeForSnapshot(kind, payload);
  if (!sanitized || !isWorthSaving(kind, sanitized)) {
    return { ok: false, reason: 'retention_empty' };
  }

  const now = Date.now();
  const sourceHash = contentHash(sanitized);
  const existing = await loadSnapshot(key);
  const sameContent = existing?.sourceHash === sourceHash;
  // Kijk naar de opgeslagen snapshot: live VDX-payload heeft altijd VDX-URL's.
  const mediaPending = sameContent
    ? payloadHasMirrorableMedia(existing.data)
    : payloadHasMirrorableMedia(sanitized);

  if (sameContent && lastSavedHash.get(key) === sourceHash && !mediaPending) {
    lastWriteAttempt.set(key, now);
    return { ok: true, saved: false, reason: 'unchanged' };
  }
  if (sameContent && !mediaPending) {
    lastSavedHash.set(key, sourceHash);
    lastWriteAttempt.set(key, now);
    return { ok: true, saved: false, reason: 'unchanged' };
  }

  const intervalMs =
    sameContent && mediaPending
      ? Math.min(WRITE_INTERVAL_MS, 90 * 1000)
      : WRITE_INTERVAL_MS;
  const lastAttempt = lastWriteAttempt.get(key) || 0;
  if (now - lastAttempt < intervalMs) {
    return { ok: true, saved: false, reason: 'throttled' };
  }

  lastWriteAttempt.set(key, now);

  // Bij catch-up: verder vanaf al deels gespiegelde snapshot, niet opnieuw vanaf VDX-URL's.
  let dataForStore = sameContent && existing?.data ? existing.data : sanitized;
  try {
    dataForStore = await mirrorMediaInPayload(dataForStore);
  } catch (e) {
    console.warn('[public-fallback] media mirror batch fail:', e.message);
  }

  const lastUpdated = new Date().toISOString();
  const hash = contentHash(dataForStore);
  const envelope = {
    tenant: TENANT_ID,
    key: safeKey(key),
    kind,
    lastUpdated,
    hash,
    sourceHash,
    retentionDays: RETENTION_DAYS,
    data: dataForStore,
  };

  try {
    const res = await axios.post(
      storeBaseUrl(),
      {
        action: 'put',
        tenant: TENANT_ID,
        key: safeKey(key),
        body: envelope,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          'X-Fallback-Secret': storeSecret(),
        },
        timeout: 45000,
        validateStatus: () => true,
      }
    );
    if (res.status >= 200 && res.status < 300 && res.data?.ok === true) {
      lastSavedHash.set(key, sourceHash);
      console.log(
        `[public-fallback] snapshot OPGESLAGEN host=frl key=${key} tenant=${TENANT_ID} at=${lastUpdated} hash=${hash}`
      );
      return { ok: true, saved: true, lastUpdated };
    }
    console.error(
      `[public-fallback] snapshot save mislukt key=${key}:`,
      res.status,
      res.data?.error || res.data?.message || ''
    );
    return { ok: false, reason: res.data?.error || `http_${res.status}` };
  } catch (e) {
    console.error(`[public-fallback] snapshot save mislukt key=${key}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * @returns {Promise<{ data: object, lastUpdated: string, hash?: string }|null>}
 */
async function loadSnapshot(key) {
  const url = publicJsonUrl(key);
  if (!url) return null;
  try {
    const res = await axios.get(url, {
      timeout: 8000,
      responseType: 'text',
      transformResponse: [(d) => d],
      validateStatus: () => true,
      headers: { Accept: 'application/json' },
    });
    if (res.status === 404) return null;
    if (res.status < 200 || res.status >= 300) {
      console.warn(`[public-fallback] snapshot fetch HTTP ${res.status} key=${key}`);
      return null;
    }
    const parsed = parseEnvelope(typeof res.data === 'string' ? res.data : String(res.data));
    if (!parsed) {
      console.warn(`[public-fallback] snapshot ongeldig key=${key}`);
      return null;
    }
    return parsed;
  } catch (e) {
    console.warn(`[public-fallback] snapshot load fail key=${key}:`, e.message);
    return null;
  }
}

function ageLabel(lastUpdated) {
  if (!lastUpdated) return 'unknown';
  const ms = Date.now() - new Date(lastUpdated).getTime();
  if (!Number.isFinite(ms) || ms < 0) return 'unknown';
  const h = Math.floor(ms / 3600000);
  if (h < 1) return `${Math.floor(ms / 60000)}m`;
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

async function sendPublicOrFallback(res, opts) {
  const {
    key,
    kind,
    live,
    failBody,
    cacheControl,
    notFoundStatus,
    isNotFound,
  } = opts;

  if (FORCE_FALLBACK) {
    console.warn(`[public-fallback] FORCE_PUBLIC_FALLBACK actief key=${key}`);
    const snap = await loadSnapshot(key);
    if (snap) {
      console.log(
        `[public-fallback] FALLBACK gebruikt key=${key} lastUpdated=${snap.lastUpdated} age=${ageLabel(snap.lastUpdated)} (forced)`
      );
      if (cacheControl) res.set('Cache-Control', cacheControl);
      return res.json(
        attachMeta(snap.data, { fallback: true, lastUpdated: snap.lastUpdated })
      );
    }
    return res
      .status(503)
      .json(
        attachMeta(failBody || { error: 'Service temporarily unavailable' }, {
          fallback: true,
          error: 'Service temporarily unavailable',
        })
      );
  }

  try {
    const payload = await withTimeout(Promise.resolve().then(() => live()), READ_TIMEOUT_MS);

    if (typeof isNotFound === 'function' && isNotFound(payload)) {
      const { __notFound, ...rest } = payload;
      return res.status(notFoundStatus || 404).json(rest);
    }

    if (!isStructurallyValid(payload)) {
      throw new Error('invalid_or_incomplete_live_payload');
    }

    // Op Vercel: await vóór res.json, anders wordt de write afgekapt
    try {
      await saveSnapshotIfDue(key, kind, payload);
    } catch (e) {
      console.warn('[public-fallback] save:', e && e.message ? e.message : e);
    }

    if (cacheControl) res.set('Cache-Control', cacheControl);
    return res.json(attachMeta(payload, { fallback: false }));
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn(
      `[public-fallback] VDX/live niet bruikbaar key=${key} tenant=${TENANT_ID}: ${msg}`
    );

    const snap = await loadSnapshot(key);
    if (snap) {
      console.log(
        `[public-fallback] FALLBACK gebruikt key=${key} lastUpdated=${snap.lastUpdated} age=${ageLabel(snap.lastUpdated)}`
      );
      if (cacheControl) res.set('Cache-Control', 'public, max-age=60');
      return res.json(
        attachMeta(snap.data, { fallback: true, lastUpdated: snap.lastUpdated })
      );
    }

    console.error(
      `[public-fallback] GEEN fallback beschikbaar key=${key} tenant=${TENANT_ID}`
    );
    return res.status(503).json(
      attachMeta(failBody || { error: 'Service temporarily unavailable' }, {
        fallback: true,
        error: 'Service temporarily unavailable',
      })
    );
  }
}

async function getStatusSummary() {
  const base = {
    tenant: TENANT_ID,
    storeConfigured: storeConfigured(),
    storeUrl: storeBaseUrl() ? storeBaseUrl().replace(/\/\/.*@/, '//***@') : null,
    forceFallback: FORCE_FALLBACK,
    readTimeoutMs: READ_TIMEOUT_MS,
    writeIntervalMs: WRITE_INTERVAL_MS,
    retentionDays: RETENTION_DAYS,
    backend: 'http-host',
    snapshots: [],
  };
  if (!storeBaseUrl()) return base;

  const probeKeys = [
    'bootstrap',
    'news-list',
    'news-list-minimal',
    'news-head',
    'events-list',
    'organizations-list',
    'organizations-list-minimal',
    'practical-info',
    'afvalkalender',
    'dorpsomroeper',
  ];
  for (const key of probeKeys) {
    try {
      const snap = await loadSnapshot(key);
      if (snap) {
        base.snapshots.push({
          key,
          lastUpdated: snap.lastUpdated,
          age: ageLabel(snap.lastUpdated),
          hash: snap.hash,
        });
      }
    } catch {
      /* skip */
    }
  }
  return base;
}

module.exports = {
  TENANT_ID,
  READ_TIMEOUT_MS,
  WRITE_INTERVAL_MS,
  RETENTION_DAYS,
  FORCE_FALLBACK,
  storeConfigured,
  withTimeout,
  attachMeta,
  isStructurallyValid,
  isWorthSaving,
  saveSnapshotIfDue,
  loadSnapshot,
  sendPublicOrFallback,
  getStatusSummary,
  ageLabel,
  publicJsonUrl,
};
