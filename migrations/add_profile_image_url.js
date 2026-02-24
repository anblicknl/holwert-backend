#!/usr/bin/env node
/**
 * Migratie: voeg profile_image_url kolom toe aan users tabel
 * 
 * Gebruik: node migrations/add_profile_image_url.js
 * Of: DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... node migrations/add_profile_image_url.js
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'holwert',
};

async function runMigration() {
  let connection;
  try {
    connection = await mysql.createConnection(dbConfig);
    
    // Check if column already exists
    const [columns] = await connection.execute(
      `SELECT COLUMN_NAME FROM information_schema.COLUMNS 
       WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_image_url'`,
      [dbConfig.database]
    );

    if (columns.length > 0) {
      console.log('✅ Kolom profile_image_url bestaat al in users tabel');
      return;
    }

    await connection.execute(
      'ALTER TABLE users ADD COLUMN profile_image_url TEXT NULL AFTER last_name'
    );
    console.log('✅ Kolom profile_image_url toegevoegd aan users tabel');
  } catch (error) {
    if (error.code === 'ER_DUP_FIELDNAME') {
      console.log('✅ Kolom profile_image_url bestaat al');
      return;
    }
    console.error('❌ Migratie mislukt:', error.message);
    process.exit(1);
  } finally {
    if (connection) await connection.end();
  }
}

runMigration();
