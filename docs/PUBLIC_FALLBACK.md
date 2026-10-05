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

Gebruik namen **zonder** `PUBLIC_`-prefix (Vercel blokkeert Secret anders).

| Type | Key | Value |
|------|-----|--------|
| Config | `FALLBACK_STORE_URL` | `https://www.holwert.frl/dorpsapp-fallback-host/store.php` |
| Secret | `FALLBACK_STORE_SECRET` | `HolwertFallback_2026_Kx9mQ2vL7nP4rT8w` |
| Config | `FALLBACK_TENANT` | `holwert` |

Optioneel: `FALLBACK_RETENTION_DAYS=21`, `FALLBACK_READ_TIMEOUT_MS=4000`.
Oude `PUBLIC_FALLBACK_*` namen werken nog als fallback in code.

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
