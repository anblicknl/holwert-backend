'use strict';

/**
 * Batch: bestaande CDN-foto's opnieuw comprimeren → nieuwe URL → DB bijwerken.
 * Bronnen: news, events, users (profielfoto), practical_info (icon-URL).
 */
const axios = require('axios');
const https = require('https');
const { compressImageBuffer } = require('./imageCompress');

const HOSTED_UPLOADS_LIKE = 'https://holwert.appenvloed.com/uploads/%';
const HOSTED_UPLOADS_RE = /^https:\/\/holwert\.appenvloed\.com\/uploads\//i;
const MIN_SAVINGS_RATIO = 0.15;

const MEDIA_SOURCES = {
  news: {
    key: 'news',
    table: 'news',
    column: 'image_url',
    orgCol: 'organization_id',
  },
  events: {
    key: 'events',
    table: 'events',
    column: 'image_url',
    orgCol: 'organization_id',
  },
  profiles: {
    key: 'profiles',
    table: 'users',
    column: 'profile_image_url',
    orgCol: null,
  },
  practical: {
    key: 'practical',
    table: 'practical_info',
    column: 'icon',
    orgCol: null,
  },
};

function isHostedUploadUrl(url) {
  return typeof url === 'string' && HOSTED_UPLOADS_RE.test(url.trim());
}

function mimeFromUrlOrHeaders(url, contentType) {
  const ct = String(contentType || '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  if (ct.startsWith('image/')) {
    if (ct === 'image/jpg') return 'image/jpeg';
    return ct;
  }
  const lower = String(url || '').toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'image/jpeg';
}

function basenameFromUrl(url) {
  try {
    const u = new URL(url);
    const base = u.pathname.split('/').filter(Boolean).pop() || `image-${Date.now()}.jpg`;
    return decodeURIComponent(base);
  } catch {
    return `image-${Date.now()}.jpg`;
  }
}

async function downloadHostedImage(url) {
  const response = await axios.get(url, {
    responseType: 'arraybuffer',
    timeout: 45000,
    maxContentLength: 25 * 1024 * 1024,
    httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    headers: {
      'User-Agent': 'HolwertBackend/1.0',
      Accept: 'image/*,*/*;q=0.8',
    },
    validateStatus: (s) => s >= 200 && s < 300,
  });
  const buffer = Buffer.from(response.data);
  const mimetype = mimeFromUrlOrHeaders(url, response.headers['content-type']);
  return { buffer, mimetype, originalname: basenameFromUrl(url) };
}

function resolveSources(typeFilter) {
  const t = String(typeFilter || 'all').toLowerCase();
  if (t === 'all') return [MEDIA_SOURCES.news, MEDIA_SOURCES.events];
  if (t === 'profiles') return [MEDIA_SOURCES.profiles];
  if (t === 'practical') return [MEDIA_SOURCES.practical];
  if (t === 'news') return [MEDIA_SOURCES.news];
  if (t === 'events') return [MEDIA_SOURCES.events];
  if (t === 'media') {
    return [MEDIA_SOURCES.news, MEDIA_SOURCES.events, MEDIA_SOURCES.profiles, MEDIA_SOURCES.practical];
  }
  return [MEDIA_SOURCES.news, MEDIA_SOURCES.events];
}

async function recompressOneRow(row, source, deps) {
  const { executeQuery, uploadImageBufferToSharedHosting, folderSegmentForOrgUpload } = deps;
  const id = row.id;
  const imageUrl = String(row._url || '').trim();
  const type = source.key;
  if (!isHostedUploadUrl(imageUrl)) {
    return { status: 'skipped', id, type, reason: 'geen_cdn_url' };
  }

  try {
    const { buffer, mimetype, originalname } = await downloadHostedImage(imageUrl);
    const beforeBytes = buffer.length;
    if (!beforeBytes) {
      return { status: 'skipped', id, type, reason: 'leeg', beforeBytes: 0 };
    }

    const compressed = await compressImageBuffer(buffer, mimetype, originalname);
    const afterBytes = compressed.buffer.length;
    const savedBytes = beforeBytes - afterBytes;
    const needsReplace =
      compressed.compressed &&
      afterBytes > 0 &&
      savedBytes >= Math.max(1024, Math.floor(beforeBytes * MIN_SAVINGS_RATIO));

    if (!needsReplace) {
      return {
        status: 'skipped',
        id,
        type,
        beforeBytes,
        afterBytes,
        savedBytes: Math.max(0, savedBytes),
        reason: compressed.compressed ? 'te_weinig_winst' : 'al_optimaal',
      };
    }

    const orgId = row.organization_id != null ? parseInt(row.organization_id, 10) : null;
    const folder = folderSegmentForOrgUpload(Number.isFinite(orgId) && orgId > 0 ? orgId : null);
    const newUrl = await uploadImageBufferToSharedHosting(
      compressed.buffer,
      compressed.originalname,
      compressed.mimetype,
      folder,
    );

    await executeQuery(
      `UPDATE ${source.table} SET ${source.column} = ?, updated_at = NOW() WHERE id = ?`,
      [newUrl, id],
    );

    return {
      status: 'converted',
      id,
      type,
      beforeBytes,
      afterBytes,
      savedBytes,
      oldUrl: imageUrl,
      newUrl,
    };
  } catch (err) {
    return {
      status: 'failed',
      id,
      type,
      oldUrl: imageUrl,
      error: err.message || String(err),
    };
  }
}

async function countAfterCursor(executeQuery, source, afterId) {
  const r = await executeQuery(
    `SELECT COUNT(*) AS total FROM ${source.table}
     WHERE ${source.column} LIKE ?
       AND id > ?`,
    [HOSTED_UPLOADS_LIKE, afterId],
  );
  return parseInt(r.rows?.[0]?.total || 0, 10);
}

/**
 * @param {{
 *   executeQuery: Function,
 *   uploadImageBufferToSharedHosting: Function,
 *   folderSegmentForOrgUpload: Function,
 *   limit?: number,
 *   type?: string,
 *   cursors?: Record<string, number>
 * }} opts
 */
async function recompressHostedMediaBatch(opts) {
  const executeQuery = opts.executeQuery;
  const uploadImageBufferToSharedHosting = opts.uploadImageBufferToSharedHosting;
  const folderSegmentForOrgUpload = opts.folderSegmentForOrgUpload;
  if (typeof executeQuery !== 'function' || typeof uploadImageBufferToSharedHosting !== 'function') {
    throw new Error('recompressHostedMediaBatch: upload-helpers ontbreken');
  }
  const cap = Math.min(Math.max(parseInt(opts.limit, 10) || 6, 1), 12);
  const sources = resolveSources(opts.type);
  const cursors = { ...(opts.cursors || {}) };
  for (const s of sources) {
    if (cursors[s.key] == null) cursors[s.key] = 0;
    cursors[s.key] = Math.max(0, parseInt(cursors[s.key], 10) || 0);
  }
  // legacy cursor fields
  if (opts.afterNewsId != null) cursors.news = Math.max(cursors.news || 0, parseInt(opts.afterNewsId, 10) || 0);
  if (opts.afterEventsId != null) {
    cursors.events = Math.max(cursors.events || 0, parseInt(opts.afterEventsId, 10) || 0);
  }

  const rowDeps = { executeQuery, uploadImageBufferToSharedHosting, folderSegmentForOrgUpload };
  const candidates = [];

  for (const source of sources) {
    const afterId = cursors[source.key] || 0;
    const orgSelect = source.orgCol ? `, ${source.orgCol} AS organization_id` : ', NULL AS organization_id';
    const r = await executeQuery(
      `SELECT id, ${source.column} AS _url ${orgSelect}
       FROM ${source.table}
       WHERE ${source.column} LIKE ?
         AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [HOSTED_UPLOADS_LIKE, afterId, cap],
    );
    for (const row of r.rows || []) {
      candidates.push({ ...row, _source: source });
    }
  }

  candidates.sort((a, b) => {
    if (a._source.key !== b._source.key) return a._source.key.localeCompare(b._source.key);
    return a.id - b.id;
  });
  const batch = candidates.slice(0, cap);

  const converted = [];
  const skipped = [];
  const failed = [];
  let bytesBefore = 0;
  let bytesAfter = 0;
  let bytesSaved = 0;

  for (const row of batch) {
    const source = row._source;
    const result = await recompressOneRow(row, source, rowDeps);
    cursors[source.key] = Math.max(cursors[source.key] || 0, row.id);

    if (result.status === 'converted') {
      converted.push(result);
      bytesBefore += result.beforeBytes || 0;
      bytesAfter += result.afterBytes || 0;
      bytesSaved += result.savedBytes || 0;
    } else if (result.status === 'failed') {
      failed.push(result);
    } else {
      skipped.push(result);
    }
  }

  let remaining = 0;
  for (const source of sources) {
    remaining += await countAfterCursor(executeQuery, source, cursors[source.key] || 0);
  }

  return {
    converted,
    skipped,
    failed,
    remaining,
    cursor: {
      afterNewsId: cursors.news || 0,
      afterEventsId: cursors.events || 0,
      afterProfilesId: cursors.profiles || 0,
      afterPracticalId: cursors.practical || 0,
      ...cursors,
    },
    cursors,
    done: batch.length === 0 || remaining === 0,
    stats: {
      bytesBefore,
      bytesAfter,
      bytesSaved: Math.max(0, bytesSaved),
      convertedCount: converted.length,
      skippedCount: skipped.length,
      failedCount: failed.length,
    },
  };
}

module.exports = {
  isHostedUploadUrl,
  recompressHostedMediaBatch,
  MEDIA_SOURCES,
  HOSTED_UPLOADS_LIKE,
  MIN_SAVINGS_RATIO,
};
