'use strict';

/**
 * Batch: bestaande nieuws-/agenda-foto's op de CDN opnieuw comprimeren
 * (zelfde limieten als imageCompress) → nieuwe URL → DB bijwerken.
 */
const axios = require('axios');
const https = require('https');
const { compressImageBuffer } = require('./imageCompress');

const HOSTED_UPLOADS_RE = /^https:\/\/holwert\.appenvloed\.com\/uploads\//i;
/** Minimale relatieve winst om te vervangen (15%). */
const MIN_SAVINGS_RATIO = 0.15;

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

/**
 * @returns {Promise<{
 *   status: 'converted'|'skipped'|'failed',
 *   id: number,
 *   type: string,
 *   beforeBytes?: number,
 *   afterBytes?: number,
 *   savedBytes?: number,
 *   oldUrl?: string,
 *   newUrl?: string,
 *   reason?: string,
 *   error?: string
 * }>}
 */
async function recompressOneRow(row, type, deps) {
  const { executeQuery, uploadImageBufferToSharedHosting, folderSegmentForOrgUpload } = deps;
  const id = row.id;
  const imageUrl = String(row.image_url || '').trim();
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

    const table = type === 'events' ? 'events' : 'news';
    await executeQuery(`UPDATE ${table} SET image_url = ?, updated_at = NOW() WHERE id = ?`, [
      newUrl,
      id,
    ]);

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

async function countAfterCursor(executeQuery, table, afterId) {
  const r = await executeQuery(
    `SELECT COUNT(*) AS total FROM ${table}
     WHERE image_url LIKE 'https://holwert.appenvloed.com/uploads/%'
       AND id > ?`,
    [afterId],
  );
  return parseInt(r.rows?.[0]?.total || 0, 10);
}

/**
 * Cursor-batch: verwerkt volgende N items (id ASC) zodat skips de run niet eindeloos herhalen.
 * @param {{
 *   executeQuery: Function,
 *   uploadImageBufferToSharedHosting: Function,
 *   folderSegmentForOrgUpload: Function,
 *   limit?: number,
 *   type?: string,
 *   afterNewsId?: number,
 *   afterEventsId?: number
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
  const typeFilter = String(opts.type || 'all').toLowerCase();
  let afterNewsId = Math.max(0, parseInt(opts.afterNewsId, 10) || 0);
  let afterEventsId = Math.max(0, parseInt(opts.afterEventsId, 10) || 0);
  const rowDeps = { executeQuery, uploadImageBufferToSharedHosting, folderSegmentForOrgUpload };

  const wantNews = typeFilter === 'all' || typeFilter === 'news';
  const wantEvents = typeFilter === 'all' || typeFilter === 'events';

  const candidates = [];
  if (wantNews) {
    const r = await executeQuery(
      `SELECT id, image_url, organization_id FROM news
       WHERE image_url LIKE 'https://holwert.appenvloed.com/uploads/%'
         AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [afterNewsId, cap],
    );
    for (const row of r.rows || []) {
      candidates.push({ ...row, _type: 'news' });
    }
  }
  if (wantEvents) {
    const r = await executeQuery(
      `SELECT id, image_url, organization_id FROM events
       WHERE image_url LIKE 'https://holwert.appenvloed.com/uploads/%'
         AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [afterEventsId, cap],
    );
    for (const row of r.rows || []) {
      candidates.push({ ...row, _type: 'events' });
    }
  }

  candidates.sort((a, b) => {
    if (a._type !== b._type) return a._type === 'news' ? -1 : 1;
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
    const result = await recompressOneRow(row, row._type, rowDeps);
    if (row._type === 'news') afterNewsId = Math.max(afterNewsId, row.id);
    else afterEventsId = Math.max(afterEventsId, row.id);

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
  if (wantNews) remaining += await countAfterCursor(executeQuery, 'news', afterNewsId);
  if (wantEvents) remaining += await countAfterCursor(executeQuery, 'events', afterEventsId);

  return {
    converted,
    skipped,
    failed,
    remaining,
    cursor: { afterNewsId, afterEventsId },
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
  MIN_SAVINGS_RATIO,
};
