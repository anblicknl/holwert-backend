# Publieke read-only fallback (VDX-storing)

Wanneer de VDX-database/proxy niet bereikbaar is, serveert de Vercel-API
laatst bekende geldige publieke data vanaf een **externe host**
(standaard: holwert.frl op Antagonist).

Snapshots bevatten geen volledig archief: nieuws/agenda beperkt tot ca.
**21 dagen** (`FALLBACK_RETENTION_DAYS`).

Bij het opslaan van snapshots worden afbeeldingen/PDF’s van
`holwert.appenvloed.com` gespiegeld naar dezelfde frl-store, zodat in
fallback-modus de media-URL’s niet meer naar VDX wijzen.

## Waarom niet Vercel Blob?

Holwert.frl staat bij Antagonist (los van VDX). Geen Blob-quota, geen extra
Vercel Storage nodig.

## Setup holwert.frl

Zie map [`dorpsapp-fallback-host/`](../dorpsapp-fallback-host/README.md):
`store.php` opnieuw uploaden (media-ondersteuning) + secret behouden.

## Vercel environment

Gebruik namen **zonder** `PUBLIC_`-prefix (Vercel blokkeert Secret anders).

| Type | Key | Value |
|------|-----|--------|
| Config | `FALLBACK_STORE_URL` | `https://www.holwert.frl/dorpsapp-fallback-host/store.php` |
| Secret | `FALLBACK_STORE_SECRET` | zelfde als in `store.php` |
| Config | `FALLBACK_TENANT` | `holwert` |

Optioneel: `FALLBACK_RETENTION_DAYS=21`, `FALLBACK_READ_TIMEOUT_MS=4000`,
`FALLBACK_MAX_MEDIA_PER_SAVE=18`.
Oude `PUBLIC_FALLBACK_*` namen werken nog als fallback in code.

## Controleren

```bash
curl -sS 'https://holwert.frl/dorpsapp-fallback-host/store.php?tenant=holwert&key=news-list' | jq '.data.news[0].image_url'
# verwacht iets met store.php?…&raw=1 (niet appenvloed.com)

curl -sS https://holwert-backend.vercel.app/api/app/fallback-status
```

## VDX-storing simuleren

Zet tijdelijk `FORCE_PUBLIC_FALLBACK=1` in Vercel → redeploy → check `fallback: true`
→ env daarna weer verwijderen.

## Beschermde endpoints

bootstrap, news (+ head + :id), events (+ :id), organizations (+ :id + profile-blocks),
practical-info, afvalkalender, dorpsomroeper.
