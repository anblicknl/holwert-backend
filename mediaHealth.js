'use strict';

/**
 * Media-gezondheid: dode CDN-links en weesbestanden op de hosting.
 */
const axios = require('axios');
const https = require('https');
const FormData = require('form-data');
const { HOSTED_UPLOADS_LIKE, isHostedUploadUrl } = require('./mediaRecompress');

const LIST_UPLOADS_URL = 'https://holwert.appenvloed.com/upload/list-uploads.php';
const httpsAgent = new https.Agent({ rejectUnauthorized: false });

const LINK_SOURCES = [
  { key: 'news', table: 'news', column: 'image_url', titleCol: 'title' },
  { key: 'events', table: 'events', column: 'image_url', titleCol: 'title' },
  { key: 'profiles', table: 'users', column: 'profile_image_url', titleCol: 'email' },
  { key: 'practical', table: 'practical_info', column: 'icon', titleCol: 'title' },
  { key: 'organizations', table: 'organizations', column: 'logo_url', titleCol: 'name' },
];

async function collectReferencedUploadUrls(executeQuery) {
  const urls = new Set();
  for (const src of LINK_SOURCES) {
    const r = await executeQuery(
      `SELECT ${src.column} AS u FROM ${src.table}
       WHERE ${src.column} LIKE ?`,
      [HOSTED_UPLOADS_LIKE],
    );
    for (const row of r.rows || []) {
      const u = String(row.u || '').trim();
      if (isHostedUploadUrl(u)) urls.add(u.split('?')[0]);
    }
  }
  // PDF's ook meenemen zodat we geen "wees" PDF's ten onrechte wissen
  for (const table of ['news', 'events']) {
    const r = await executeQuery(
      `SELECT pdf_url AS u FROM ${table} WHERE pdf_url LIKE ?`,
      [HOSTED_UPLOADS_LIKE],
    );
    for (const row of r.rows || []) {
      const u = String(row.u || '').trim();
      if (u.includes('holwert.appenvloed.com/uploads/')) urls.add(u.split('?')[0]);
    }
  }
  return urls;
}

function pathFromUploadUrl(url) {
  const m = String(url || '').match(/holwert\.appenvloed\.com\/(uploads\/\d{4}\/\d{2}\/\d{2}\/[^?#]+)/i);
  return m ? m[1] : null;
}

async function headOk(url) {
  try {
    const res = await axios.head(url, {
      timeout: 10000,
      maxRedirects: 3,
      httpsAgent,
      validateStatus: () => true,
      headers: { 'User-Agent': 'HolwertBackend/1.0' },
    });
    if (res.status >= 200 && res.status < 400) return { ok: true, status: res.status };
    // Sommige hosts blokkeren HEAD → probeer GET range
    if (res.status === 405 || res.status === 403) {
      const g = await axios.get(url, {
        timeout: 12000,
        responseType: 'stream',
        maxContentLength: 2048,
        httpsAgent,
        validateStatus: () => true,
        headers: { 'User-Agent': 'HolwertBackend/1.0', Range: 'bytes=0-0' },
      });
      if (g.data && typeof g.data.destroy === 'function') g.data.destroy();
      return { ok: g.status >= 200 && g.status < 400, status: g.status };
    }
    return { ok: false, status: res.status };
  } catch (err) {
    return { ok: false, status: 0, error: err.message || String(err) };
  }
}

/**
 * Cursor-scan op dode CDN-links.
 */
async function checkBrokenMediaLinks(opts) {
  const executeQuery = opts.executeQuery;
  const cap = Math.min(Math.max(parseInt(opts.limit, 10) || 8, 1), 15);
  const cursors = { ...(opts.cursors || {}) };
  const broken = [];
  const checked = [];
  let remaining = 0;

  for (const src of LINK_SOURCES) {
    if (cursors[src.key] == null) cursors[src.key] = 0;
    cursors[src.key] = Math.max(0, parseInt(cursors[src.key], 10) || 0);
  }

  const candidates = [];
  for (const src of LINK_SOURCES) {
    const afterId = cursors[src.key] || 0;
    const r = await executeQuery(
      `SELECT id, ${src.column} AS url, ${src.titleCol} AS label
       FROM ${src.table}
       WHERE ${src.column} LIKE ?
         AND id > ?
       ORDER BY id ASC
       LIMIT ?`,
      [HOSTED_UPLOADS_LIKE, afterId, cap],
    );
    for (const row of r.rows || []) {
      candidates.push({ ...row, _src: src });
    }
  }

  candidates.sort((a, b) => a.id - b.id);
  const batch = candidates.slice(0, cap);

  for (const row of batch) {
    const src = row._src;
    cursors[src.key] = Math.max(cursors[src.key] || 0, row.id);
    const url = String(row.url || '').trim();
    const result = await headOk(url);
    const item = {
      type: src.key,
      id: row.id,
      label: row.label || '',
      url,
      status: result.status,
      ok: result.ok,
      error: result.error || null,
    };
    checked.push(item);
    if (!result.ok) broken.push(item);
  }

  for (const src of LINK_SOURCES) {
    const r = await executeQuery(
      `SELECT COUNT(*) AS total FROM ${src.table}
       WHERE ${src.column} LIKE ? AND id > ?`,
      [HOSTED_UPLOADS_LIKE, cursors[src.key] || 0],
    );
    remaining += parseInt(r.rows?.[0]?.total || 0, 10);
  }

  return {
    broken,
    checked,
    remaining,
    cursors,
    done: batch.length === 0 || remaining === 0,
  };
}

/**
 * Zet image-kolom op NULL voor dode links (content blijft bestaan).
 */
async function clearBrokenMediaLinks(opts) {
  const executeQuery = opts.executeQuery;
  const items = Array.isArray(opts.items) ? opts.items : [];
  const cleared = [];
  const failed = [];

  for (const item of items.slice(0, 50)) {
    const src = LINK_SOURCES.find((s) => s.key === item.type);
    if (!src || !item.id) {
      failed.push({ ...item, error: 'ongeldig' });
      continue;
    }
    try {
      try {
        await executeQuery(
          `UPDATE ${src.table} SET ${src.column} = NULL, updated_at = NOW() WHERE id = ?`,
          [item.id],
        );
      } catch (_) {
        await executeQuery(
          `UPDATE ${src.table} SET ${src.column} = NULL WHERE id = ?`,
          [item.id],
        );
      }
      cleared.push({ type: src.key, id: item.id });
    } catch (err) {
      failed.push({ type: src.key, id: item.id, error: err.message || String(err) });
    }
  }
  return { cleared, failed };
}

async function listHostedUploads() {
  const secret = process.env.DELETE_SECRET || 'holwert-delete-2026';
  const form = new FormData();
  form.append('secret', secret);
  form.append('limit', '4000');
  const res = await axios.post(LIST_UPLOADS_URL, form, {
    headers: { ...form.getHeaders(), 'User-Agent': 'HolwertBackend/1.0' },
    timeout: 60000,
    httpsAgent,
    validateStatus: () => true,
  });
  if (!res.data || !res.data.success) {
    const msg = (res.data && res.data.message) || `HTTP ${res.status}`;
    const err = new Error(`list-uploads.php: ${msg}`);
    err.code = 'LIST_UPLOADS_FAILED';
    err.status = res.status;
    throw err;
  }
  return {
    files: Array.isArray(res.data.files) ? res.data.files : [],
    truncated: !!res.data.truncated,
  };
}

/**
 * Bestanden op CDN die in geen DB-rij meer voorkomen.
 */
async function findOrphanUploads(opts) {
  const executeQuery = opts.executeQuery;
  const referenced = await collectReferencedUploadUrls(executeQuery);
  const referencedPaths = new Set();
  for (const url of referenced) {
    const p = pathFromUploadUrl(url);
    if (p) referencedPaths.add(p);
  }

  const listed = await listHostedUploads();
  const orphans = [];
  for (const file of listed.files) {
    const path = typeof file === 'string' ? file : file.path;
    if (!path || !path.startsWith('uploads/')) continue;
    // Alleen afbeeldingen als wees-foto; PDF's die nergens hangen ook tonen
    if (!referencedPaths.has(path)) {
      orphans.push({
        path,
        url: `https://holwert.appenvloed.com/${path}`,
        size: typeof file === 'object' ? file.size || null : null,
      });
    }
  }

  return {
    orphanCount: orphans.length,
    referencedCount: referencedPaths.size,
    listedCount: listed.files.length,
    truncated: listed.truncated,
    orphans: orphans.slice(0, 200),
  };
}

module.exports = {
  LINK_SOURCES,
  checkBrokenMediaLinks,
  clearBrokenMediaLinks,
  findOrphanUploads,
  collectReferencedUploadUrls,
  pathFromUploadUrl,
};
