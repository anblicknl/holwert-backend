#!/usr/bin/env node

/**
 * Eenmalig script om het registratienummer (profile_number)
 * van de eerste gebruiker op '0001' te zetten.
 *
 * Gebruik:
 *   node scripts/set-profile-number-first-user.js
 *
 * Maakt gebruik van dezelfde DB-config als setup-mysql-database.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'holwert',
  multipleStatements: false,
  charset: 'utf8mb4',
};

async function main() {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Verbonden met database:', dbConfig.database);

    // Zorg dat de kolom profile_number bestaat
    try {
      await connection.execute(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_number'"
      );
    } catch (checkErr) {
      console.warn('⚠️ Kon kolom-informatie niet ophalen:', checkErr.message);
    }

    const [colRows] = await connection.execute(
      "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_number'"
    );
    if (!colRows[0] || colRows[0].cnt === 0) {
      console.log('ℹ️  Kolom profile_number bestaat nog niet, wordt nu aangemaakt en gevuld...');
      await connection.execute(
        "ALTER TABLE users ADD COLUMN profile_number VARCHAR(10) NULL"
      );
      await connection.execute(
        "UPDATE users SET profile_number = LPAD(id, 4, '0') WHERE profile_number IS NULL"
      );
      console.log('✅ Kolom profile_number aangemaakt en bestaande gebruikers ingevuld');
    }

    // Pak de eerste gewone gebruiker (dorpsbewoner, rol 'user', laagste id)
    const [rows] = await connection.execute(
      "SELECT id, email, profile_number, role FROM users WHERE role = 'user' ORDER BY id ASC LIMIT 1"
    );

    if (!rows || rows.length === 0) {
      console.log('⚠️ Geen gebruikers gevonden in de tabel users.');
      return;
    }

    const user = rows[0];
    console.log(
      `Gevonden eerste gebruiker: id=${user.id}, email=${user.email}, huidig profile_number=${user.profile_number}`
    );

    // Update naar '0001'
    const newProfileNumber = '0001';
    await connection.execute(
      'UPDATE users SET profile_number = ? WHERE id = ?',
      [newProfileNumber, user.id]
    );

    console.log(
      `✅ profile_number voor gebruiker id=${user.id} (${user.email}) is aangepast naar ${newProfileNumber}`
    );
  } catch (err) {
    console.error('❌ Fout bij aanpassen profile_number:', err.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();

