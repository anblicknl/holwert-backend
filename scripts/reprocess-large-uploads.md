# Bestaande te grote uploads verkleinen (veilig)

Nieuwe uploads worden al gecomprimeerd (client + Node `imageCompress` + optioneel GD in `upload.php`).
Dit document is voor **bestaande** monster-grote bestanden op `holwert.appenvloed.com/uploads/…`.

## Principes

- **Niet destructief zonder backup.** Overschrijf geen bestanden in-place via FTP tenzij Douwe-Jan dat bewust doet met een lokale kopie.
- **Liever nieuw pad forceren:** nieuwe gecomprimeerde file uploaden → DB `image_url` (en eventueel `large_url`) bijwerken → oude file later opruimen.
- Geen aparte mappen per org buiten `uploads/YYYY/MM/NN/`.

## Handmatige route (aanbevolen eerst)

1. Download de grote JPEG/PNG via browser of FTP (bewaar als backup).
2. Open in Preview/Photoshop of gebruik lokaal:
   ```bash
   node scripts/reprocess-large-image.js ./pad/naar/origineel.jpg --out ./pad/naar/klein.webp
   ```
3. Upload het resultaat via **admin of org-dashboard** (dan geldt de normale compressie-pipeline opnieuw) of via FTP naar dezelfde `uploads/YYYY/MM/NN/`-map met een **nieuwe** bestandsnaam.
4. Zet in de database (of admin-bewerk nieuws) de nieuwe URL op het nieuws-/agenda-item.
5. Oude URL pas verwijderen als de app de nieuwe toont.

## Script (lokaal, geen DB-write)

`scripts/reprocess-large-image.js` leest één bestand, past dezelfde limieten toe als productie (`max 1600px`, kwaliteit ≈72) en schrijft naar `--out`. Het raakt de server niet.

```bash
cd holwert-backend
node scripts/reprocess-large-image.js ~/Downloads/grote-foto.jpg --out ~/Downloads/grote-foto-1600.webp
```

Batch (alleen lokaal, schrijft naast elk bestand een `*-1600.webp`):

```bash
node scripts/reprocess-large-image.js --batch ~/Downloads/holwert-backup-uploads/
```

## Wat dit script níet doet

- Geen FTP, geen Vercel-deploy, geen `UPDATE news SET image_url=…`.
- Geen delete van originelen.

RSS-covers (externe Gemeente-URL’s) vallen hierbuiten: die staan niet onder `/uploads/`; zie aparte RSS-/thumbnail-plannen.
