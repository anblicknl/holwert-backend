# MySQL Migratie Scripts

Deze scripts helpen je bij het migreren van PostgreSQL (Supabase) naar MySQL.

## 📁 Bestanden

- **`setup-mysql-database.js`** - Richt automatisch de MySQL database in
- **`migrate-server-to-mysql.js`** - Converteert server.js van PostgreSQL naar MySQL syntax

## 🚀 Quick Start

### Stap 1: MySQL Installeren

Zie `MYSQL_SETUP_GUIDE.md` voor gedetailleerde instructies.

### Stap 2: Dependencies Installeren

```bash
npm install mysql2
```

### Stap 3: Environment Variables Instellen

Maak/update `.env`:
```env
DB_HOST=localhost
DB_PORT=3306
DB_USER=holwert_user
DB_PASSWORD=jouw_wachtwoord
DB_NAME=holwert
```

### Stap 4: Database Setup

```bash
node scripts/setup-mysql-database.js
```

Dit maakt automatisch alle tabellen, indexes en foreign keys aan.

### Stap 5: Server.js Converteren (optioneel)

```bash
node scripts/migrate-server-to-mysql.js
```

**Let op:** Dit script maakt automatische conversies, maar je moet de code handmatig reviewen!

## 📖 Gedetailleerde Documentatie

- **`../MYSQL_SETUP_GUIDE.md`** - Complete setup guide
- **`../MYSQL_MIGRATION_ADVICE.md`** - Overwegingen en advies

## ⚠️ Belangrijk

1. **Backup maken** voordat je begint
2. **Test grondig** na migratie
3. **Review code** - automatische conversies zijn niet perfect
4. **Update Vercel** environment variables voor production

## 🆘 Hulp Nodig?

Check de troubleshooting sectie in `MYSQL_SETUP_GUIDE.md` of vraag om hulp!

