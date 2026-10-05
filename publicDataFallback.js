/**
 * Persistente "last known good" snapshots voor publieke Dorpsapp-data.
 * Opslag: Vercel Blob (onafhankelijk van VDX). Tenant-aware voor hergebruik.
 *
 * Hobby-plan: schrijven is getrottled (advanced ops limiet ~2k/maand).
 */

const crypto = require('crypto');

const READ_TIMEOUT_MS = Math.max(
  1000,
  parseInt(process.env.PUBLIC_FALLBACK_READ_TIMEOUT_MS || '4000', 10) || 4000
);

/** Minimale tijd tussen Blob-writes per key (Hobby advanced-ops limiet). */
const WRITE_INTERVAL_MS = Math.max(
  60 * 1000,
  parseInt(process.env.PUBLIC_FALLBACK_WRITE_INTERVAL_MS || String(6 * 60 * 60 * 1000), 10) ||
    6 * 60 * 60 * 1000
);

const TENANT_ID = String(
  process.env.PUBLIC_FALLBACK_TENANT || process.env.TENANT_ID || 'default'
)
  .trim()
  .toLowerCase()
  .replace(/[^a-z0-9_-]/g, '') || 'default';

const FORCE_FALLBACK =
  process.env.FORCE_PUBLIC_FALLBACK === '1' || process.env.FORCE_PUBLIC_FALLBACK === 'true';

/** @type {Map<string, string>} pathname -> url */
let urlIndex = null;
/** @type {Map<string, number>} key -> last write attempt ms */
const lastWriteAttempt = new Map();

function blobToken() {
  return (process.env.BLOB_READ_WRITE_TOKEN || '').trim() || null;
}

function pathnameFor(key) {
  const safe = String(key || '')
    .replace(/[^a-zA-Z0-9/_-]/g, '_')
    .replace(/\/+/g, '/')
    .replace(/^\/|\/$/g, '');
  return `dorpsapp-fallback/${TENANT_ID}/${safe}.json`;
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

/** Structureel geldig genoeg om als live response te accepteren (mag leeg zijn). */
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

/**
 * Strenge check vóór opslaan: nooit lege/incomplete/fout-payloads als LKG bewaren.
 * @param {string} kind
 * @param {object} payload
 */
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
      return Array.isArray(payload.blocks); // lege blocks OK als org geen blokken heeft — maar dan niet overschrijven als we al iets hadden: zie save logic
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
      // active false is een geldige "geen mededeling"-state
      return typeof payload.active === 'boolean';
    default:
      return hasPublicDataKeys(payload);
  }
}

/** Strip persoonlijke velden vóór snapshot (bookmarks e.d.). */
function sanitizeForSnapshot(kind, payload) {
  const clone = JSON.parse(JSON.stringify(payload));
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

async function loadBlobSdk() {
  try {
    return require('@vercel/blob');
  } catch (e) {
    console.warn('[public-fallback] @vercel/blob niet geïnstalleerd:', e.message);
    return null;
  }
}

async function ensureUrlIndex(token) {
  if (urlIndex) return urlIndex;
  const sdk = await loadBlobSdk();
  if (!sdk?.list) {
    urlIndex = new Map();
    return urlIndex;
  }
  try {
    const prefix = `dorpsapp-fallback/${TENANT_ID}/`;
    const { blobs } = await sdk.list({ prefix, token, limit: 1000 });
    urlIndex = new Map();
    for (const b of blobs || []) {
      if (b?.pathname && b?.url) urlIndex.set(b.pathname, b.url);
    }
    console.log(
      `[public-fallback] url-index geladen tenant=${TENANT_ID} count=${urlIndex.size}`
    );
  } catch (e) {
    console.warn('[public-fallback] list/index mislukt:', e.message);
    urlIndex = new Map();
  }
  return urlIndex;
}

/**
 * @returns {Promise<{ ok: boolean, saved?: boolean, reason?: string, lastUpdated?: string }>}
 */
async function saveSnapshotIfDue(key, kind, payload) {
  const token = blobToken();
  if (!token) {
    return { ok: false, reason: 'no_blob_token' };
  }
  if (!isWorthSaving(kind, payload)) {
    console.log(
      `[public-fallback] snapshot NIET opgeslagen key=${key} reason=not_worth_saving kind=${kind}`
    );
    return { ok: false, reason: 'not_worth_saving' };
  }

  // profile-blocks: lege array niet over bestaande non-empty heen schrijven
  if (kind === 'profile-blocks' && Array.isArray(payload.blocks) && payload.blocks.length === 0) {
    const existing = await loadSnapshot(key);
    if (existing?.data?.blocks?.length > 0) {
      console.log(
        `[public-fallback] snapshot NIET opgeslagen key=${key} reason=empty_would_overwrite`
      );
      return { ok: false, reason: 'empty_would_overwrite' };
    }
    // nog geen snapshot: lege blocks ook niet bewaren als "good"
    return { ok: false, reason: 'empty_blocks' };
  }

  const now = Date.now();
  const lastAttempt = lastWriteAttempt.get(key) || 0;
  if (now - lastAttempt < WRITE_INTERVAL_MS) {
    return { ok: true, saved: false, reason: 'throttled' };
  }

  const sanitized = sanitizeForSnapshot(kind, payload);
  const hash = contentHash(sanitized);

  // Als bestaande snapshot dezelfde hash heeft: geen write (spaart advanced ops)
  const existing = await loadSnapshot(key);
  if (existing?.hash === hash) {
    lastWriteAttempt.set(key, now);
    return { ok: true, saved: false, reason: 'unchanged' };
  }

  lastWriteAttempt.set(key, now);
  const sdk = await loadBlobSdk();
  if (!sdk?.put) return { ok: false, reason: 'no_sdk' };

  const lastUpdated = new Date().toISOString();
  const envelope = {
    tenant: TENANT_ID,
    key,
    kind,
    lastUpdated,
    hash,
    data: sanitized,
  };

  const pathname = pathnameFor(key);
  try {
    const blob = await sdk.put(pathname, JSON.stringify(envelope), {
      access: 'public',
      addRandomSuffix: false,
      allowOverwrite: true,
      contentType: 'application/json',
      token,
    });
    if (!urlIndex) urlIndex = new Map();
    if (blob?.url) urlIndex.set(pathname, blob.url);
    const ageNote = existing?.lastUpdated ? ` prev=${existing.lastUpdated}` : '';
    console.log(
      `[public-fallback] snapshot OPGESLAGEN key=${key} tenant=${TENANT_ID} at=${lastUpdated} hash=${hash}${ageNote}`
    );
    return { ok: true, saved: true, lastUpdated };
  } catch (e) {
    console.error(`[public-fallback] snapshot save mislukt key=${key}:`, e.message);
    return { ok: false, reason: e.message };
  }
}

/**
 * @returns {Promise<{ data: object, lastUpdated: string, hash?: string }|null>}
 */
async function loadSnapshot(key) {
  const token = blobToken();
  if (!token) return null;
  const pathname = pathnameFor(key);
  try {
    const index = await ensureUrlIndex(token);
    let url = index.get(pathname);
    if (!url) {
      // Probeer directe list op exact prefix (zeldzaam: na deploy vóór index)
      const sdk = await loadBlobSdk();
      if (sdk?.list) {
        const { blobs } = await sdk.list({ prefix: pathname.replace(/\.json$/, ''), token, limit: 5 });
        const hit = (blobs || []).find((b) => b.pathname === pathname) || (blobs || [])[0];
        if (hit?.url) {
          url = hit.url;
          index.set(pathname, url);
        }
      }
    }
    if (!url) return null;

    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      console.warn(`[public-fallback] snapshot fetch HTTP ${res.status} key=${key}`);
      return null;
    }
    const text = await res.text();
    if (looksLikeHtml(text)) {
      console.warn(`[public-fallback] snapshot lijkt HTML key=${key}`);
      return null;
    }
    let envelope;
    try {
      envelope = JSON.parse(text);
    } catch {
      console.warn(`[public-fallback] snapshot JSON parse fail key=${key}`);
      return null;
    }
    if (!isPlainObject(envelope?.data) || !envelope.lastUpdated) return null;
    if (!isStructurallyValid(envelope.data)) return null;
    return {
      data: envelope.data,
      lastUpdated: envelope.lastUpdated,
      hash: envelope.hash,
    };
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

/**
 * Live ophalen met timeout; bij falen snapshot; metadata toevoegen.
 * @param {import('express').Response} res
 * @param {object} opts
 */
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

    // Fire-and-forget save (niet awaiten langer dan nodig)
    saveSnapshotIfDue(key, kind, payload).catch((e) =>
      console.warn('[public-fallback] save async:', e.message)
    );

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
  const token = blobToken();
  const base = {
    tenant: TENANT_ID,
    blobConfigured: !!token,
    forceFallback: FORCE_FALLBACK,
    readTimeoutMs: READ_TIMEOUT_MS,
    writeIntervalMs: WRITE_INTERVAL_MS,
    snapshots: [],
  };
  if (!token) return base;
  try {
    const index = await ensureUrlIndex(token);
    const prefix = `dorpsapp-fallback/${TENANT_ID}/`;
    for (const [pathname, url] of index.entries()) {
      if (!pathname.startsWith(prefix)) continue;
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (!r.ok) continue;
        const env = await r.json();
        base.snapshots.push({
          key: env.key || pathname,
          kind: env.kind,
          lastUpdated: env.lastUpdated,
          age: ageLabel(env.lastUpdated),
          hash: env.hash,
        });
      } catch {
        /* skip */
      }
    }
    base.snapshots.sort((a, b) => String(a.key).localeCompare(String(b.key)));
  } catch (e) {
    base.error = e.message;
  }
  return base;
}

module.exports = {
  TENANT_ID,
  READ_TIMEOUT_MS,
  WRITE_INTERVAL_MS,
  FORCE_FALLBACK,
  blobToken,
  withTimeout,
  attachMeta,
  isStructurallyValid,
  isWorthSaving,
  saveSnapshotIfDue,
  loadSnapshot,
  sendPublicOrFallback,
  getStatusSummary,
  ageLabel,
};
