'use strict';

/**
 * Upload buffers naar holwert.appenvloed.com/upload/upload.php
 * (zelfde pad als /api/upload). Images gaan via imageCompress eerst.
 */

const FormData = require('form-data');
const axios = require('axios');
const https = require('https');
const { compressImageBuffer } = require('./imageCompress');

const UPLOAD_ENDPOINT = 'https://holwert.appenvloed.com/upload/upload.php';

function folderSegmentForOrgUpload(orgIdNum) {
  if (orgIdNum == null || !Number.isFinite(orgIdNum) || orgIdNum < 1) return '00';
  return String(Math.floor(orgIdNum)).padStart(2, '0');
}

/** Upload bestand naar holwert.appenvloed.com/upload (org-submap: twee cijfers, bv. 07 of 00). */
async function uploadFileBufferToSharedHosting(buffer, originalname, mimetype, orgFolderTwoDigits) {
  const form = new FormData();
  form.append('file', buffer, {
    filename: originalname || 'image.jpg',
    contentType: mimetype || 'image/jpeg',
  });
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const seg =
    typeof orgFolderTwoDigits === 'string' && /^[0-9]{2}$/.test(orgFolderTwoDigits)
      ? orgFolderTwoDigits
      : '00';
  form.append('folder', `uploads/${year}/${month}/${seg}/`);

  let uploadResponse;
  try {
    uploadResponse = await axios.post(UPLOAD_ENDPOINT, form, {
      headers: {
        ...form.getHeaders(),
        'User-Agent': 'HolwertBackend/1.0',
        Origin: 'https://holwert.appenvloed.com',
        Referer: 'https://holwert.appenvloed.com/',
      },
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  } catch (axErr) {
    const status = axErr.response?.status ?? 'geen status';
    const body = axErr.response?.data;
    const bodyStr = typeof body === 'string' ? body.substring(0, 500) : JSON.stringify(body ?? '');
    console.error('[upload.php] HTTP-fout:', status, bodyStr);
    throw new Error(`upload.php gaf HTTP ${status} terug: ${bodyStr}`);
  }

  if (!uploadResponse.data || !uploadResponse.data.success) {
    const msg = (uploadResponse.data && uploadResponse.data.message) || JSON.stringify(uploadResponse.data);
    console.error('[upload.php] success=false:', msg);
    throw new Error(`Upload mislukt: ${msg}`);
  }
  const rawUrl = uploadResponse.data.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Geen URL van upload-server');
  }
  return rawUrl.replace('http://', 'https://');
}

async function uploadImageBufferToSharedHosting(buffer, originalname, mimetype, orgFolderTwoDigits) {
  const compressed = await compressImageBuffer(buffer, mimetype, originalname);
  if (compressed.compressed) {
    console.log(
      '[imageCompress]',
      `${buffer.length}→${compressed.buffer.length} bytes`,
      compressed.mimetype,
      compressed.originalname,
    );
  }
  return uploadFileBufferToSharedHosting(
    compressed.buffer,
    compressed.originalname,
    compressed.mimetype,
    orgFolderTwoDigits,
  );
}

module.exports = {
  UPLOAD_ENDPOINT,
  folderSegmentForOrgUpload,
  uploadFileBufferToSharedHosting,
  uploadImageBufferToSharedHosting,
};
