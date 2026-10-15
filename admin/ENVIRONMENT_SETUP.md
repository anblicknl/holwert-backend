# Environment Variables Instellen op FTP Server

De PHP bestanden op je FTP server hebben environment variables nodig om veilig te werken.

## Optie 1: Via .env bestand (Aanbevolen)

1. **Download de environment variables van Vercel:**
   ```bash
   cd holwert-backend
   vercel env pull .env.vercel
   ```

2. **Kopieer de waarden die je nodig hebt:**
   - `DB_PASSWORD` - je database wachtwoord
   - `PHP_PROXY_API_KEY` - de API key voor db-proxy.php

3. **Maak een `.env` bestand aan:**
   - Kopieer `.env.example` naar `.env`
   - Vul de waarden in
   - Upload `.env` naar je FTP server (in dezelfde directory als `db-proxy.php`)

4. **Zorg dat `.env` niet publiek toegankelijk is:**
   - Plaats het buiten de webroot, OF
   - Gebruik `.htaccess` om toegang te blokkeren (zie `.htaccess` bestand)

## Optie 2: Via .htaccess (Als .env niet werkt)

1. **Pas `.htaccess` aan:**
   - Open `.htaccess` in deze directory
   - Vul de waarden in bij `SetEnv`
   - Upload naar je FTP server

2. **Let op:** Niet alle hosting providers ondersteunen `SetEnv` in `.htaccess`

## Optie 3: Via Hosting Control Panel

Veel hosting providers hebben een interface om environment variables in te stellen:

1. Log in op je hosting control panel (bijv. cPanel, Plesk, DirectAdmin)
2. Zoek naar "Environment Variables" of "PHP Variables"
3. Voeg toe:
   - `DB_PASSWORD` = je database wachtwoord
   - `PHP_PROXY_API_KEY` = de API key (haal op via `vercel env pull`)

## Welke waarden heb je nodig?

### DB_PASSWORD
Je database wachtwoord (dezelfde als in Vercel)

### PHP_PROXY_API_KEY
Haal deze op via:
```bash
cd holwert-backend
vercel env pull .env.vercel
grep PHP_PROXY_API_KEY .env.vercel
```

Deze waarde moet **exact hetzelfde** zijn als in Vercel, anders werkt de communicatie tussen backend en PHP proxy niet.

## Testen

Na het instellen van environment variables, test of het werkt:

1. Open `db-proxy.php` in je browser (of via een API call)
2. Als je een error krijgt over "Database password not configured", werkt de environment variable niet
3. Controleer of de waarden correct zijn ingesteld

## Beveiliging

- ✅ **DOEN:** Zorg dat `.env` bestanden niet publiek toegankelijk zijn
- ✅ **DOEN:** Gebruik sterke wachtwoorden
- ❌ **NIET DOEN:** Commit `.env` bestanden naar Git
- ❌ **NIET DOEN:** Deel environment variables publiekelijk

## Hulp nodig?

Als je problemen hebt met het instellen van environment variables op je hosting provider, neem contact op met je hosting support. Ze kunnen je helpen met de juiste methode voor jouw specifieke hosting omgeving.
