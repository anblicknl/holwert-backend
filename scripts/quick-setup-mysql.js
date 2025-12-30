#!/usr/bin/env node

/**
 * Quick Setup Script voor MySQL Database
 * 
 * Dit script gebruikt de opgegeven credentials om de database in te richten.
 * 
 * Gebruik:
 *   node scripts/quick-setup-mysql.js
 */

const mysql = require('mysql2/promise');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Database credentials (van gebruiker)
const DB_CONFIG = {
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 3306,
  user: 'db_holwert',
  password: 'h0lwert.2026',
  database: 'appenvlo_holwert',
  multipleStatements: true,
  charset: 'utf8mb4'
};

console.log('🚀 Quick Setup - MySQL Database');
console.log('================================\n');
console.log(`Database: ${DB_CONFIG.database}`);
console.log(`Host: ${DB_CONFIG.host}:${DB_CONFIG.port}`);
console.log(`User: ${DB_CONFIG.user}\n`);

// .env bestand maken/updaten
function createEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  const envContent = `# MySQL Database Configuratie
DB_HOST=${DB_CONFIG.host}
DB_PORT=${DB_CONFIG.port}
DB_USER=${DB_CONFIG.user}
DB_PASSWORD=${DB_CONFIG.password}
DB_NAME=${DB_CONFIG.database}

# Alternatieve namen
MYSQL_HOST=${DB_CONFIG.host}
MYSQL_PORT=${DB_CONFIG.port}
MYSQL_USER=${DB_CONFIG.user}
MYSQL_PASSWORD=${DB_CONFIG.password}
MYSQL_DATABASE=${DB_CONFIG.database}

# JWT Secret (pas aan voor production!)
JWT_SECRET=holwert-secret-key-change-in-production

# Node Environment
NODE_ENV=production
`;

  if (fs.existsSync(envPath)) {
    console.log('⚠️  .env bestand bestaat al, overslaan...');
    console.log('   Controleer of de credentials correct zijn!\n');
  } else {
    fs.writeFileSync(envPath, envContent);
    console.log('✅ .env bestand aangemaakt\n');
  }
}

// Database setup uitvoeren
async function setupDatabase() {
  let connection;
  
  try {
    // Test connectie
    console.log('🔌 Testen database connectie...');
    connection = await mysql.createConnection({
      host: DB_CONFIG.host,
      port: DB_CONFIG.port,
      user: DB_CONFIG.user,
      password: DB_CONFIG.password,
      database: DB_CONFIG.database
    });
    console.log('✅ Verbonden met database!\n');
    await connection.end();

    // Zet environment variables voor het setup script
    process.env.DB_HOST = DB_CONFIG.host;
    process.env.DB_PORT = DB_CONFIG.port.toString();
    process.env.DB_USER = DB_CONFIG.user;
    process.env.DB_PASSWORD = DB_CONFIG.password;
    process.env.DB_NAME = DB_CONFIG.database;
    
    // Roep het hoofd setup script aan
    console.log('📦 Database setup uitvoeren...\n');
    require('./setup-mysql-database.js');

  } catch (error) {
    console.error('\n❌ Fout bij setup:', error.message);
    
    if (error.code === 'ER_ACCESS_DENIED_ERROR') {
      console.error('\n💡 Mogelijke oplossingen:');
      console.error('   - Check of gebruikersnaam en wachtwoord correct zijn');
      console.error('   - Check of de gebruiker rechten heeft op de database');
      console.error('   - Check of de hostname correct is (meestal localhost voor shared hosting)');
    } else if (error.code === 'ECONNREFUSED') {
      console.error('\n💡 Mogelijke oplossingen:');
      console.error('   - Check of MySQL server draait');
      console.error('   - Check of de poort correct is (meestal 3306)');
      console.error('   - Check of de hostname correct is');
    } else if (error.code === 'ER_BAD_DB_ERROR') {
      console.error('\n💡 Database bestaat niet. Maak deze eerst aan in je hosting control panel.');
    }
    
    process.exit(1);
  }
}

// Main
async function main() {
  try {
    // .env bestand maken
    createEnvFile();
    
    // Database setup
    await setupDatabase();
    
    console.log('\n✅ Setup voltooid!');
    console.log('\n📝 Volgende stappen:');
    console.log('1. Review .env bestand (credentials zijn al ingevuld)');
    console.log('2. Update server.js om MySQL te gebruiken (zie MYSQL_SETUP_GUIDE.md)');
    console.log('3. Test de API endpoints');
    console.log('4. Update Vercel environment variables voor production');
    
  } catch (error) {
    console.error('\n❌ Setup gefaald:', error.message);
    process.exit(1);
  }
}

main();

