/**
 * Server-side image compressie voor alle CDN-uploads (alle orgs).
 * Max. langste zijde + WebP/JPEG kwaliteit — vangt clients die niet comprimeren.
 */
const path = require('path');
const sharp = require('sharp');

const IMAGE_UPLOAD_MAX_EDGE = 1600;
const IMAGE_UPLOAD_QUALITY = 72;

function normalizeImageMime(mime) {
  const raw = String(mime || '').toLowerCase().trim();
  if (raw === 'image/jpg') return 'image/jpeg';
  return raw;
}

function isCompressibleImageMime(mime) {
  const m = normalizeImageMime(mime);
  return m === 'image/jpeg' || m === 'image/png' || m === 'image/webp' || m === 'image/gif';
}

function replaceImageExtension(filename, ext) {
  const base = path.basename(String(filename || 'image'));
  if (/\.(jpe?g|png|gif|webp)$/i.test(base)) {
    return base.replace(/\.(jpe?g|png|gif|webp)$/i, `.${ext}`);
  }
  return `${base}.${ext}`;
}

function buildPipeline(buffer, longest) {
  let work = sharp(buffer, { failOn: 'none', animated: false }).rotate();
  if (longest > IMAGE_UPLOAD_MAX_EDGE) {
    work = work.resize({
      width: IMAGE_UPLOAD_MAX_EDGE,
      height: IMAGE_UPLOAD_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    });
  }
  return work;
}

/**
 * Resize + re-encode. Geeft origineel terug bij fout of niet-afbeelding.
 * @returns {Promise<{ buffer: Buffer, mimetype: string, originalname: string, compressed: boolean }>}
 */
async function compressImageBuffer(buffer, mimetype, originalname) {
  const mime = normalizeImageMime(mimetype);
  const name = String(originalname || `image-${Date.now()}`).trim() || `image-${Date.now()}`;

  if (!Buffer.isBuffer(buffer) || !buffer.length || !isCompressibleImageMime(mime)) {
    return { buffer, mimetype: mime || mimetype, originalname: name, compressed: false };
  }

  try {
    const meta = await sharp(buffer, { failOn: 'none', animated: false }).metadata();
    const width = meta.width || 0;
    const height = meta.height || 0;
    const longest = Math.max(width, height);
    const needsResize = longest > IMAGE_UPLOAD_MAX_EDGE;

    const webpBuf = await buildPipeline(buffer, longest)
      .webp({ quality: IMAGE_UPLOAD_QUALITY, effort: 4 })
      .toBuffer();

    let out = webpBuf;
    let outMime = 'image/webp';
    let outName = replaceImageExtension(name, 'webp');

    // Vergelijk met JPEG; kies de kleinere.
    const jpegBuf = await buildPipeline(buffer, longest)
      .jpeg({ quality: IMAGE_UPLOAD_QUALITY, mozjpeg: true })
      .toBuffer();
    if (jpegBuf.length < out.length) {
      out = jpegBuf;
      outMime = 'image/jpeg';
      outName = replaceImageExtension(name, 'jpg');
    }

    // Geen resize nodig en output niet kleiner → origineel houden (bijv. al-gecomprimeerde WebP).
    if (!needsResize && out.length >= buffer.length) {
      return { buffer, mimetype: mime, originalname: name, compressed: false };
    }

    return {
      buffer: out,
      mimetype: outMime,
      originalname: outName,
      compressed: true,
    };
  } catch (err) {
    console.warn('[imageCompress] compressie mislukt, origineel behouden:', err.message || err);
    return { buffer, mimetype: mime, originalname: name, compressed: false };
  }
}

module.exports = {
  IMAGE_UPLOAD_MAX_EDGE,
  IMAGE_UPLOAD_QUALITY,
  compressImageBuffer,
  isCompressibleImageMime,
  normalizeImageMime,
};
