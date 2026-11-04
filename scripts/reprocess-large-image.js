#!/usr/bin/env node
/**
 * Lokaal, veilig: verklein één of meer afbeeldingen met dezelfde limieten
 * als productie-upload (max 1600px, q≈72). Schrijft alleen naar --out / *-1600.*.
 * Geen FTP, geen DB, geen delete van originelen.
 *
 *   node scripts/reprocess-large-image.js ./foto.jpg --out ./foto-1600.webp
 *   node scripts/reprocess-large-image.js --batch ./map-met-fotos/
 */
const fs = require('fs');
const path = require('path');
const { compressImageBuffer, IMAGE_UPLOAD_MAX_EDGE, IMAGE_UPLOAD_QUALITY } = require('../imageCompress');

function usage() {
  console.log(`Gebruik:
  node scripts/reprocess-large-image.js <input> --out <output>
  node scripts/reprocess-large-image.js --batch <directory>

Limieten: max ${IMAGE_UPLOAD_MAX_EDGE}px langste zijde, kwaliteit ≈${IMAGE_UPLOAD_QUALITY}.
Originelen blijven onaangeroerd.`);
}

function mimeFromExt(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  return 'image/jpeg';
}

async function processOne(inputPath, outputPath) {
  const absIn = path.resolve(inputPath);
  if (!fs.existsSync(absIn)) {
    throw new Error(`Bestand niet gevonden: ${absIn}`);
  }
  const buf = fs.readFileSync(absIn);
  const mime = mimeFromExt(absIn);
  const result = await compressImageBuffer(buf, mime, path.basename(absIn));
  const absOut = path.resolve(outputPath);
  fs.mkdirSync(path.dirname(absOut), { recursive: true });
  fs.writeFileSync(absOut, result.buffer);
  console.log(
    `${path.basename(absIn)}: ${buf.length} → ${result.buffer.length} bytes` +
      ` (${result.mimetype}${result.compressed ? ', compressed' : ', passthrough'}) → ${absOut}`,
  );
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0 || args.includes('-h') || args.includes('--help')) {
    usage();
    process.exit(args.length ? 0 : 1);
  }

  if (args[0] === '--batch') {
    const dir = args[1];
    if (!dir) {
      usage();
      process.exit(1);
    }
    const absDir = path.resolve(dir);
    const files = fs.readdirSync(absDir).filter((f) => /\.(jpe?g|png|gif|webp)$/i.test(f));
    if (!files.length) {
      console.log('Geen afbeeldingen in', absDir);
      return;
    }
    for (const f of files) {
      if (/-1600\./i.test(f)) continue;
      const inPath = path.join(absDir, f);
      const outPath = path.join(
        absDir,
        f.replace(/\.(jpe?g|png|gif|webp)$/i, '-1600.webp'),
      );
      await processOne(inPath, outPath);
    }
    return;
  }

  const input = args[0];
  const outIdx = args.indexOf('--out');
  if (outIdx < 0 || !args[outIdx + 1]) {
    usage();
    process.exit(1);
  }
  await processOne(input, args[outIdx + 1]);
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
