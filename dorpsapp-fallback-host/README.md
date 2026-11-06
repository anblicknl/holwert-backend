# Dorpsapp fallback-host (upload naar holwert.frl)

Kleine PHP-store voor “last known good” snapshots + gespiegelde media.
Draait op **Antagonist** (los van VDX).

## Upload (FTP / File Manager)

1. Map op holwert.frl, bv. `/dorpsapp-fallback-host/` in de webroot.
2. Upload `store.php` (overschrijven bij updates — bevat o.a. `list-store` / `delete-media` voor opruimen).
3. Zet in `store.php` `FALLBACK_STORE_SECRET` op **hetzelfde** geheim als
   Vercel `FALLBACK_STORE_SECRET` (niet de placeholder uit de repo). **Let op:** bij overschrijven
   opnieuw het echte secret zetten als je een clean repo-bestand uploadt.
4. PHP moet kunnen schrijven in die map (`data/` + `data/{tenant}/media/`).

Test-URL’s:
- Snapshot: `…/store.php?tenant=holwert&key=practical-info`
- Media: `…/store.php?tenant=holwert&key=media/<hash>.jpg&raw=1`

## Vercel env (holwert-backend)

```
FALLBACK_STORE_URL=https://www.holwert.frl/dorpsapp-fallback-host/store.php
FALLBACK_STORE_SECRET=<zelfde geheim als in store.php>
FALLBACK_TENANT=holwert
FALLBACK_RETENTION_DAYS=21
```

Redeploy na env-wijzigingen. Geen Vercel Blob nodig.

## Beveiliging

- Schrijven (JSON + media): alleen met header `X-Fallback-Secret`
- Lezen: publiek (alleen publieke dorpsdata / afbeeldingen)
- `data/` niet indexeerbaar (zie `data/.htaccess`)
