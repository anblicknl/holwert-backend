# Organisatieportaal (Holwert)

Uitgeklede versie van het admin-panel: **zelfde inlog en stijl** als `holwert.appenvloed.com/admin`, maar alleen:

- **Nieuws** – eigen nieuwsartikelen beheren
- **Agenda** – eigen evenementen beheren  
- **Organisatie profiel** – gegevens + privacy statement

## Upload (FTP)

Upload de inhoud van deze map naar bijvoorbeeld:

- `holwert.appenvloed.com/org` of  
- `holwert.appenvloed.com/organisatie`

 zodat de organisatieportaal bereikbaar is op  
`https://holwert.appenvloed.com/org/` (of `/organisatie/`).

## Logo

Plaats eventueel hetzelfde `logo.svg` als in de admin-map in deze map; anders wordt een icoon getoond.

## Gebruikers koppelen aan een organisatie

Een gebruiker kan alleen inloggen in het organisatieportaal als zijn account **aan een organisatie is gekoppeld**.

1. **Database:** De tabel `users` moet een kolom `organization_id` hebben (INTEGER NULL, foreign key naar `organizations.id`).  
   Als die kolom nog niet bestaat:

   ```sql
   ALTER TABLE users ADD COLUMN organization_id INT NULL;
   ```

2. **Super-admin:** In het gewone admin-panel (`/admin`) bij **Gebruikers** een gebruiker aanmaken of bewerken en daar **Organisatie** kiezen (als die optie in de admin is toegevoegd).  
   Of handmatig in de database: bij de gewenste user `organization_id` zetten op het id van de organisatie.

Daarna kan die gebruiker met hetzelfde e-mailadres en wachtwoord inloggen op het organisatieportaal; hij ziet alleen de gegevens van zijn eigen organisatie.
