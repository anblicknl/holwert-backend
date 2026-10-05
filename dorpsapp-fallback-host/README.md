# Dorpsapp fallback-host (upload naar holwert.frl)

Kleine PHP-store voor “last known good” snapshots. Draait op **Antagonist**
(los van VDX), zodat de Dorpsapp bij een VDX-storing nog publieke data kan tonen.

## Upload (FTP / File Manager)

1. Maak op holwert.frl een map, bv. `/dorpsapp-fallback/` in de webroot
   (of een submap die via URL bereikbaar is).
2. Upload `store.php` daarheen.
3. Open `store.php` en zet `FALLBACK_STORE_SECRET` op een lang willekeurig geheim.
4. Zorg dat PHP schrijfrechten heeft in die map (er ontstaat automatisch `data/`).

Test-URL na upload:
`https://holwert.frl/dorpsapp-fallback/store.php?tenant=holwert&key=practical-info`
→ eerst 404 tot er een snapshot is geschreven.

## Vercel env (holwert-backend)

```
PUBLIC_FALLBACK_STORE_URL=https://holwert.frl/dorpsapp-fallback/store.php
PUBLIC_FALLBACK_STORE_SECRET=<zelfde geheim als in store.php>
PUBLIC_FALLBACK_TENANT=holwert
PUBLIC_FALLBACK_RETENTION_DAYS=21
```

Verwijder / gebruik niet meer: `BLOB_READ_WRITE_TOKEN` (niet nodig).

Redeploy na het zetten van de env vars.

## Beveiliging

- Schrijven: alleen met header `X-Fallback-Secret`
- Lezen: publiek (bewust — alleen publieke dorpsdata, geen tokens/wachtwoorden)
- Geen directory listing nodig; `data/` mag niet indexeerbaar zijn (optioneel `.htaccess`)
