===========================================
HOLWERT ADMIN PANEL - FTP UPLOAD INSTRUCTIES
===========================================

BELANGRIJK: Environment Variables Instellen
===========================================

Voordat je deze bestanden uploadt, moet je environment variables instellen!

Zie ENVIRONMENT_SETUP.md voor gedetailleerde instructies.

KORTE SAMENVATTING:
-------------------
1. Maak een .env bestand aan (kopieer .env.example)
2. Vul in:
   - DB_PASSWORD = je database wachtwoord
   - PHP_PROXY_API_KEY = haal op via: vercel env pull (in holwert-backend directory)
3. Upload .env naar je FTP server (in dezelfde directory als db-proxy.php)
4. Zorg dat .env NIET publiek toegankelijk is (gebruik .htaccess)

Bestanden om te uploaden:
=========================
- db-proxy.php (BELANGRIJK - moet werken!)
- load-env.php (helper voor .env bestanden)
- admin-panel.js (admin interface)
- login.html (login pagina)
- index.html (dashboard)
- dashboard.html (alternatief dashboard)
- styles.css (styling)
- .htaccess (beveiliging + environment variables)
- .env (NIET committen! Alleen uploaden naar FTP)

Optionele bestanden:
===================
- mysql-setup.php (database setup script)
- check-nodejs.php (test script)
- add-published-at-column.php (migratie script)
- add-privacy-policy-to-organizations.php (migratie script)
- fix-news-date.php (fix script)

Testen na upload:
=================
1. Test db-proxy.php: https://jouw-domein.com/admin/db-proxy.php
   - Moet een JSON error geven (niet een 500 error)
   - Als je "Database password not configured" ziet, werkt .env niet
   
2. Test login: https://jouw-domein.com/admin/login.html
   - Log in met admin@holwert.nl en je nieuwe wachtwoord

3. Controleer .htaccess:
   - Zorg dat .env bestanden geblokkeerd zijn
   - Zorg dat directory listing uit staat

Beveiliging:
============
✅ .env bestand NIET publiek toegankelijk maken
✅ .htaccess gebruiken om .env te blokkeren
✅ Sterke wachtwoorden gebruiken
✅ PHP_PROXY_API_KEY moet hetzelfde zijn als in Vercel
❌ NOOIT .env committen naar Git
❌ NOOIT credentials delen

Hulp nodig?
===========
Zie ENVIRONMENT_SETUP.md voor uitgebreide instructies.
