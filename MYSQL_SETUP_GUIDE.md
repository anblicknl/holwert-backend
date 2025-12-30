# MySQL Setup Guide - Holwert App

## 📋 Overzicht

Deze guide helpt je bij het opzetten van een MySQL database voor de Holwert app. Het migratiescript doet automatisch alle database setup voor je.

## 🎯 Stap 1: MySQL Server Installeren

### Optie A: Lokale MySQL (voor development)
```bash
# macOS (via Homebrew)
brew install mysql
brew services start mysql

# Ubuntu/Debian
sudo apt-get update
sudo apt-get install mysql-server
sudo systemctl start mysql

# Windows
Download MySQL Installer van: https://dev.mysql.com/downloads/installer/
```

### Optie B: Managed MySQL (voor production)
- **DigitalOcean Managed Database** (aanbevolen)
- **AWS RDS MySQL**
- **Google Cloud SQL**
- **PlanetScale** (serverless MySQL)

## 🎯 Stap 2: Database Gebruiker Aanmaken

Log in op je MySQL server:
```bash
mysql -u root -p
```

Maak een database en gebruiker aan:
```sql
CREATE DATABASE holwert CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'holwert_user'@'%' IDENTIFIED BY 'jouw_sterke_wachtwoord';
GRANT ALL PRIVILEGES ON holwert.* TO 'holwert_user'@'%';
FLUSH PRIVILEGES;
EXIT;
```

**Voor production:** Vervang `'%'` door je server IP of `'localhost'` voor extra security.

## 🎯 Stap 3: Dependencies Installeren

```bash
cd holwert-backend
npm install mysql2
```

## 🎯 Stap 4: Environment Variables Instellen

Maak een `.env` bestand (of update bestaande):

```env
# MySQL Database Configuratie
DB_HOST=localhost
DB_PORT=3306
DB_USER=holwert_user
DB_PASSWORD=jouw_sterke_wachtwoord
DB_NAME=holwert

# Of gebruik MYSQL_ prefix (beide werken)
MYSQL_HOST=localhost
MYSQL_PORT=3306
MYSQL_USER=holwert_user
MYSQL_PASSWORD=jouw_sterke_wachtwoord
MYSQL_DATABASE=holwert

# Connection String (alternatief)
DATABASE_URL=mysql://holwert_user:jouw_sterke_wachtwoord@localhost:3306/holwert
```

## 🎯 Stap 5: Database Setup Script Uitvoeren

Het script maakt automatisch alle tabellen, indexes en foreign keys aan:

```bash
node scripts/setup-mysql-database.js
```

**Output die je zou moeten zien:**
```
🚀 MySQL Database Setup Script
================================

Database: holwert
Host: localhost:3306
User: holwert_user

✅ Database 'holwert' bestaat of is aangemaakt
✅ Verbonden met database

📦 Tabellen aanmaken...

✅ Tabel users aangemaakt
✅ Tabel organizations aangemaakt
✅ Tabel news aangemaakt
✅ Tabel events aangemaakt
✅ Tabel bookmarks aangemaakt
✅ Tabel follows aangemaakt
✅ Tabel push_tokens aangemaakt
✅ Tabel notification_history aangemaakt

✅ Database setup voltooid!
```

## 🎯 Stap 6: Server.js Aanpassen voor MySQL

Het script `scripts/migrate-server-to-mysql.js` helpt je hierbij, of je kunt handmatig:

1. **Vervang `pg` door `mysql2`:**
```javascript
// Oud:
const { Pool } = require('pg');

// Nieuw:
const mysql = require('mysql2/promise');
```

2. **Update connection pool:**
```javascript
// Oud:
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Nieuw:
const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQL_HOST,
  port: process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER,
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD,
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});
```

3. **Query syntax aanpassen:**
   - `$1, $2, $3` → `?` (parameter placeholders)
   - `ILIKE` → `LIKE` (case-insensitive search)
   - `SERIAL` → `AUTO_INCREMENT`
   - `TIMESTAMPTZ` → `TIMESTAMP`
   - `JSONB` → `JSON`
   - `RETURNING` → gebruik `SELECT` na `INSERT/UPDATE`

## 🎯 Stap 7: Data Migreren (optioneel)

Als je data van Supabase wilt migreren:

1. **Export van Supabase:**
   - Ga naar Supabase Dashboard → SQL Editor
   - Export alle tabellen als CSV of SQL

2. **Import naar MySQL:**
```bash
mysql -u holwert_user -p holwert < export.sql
```

Of via MySQL Workbench / phpMyAdmin.

## 🎯 Stap 8: Vercel Environment Variables

Voor production, update Vercel environment variables:

1. Ga naar Vercel Dashboard → Project → Settings → Environment Variables
2. Voeg toe:
   - `DB_HOST` (je MySQL server hostname)
   - `DB_PORT` (meestal 3306)
   - `DB_USER` (je MySQL gebruiker)
   - `DB_PASSWORD` (je MySQL wachtwoord)
   - `DB_NAME` (database naam, meestal 'holwert')

## ✅ Verificatie

Test of alles werkt:

```bash
# Test database connectie
node -e "const mysql = require('mysql2/promise'); mysql.createConnection({host: 'localhost', user: 'holwert_user', password: 'wachtwoord', database: 'holwert'}).then(c => {console.log('✅ Connected!'); c.end();})"

# Test API
curl http://localhost:3000/api/health
```

## 🆘 Troubleshooting

### "Access denied for user"
- Check of gebruiker bestaat: `SELECT User FROM mysql.user;`
- Check privileges: `SHOW GRANTS FOR 'holwert_user'@'%';`

### "Can't connect to MySQL server"
- Check of MySQL draait: `sudo systemctl status mysql`
- Check firewall: MySQL poort 3306 moet open zijn
- Check hostname/IP: gebruik `localhost` voor lokaal, IP voor remote

### "Table already exists"
- Script skipt automatisch bestaande tabellen
- Om opnieuw te beginnen: `DROP DATABASE holwert; CREATE DATABASE holwert;`

### "Foreign key constraint fails"
- Zorg dat tabellen in de juiste volgorde worden aangemaakt
- Script doet dit automatisch, maar check of alle tabellen bestaan

## 📞 Hulp Nodig?

Als je vastloopt, check:
1. MySQL logs: `sudo tail -f /var/log/mysql/error.log`
2. Script output voor specifieke foutmeldingen
3. Database connectie met: `mysql -u holwert_user -p holwert`

## 🎉 Klaar!

Na deze stappen zou je database volledig moeten werken. Test alle API endpoints om te verifiëren dat alles correct werkt.

