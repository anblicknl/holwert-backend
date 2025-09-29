# Holwert Backend Setup Guide

## Stap 1: Node.js Installeren

### Optie A: Via Homebrew (Aanbevolen)
```bash
# Installeer Homebrew (als je het nog niet hebt)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Installeer Node.js
brew install node

# Controleer installatie
node --version
npm --version
```

### Optie B: Via NVM (Node Version Manager)
```bash
# Installeer NVM
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash

# Herstart terminal of run:
source ~/.bashrc

# Installeer Node.js
nvm install node
nvm use node
```

## Stap 2: MySQL Database Setup

### Optie A: Via Homebrew
```bash
# Installeer MySQL
brew install mysql

# Start MySQL service
brew services start mysql

# Maak database aan
mysql -u root -p
CREATE DATABASE holwert_db;
```

### Optie B: Via XAMPP/MAMP
- Download en installeer XAMPP of MAMP
- Start MySQL service
- Maak database `holwert_db` aan via phpMyAdmin

## Stap 3: Backend Configureren

1. **Kopieer environment file:**
```bash
cp env.example .env
```

2. **Bewerk .env met je database credentials:**
```env
DB_HOST=localhost
DB_USER=root
DB_PASSWORD=your_mysql_password
DB_NAME=holwert_db
JWT_SECRET=your_super_secret_jwt_key_here
PORT=3000
NODE_ENV=development
```

## Stap 4: Dependencies Installeren

```bash
npm install
```

## Stap 5: Database Initialiseren

```bash
npm run init-db
```

## Stap 6: Eerste Superadmin Aanmaken

```bash
node scripts/create-superadmin.js
```

## Stap 7: Backend Starten

```bash
# Development mode
npm run dev

# Of production mode
npm start
```

## Stap 8: Webinterface Testen

1. Open `holwert-web/index.html` in je browser
2. Log in met de superadmin credentials die je hebt aangemaakt

## Troubleshooting

### Node.js niet gevonden
- Herstart je terminal
- Controleer of Node.js in je PATH staat: `which node`

### Database connection failed
- Controleer of MySQL draait
- Verificeer database credentials in .env
- Controleer of database `holwert_db` bestaat

### Port 3000 al in gebruik
- Wijzig PORT in .env naar een andere poort (bijv. 3001)
- Of stop de service die poort 3000 gebruikt

## Default Login Credentials

Na het aanmaken van de eerste superadmin:
- **Email**: admin@holwert.nl
- **Password**: admin123

**⚠️ Belangrijk: Wijzig deze credentials direct na eerste login!**
