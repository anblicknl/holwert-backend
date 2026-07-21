# Nieuws-deellink (Facebook / WhatsApp)

Upload de inhoud van deze map naar **`holwert.appenvloed.com/nieuws/`** (webroot):

- `index.php`
- `.htaccess`

De pagina leest gepubliceerd nieuws **direct uit de MySQL-database** via `../admin/db-proxy-credentials.php` (zelfde als db-proxy). Geen externe API-call nodig.

Resultaat: `https://holwert.appenvloed.com/nieuws/44` met titel, tekst en afbeelding voor social previews.
