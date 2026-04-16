# Dashboard (organisaties) – Holwert

Uitgeklede omgeving: **zelfde inlog** als het beheerderspaneel (`/admin`), maar alleen voor **eigen organisatie**:

- **Nieuws** – eigen artikelen (inclusief afbeelding via veilige upload)
- **Agenda** – eigen evenementen (inclusief afbeelding)
- **Organisatieprofiel** – gegevens, privacy, logo

Uploads gaan via de API naar de map van **jouw** organisatie (server negeert een andere `organizationId` in het verzoek).

## Upload (FTP)

Upload de inhoud van deze map naar bijvoorbeeld:

- `holwert.appenvloed.com/dashboard`

zodat het dashboard bereikbaar is op  
`https://holwert.appenvloed.com/dashboard/` (of jouw gekozen subpad).

## Logo

Plaats eventueel hetzelfde `logo.svg` als in de admin-map; anders wordt een icoon getoond.

## Gebruikers koppelen aan een organisatie

Een gebruiker kan alleen inloggen in het dashboard als zijn account **aan een organisatie is gekoppeld** (`users.organization_id`) en **geen** centrale beheerdersrol `admin` / `superadmin` / `editor` heeft (die gebruiken `/admin`).

1. **Database:** kolom `organization_id` op `users` (INTEGER NULL, FK naar `organizations.id`).
2. **Beheerder:** in `/admin` bij **Gebruikers** een account aanmaken met **Organisatie** en rol **`user`**.

Daarna inloggen op de dashboard-URL; alleen content van die organisatie is zichtbaar.
