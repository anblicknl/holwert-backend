/**
 * Eenmalig uitvoeren: voegt kolom organization_id toe aan users (voor organisatieportaal).
 * Gebruik: node scripts/add-organization-id-to-users.js
 * Vereist: .env met database config (zoals de rest van de backend).
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function main() {
  const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10
  });

  try {
    const [cols] = await pool.execute(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'organization_id'"
    );
    if (cols && cols.length > 0) {
      console.log('Kolom users.organization_id bestaat al.');
      process.exit(0);
      return;
    }
    await pool.execute('ALTER TABLE users ADD COLUMN organization_id INT NULL');
    console.log('Kolom users.organization_id toegevoegd.');
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
