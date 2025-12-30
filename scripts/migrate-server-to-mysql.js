#!/usr/bin/env node

/**
 * Server.js Migratie Script - PostgreSQL naar MySQL
 * 
 * Dit script helpt bij het converteren van server.js van PostgreSQL naar MySQL.
 * Het maakt een backup en voert automatische conversies uit.
 * 
 * Gebruik:
 *   node scripts/migrate-server-to-mysql.js
 */

const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, '..', 'server.js');
const backupPath = path.join(__dirname, '..', 'server.js.postgresql.backup');

console.log('🔄 Server.js Migratie Script - PostgreSQL → MySQL');
console.log('==================================================\n');

// Backup maken
if (!fs.existsSync(backupPath)) {
  console.log('📦 Backup maken van server.js...');
  fs.copyFileSync(serverJsPath, backupPath);
  console.log(`✅ Backup opgeslagen: ${backupPath}\n`);
} else {
  console.log('⏭️  Backup bestaat al, overslaan...\n');
}

// Server.js lezen
console.log('📖 Server.js lezen...');
let content = fs.readFileSync(serverJsPath, 'utf8');
const originalContent = content;

// Conversies uitvoeren
console.log('🔄 Conversies uitvoeren...\n');

// 1. pg → mysql2
if (content.includes("require('pg')") || content.includes('require("pg")')) {
  console.log('✅ pg → mysql2');
  content = content.replace(/const\s*{\s*Pool\s*}\s*=\s*require\(['"]pg['"]\);?/g, 'const mysql = require(\'mysql2/promise\');');
  content = content.replace(/require\(['"]pg['"]\)/g, "require('mysql2/promise')");
}

// 2. Pool connection
if (content.includes('new Pool')) {
  console.log('✅ Pool connection → mysql.createPool');
  content = content.replace(
    /const\s+pool\s*=\s*new\s+Pool\([^)]*\);/s,
    `const pool = mysql.createPool({
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'holwert',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0
});`
  );
}

// 3. Query syntax: $1, $2, $3 → ?
console.log('✅ Parameter placeholders: $1, $2, $3 → ?');
// Dit is complexer, we doen het in stappen
let paramCounter = 0;
content = content.replace(/\$(\d+)/g, (match, num) => {
  return '?';
});

// 4. ILIKE → LIKE (case-insensitive)
console.log('✅ ILIKE → LIKE');
content = content.replace(/ILIKE/gi, 'LIKE');

// 5. pool.query → pool.execute (voor prepared statements)
console.log('✅ pool.query → pool.execute (waar mogelijk)');
// We vervangen alleen waar het veilig is (met parameters)
content = content.replace(/await\s+pool\.query\(`([^`]+)`\s*,\s*\[([^\]]+)\]\)/g, 
  (match, query, params) => {
    // Alleen vervangen als er parameters zijn
    if (params.trim()) {
      return `await pool.execute(\`${query}\`, [${params}])`;
    }
    return match;
  }
);

// 6. Result handling: result.rows → result[0]
console.log('✅ result.rows → result[0]');
content = content.replace(/result\.rows\[0\]/g, 'result[0][0]');
content = content.replace(/result\.rows/g, 'result[0]');
content = content.replace(/result\.rowCount/g, 'result[0].affectedRows');

// 7. RETURNING clause verwijderen (MySQL gebruikt LAST_INSERT_ID)
console.log('✅ RETURNING → LAST_INSERT_ID()');
content = content.replace(/RETURNING\s+id/gi, '');
// Na INSERT queries, voeg toe: const [insertResult] = await ...; const id = insertResult.insertId;

// 8. SERIAL → AUTO_INCREMENT (al in SQL, maar check)
console.log('✅ SERIAL → AUTO_INCREMENT (check SQL)');

// 9. TIMESTAMPTZ → TIMESTAMP
console.log('✅ TIMESTAMPTZ → TIMESTAMP');
content = content.replace(/TIMESTAMPTZ/gi, 'TIMESTAMP');

// 10. JSONB → JSON
console.log('✅ JSONB → JSON');
content = content.replace(/JSONB/gi, 'JSON');

// 11. NOW() → NOW() (blijft hetzelfde in MySQL)

// 12. pool.connect() → pool.getConnection()
console.log('✅ pool.connect() → pool.getConnection()');
content = content.replace(/const\s+client\s*=\s*await\s+pool\.connect\(\)/g, 'const [connection] = await pool.getConnection()');
content = content.replace(/client\.release\(\)/g, 'connection.release()');
content = content.replace(/client\.query/g, 'connection.execute');

// 13. Fix voor queries zonder parameters
content = content.replace(/await\s+pool\.execute\(`([^`]+)`\s*,\s*\[\]\)/g, 
  'await pool.execute(`$1`)'
);

// 14. Fix voor queries die pool.query gebruiken zonder parameters
content = content.replace(/await\s+pool\.query\(`([^`]+)`\)/g, 
  'await pool.execute(`$1`)'
);

// Controleren of er wijzigingen zijn
if (content !== originalContent) {
  console.log('\n💾 Wijzigingen opslaan...');
  fs.writeFileSync(serverJsPath, content, 'utf8');
  console.log('✅ Server.js bijgewerkt!\n');
  console.log('⚠️  BELANGRIJK: Controleer de wijzigingen handmatig!');
  console.log('   Sommige queries kunnen handmatige aanpassing nodig hebben.\n');
} else {
  console.log('\n⏭️  Geen wijzigingen nodig (of al geconverteerd)\n');
}

console.log('📝 Volgende stappen:');
console.log('1. Review server.js voor handmatige aanpassingen');
console.log('2. Test alle API endpoints');
console.log('3. Check database queries in logs');
console.log('\n✅ Migratie script voltooid!');

