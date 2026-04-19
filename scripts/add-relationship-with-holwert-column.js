#!/usr/bin/env node

/**
 * Script om de kolom `relationship_with_holwert` toe te voegen aan de `users`-tabel
 * als deze nog niet bestaat.
 *
 * Gebruik:
 *   node scripts/add-relationship-with-holwert-column.js
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

    const [rows] = await connection.execute(
      "SELECT COUNT(*) AS cnt FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'relationship_with_holwert'"
    );

    if (rows[0] && rows[0].cnt > 0) {
      console.log('ℹ️  Kolom relationship_with_holwert bestaat al, niets te doen.');
      return;
    }

    console.log('ℹ️  Kolom relationship_with_holwert bestaat nog niet, wordt nu aangemaakt...');
    await connection.execute(
      "ALTER TABLE users ADD COLUMN relationship_with_holwert VARCHAR(50) NULL"
    );
    console.log('✅ Kolom relationship_with_holwert toegevoegd aan users');
  } catch (err) {
    console.error('❌ Fout bij toevoegen relationship_with_holwert-kolom:', err.message);
    process.exitCode = 1;
  } finally {
    if (connection) {
      await connection.end();
    }
  }
}

main();

