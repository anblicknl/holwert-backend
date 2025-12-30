# MySQL Quick Start - Holwert App

## 🎯 Je Database Credentials

Je hebt al een MySQL database op je shared hosting:
- **Database:** `appenvlo_holwert`
- **Gebruiker:** `db_holwert`
- **Wachtwoord:** `h0lwert.2026`
- **Host:** Meestal `localhost` (check je hosting control panel)

## 🚀 Stap-voor-Stap Setup

### Stap 1: Dependencies Installeren

```bash
cd holwert-backend
npm install
```

Dit installeert `mysql2` (al toegevoegd aan package.json).

### Stap 2: Database Setup Uitvoeren

Er zijn twee opties:

#### Optie A: Quick Setup (aanbevolen)
```bash
node scripts/quick-setup-mysql.js
```

Dit script:
- Maakt automatisch `.env` bestand aan met je credentials
- Richt de database in met alle tabellen
- Test de connectie

#### Optie B: Handmatige Setup
```bash
# Maak .env bestand aan (of pas aan)
# Zie .env.mysql.example voor voorbeeld

# Voer database setup uit
node scripts/setup-mysql-database.js
```

### Stap 3: Server.js Aanpassen voor MySQL

De backend gebruikt nu nog PostgreSQL. We moeten dit aanpassen:

```bash
# Automatische conversie (maakt backup)
node scripts/migrate-server-to-mysql.js
```

**⚠️ BELANGRIJK:** Review de code handmatig na conversie!

### Stap 4: Testen

```bash
# Start server lokaal
npm start

# Test API
curl http://localhost:3000/api/health
```

### Stap 5: Vercel Environment Variables

Voor production, update Vercel:

1. Ga naar Vercel Dashboard → Project → Settings → Environment Variables
2. Voeg toe:
   - `DB_HOST` = `localhost` (of je MySQL server hostname)
   - `DB_PORT` = `3306`
   - `DB_USER` = `db_holwert`
   - `DB_PASSWORD` = `h0lwert.2026`
   - `DB_NAME` = `appenvlo_holwert`

3. Redeploy de backend

## ✅ Wat wordt aangemaakt?

Het setup script maakt automatisch aan:
- ✅ `users` tabel
- ✅ `organizations` tabel
- ✅ `news` tabel
- ✅ `events` tabel
- ✅ `bookmarks` tabel
- ✅ `follows` tabel
- ✅ `push_tokens` tabel
- ✅ `notification_history` tabel
- ✅ Alle indexes voor performance
- ✅ Alle foreign keys

## 🆘 Troubleshooting

### "Access denied for user"
- Check of gebruikersnaam en wachtwoord correct zijn
- Check of de gebruiker rechten heeft op de database
- Check je hosting control panel voor de juiste credentials

### "Can't connect to MySQL server"
- Check of MySQL draait op je hosting
- Check of de hostname correct is (meestal `localhost` voor shared hosting)
- Check of poort 3306 open is

### "Database doesn't exist"
- Database moet al bestaan op je hosting
- Check je hosting control panel

## 📞 Hulp Nodig?

Als je vastloopt, check:
1. Je hosting control panel voor MySQL credentials
2. De error messages in de console
3. Of de database al bestaat en toegankelijk is

## 🎉 Klaar!

Na deze stappen zou alles moeten werken. De admin panel blijft werken zoals het nu doet - alleen de backend gebruikt nu MySQL in plaats van PostgreSQL.

