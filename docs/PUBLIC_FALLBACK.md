# Publieke read-only fallback (VDX-storing)

Wanneer de VDX-database/proxy niet bereikbaar is, serveert de Vercel-API
laatst bekende geldige publieke data uit **Vercel Blob**.

## Hobby-plan / kosten

Op het Vercel Hobby-plan is Blob **gratis binnen limieten**:

- 1 GB opslag
- 10.000 simple operations (reads)
- 2.000 advanced operations (writes/list)
- 10 GB data transfer

Boven die limiet: **geen extra factuur**, maar Blob wordt geblokkeerd tot de
volgende periode. Daarom schrijven we snapshots getrottled (standaard max. 1×
per key per 6 uur) en alleen bij inhoudelijk geldige, niet-lege data.

## Handmatige setup in Vercel

1. Dashboard → project **holwert-backend** → Storage → **Create Blob Store**
2. Koppel de store aan het project (production)
3. Zorg dat env `BLOB_READ_WRITE_TOKEN` gezet is (wordt meestal automatisch
   toegevoegd bij het aanmaken van de store)
4. Optioneel:
   - `PUBLIC_FALLBACK_TENANT=holwert` (standaard: `default`)
   - `PUBLIC_FALLBACK_READ_TIMEOUT_MS=4000`
   - `PUBLIC_FALLBACK_WRITE_INTERVAL_MS=21600000` (6 uur)
5. Redeploy na het zetten van env vars

## Controleren

```bash
curl -sS https://holwert-backend.vercel.app/api/app/fallback-status | jq
curl -sS https://holwert-backend.vercel.app/api/app/practical-info | jq '{fallback, items:(.items|length)}'
```

Na normale traffic (met werkende VDX) moeten snapshots verschijnen in
`fallback-status` en in het Blob-dashboard onder
`dorpsapp-fallback/<tenant>/…`.

## VDX-storing simuleren

Zet tijdelijk in Vercel env:

```
FORCE_PUBLIC_FALLBACK=1
```

Redeploy of wait for env pickup, daarna:

```bash
curl -sS https://holwert-backend.vercel.app/api/news | jq '{fallback, lastUpdated, count:(.news|length)}'
```

Verwacht: `fallback: true` + data uit snapshot. **Verwijder daarna
`FORCE_PUBLIC_FALLBACK` weer.**

Alternatief: tijdelijk `PHP_PROXY_URL` naar een onbereikbare URL zetten
(zwaarder; raakt ook admin).

## Beschermde endpoints

- `/api/app/bootstrap`
- `/api/news` (+ head, + `:id`)
- `/api/events` (+ `:id`)
- `/api/organizations` (+ `:id`, + profile-blocks)
- `/api/app/practical-info`
- `/api/app/afvalkalender`
- `/api/app/dorpsomroeper` (+ alias global-banner)
