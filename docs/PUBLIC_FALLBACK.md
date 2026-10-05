# Publieke read-only fallback (VDX-storing)

Wanneer de VDX-database/proxy niet bereikbaar is, serveert de Vercel-API
laatst bekende geldige publieke data vanaf een **externe host**
(standaard: holwert.frl op Antagonist).

Snapshots bevatten geen volledig archief: nieuws/agenda beperkt tot ca.
**21 dagen** (`PUBLIC_FALLBACK_RETENTION_DAYS`).

## Waarom niet Vercel Blob?

Holwert.frl staat bij Antagonist (los van VDX). Geen Blob-quota, geen extra
Vercel Storage nodig.

## Setup holwert.frl

Zie map [`dorpsapp-fallback-host/`](../dorpsapp-fallback-host/README.md):
`store.php` uploaden + secret zetten.

## Vercel environment

| Variabele | Voorbeeld |
|-----------|-----------|
| `PUBLIC_FALLBACK_STORE_URL` | `https://holwert.frl/dorpsapp-fallback/store.php` |
| `PUBLIC_FALLBACK_STORE_SECRET` | zelfde als in `store.php` |
| `PUBLIC_FALLBACK_TENANT` | `holwert` |
| `PUBLIC_FALLBACK_RETENTION_DAYS` | `21` (optioneel) |
| `PUBLIC_FALLBACK_READ_TIMEOUT_MS` | `4000` (optioneel) |
| `FORCE_PUBLIC_FALLBACK` | `1` alleen voor tests |

## Controleren

```bash
curl -sS 'https://holwert.frl/dorpsapp-fallback/store.php?tenant=holwert&key=practical-info'
curl -sS https://holwert-backend.vercel.app/api/app/fallback-status
curl -sS https://holwert-backend.vercel.app/api/app/practical-info | jq '{fallback, n:(.items|length)}'
```

## VDX-storing simuleren

Zet tijdelijk `FORCE_PUBLIC_FALLBACK=1` in Vercel → redeploy → check `fallback: true`
→ env daarna weer verwijderen.

## Beschermde endpoints

bootstrap, news (+ head + :id), events (+ :id), organizations (+ :id + profile-blocks),
practical-info, afvalkalender, dorpsomroeper.
