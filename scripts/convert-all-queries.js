#!/usr/bin/env node

/**
 * Converteert alle pool.query() calls naar executeQuery() in server.js
 */

const fs = require('fs');
const path = require('path');

const serverJsPath = path.join(__dirname, '..', 'server.js');

console.log('🔄 Converteer alle queries naar MySQL...\n');

let content = fs.readFileSync(serverJsPath, 'utf8');

// 1. Vervang alle pool.query( met executeQuery(
console.log('✅ pool.query( → executeQuery(');
content = content.replace(/pool\.query\(/g, 'executeQuery(');

// 2. Vervang alle $1, $2, $3 met ?
console.log('✅ $1, $2, $3 → ?');
// Dit wordt al gedaan door executeQuery helper functie, maar we kunnen het ook hier doen voor duidelijkheid
// content = content.replace(/\$(\d+)/g, '?'); // Niet nodig, helper functie doet dit

// 3. Vervang INSERT met RETURNING naar executeInsert
console.log('✅ INSERT met RETURNING → executeInsert');
content = content.replace(
  /const\s+result\s*=\s*await\s+executeQuery\(\s*`INSERT[^`]*RETURNING[^`]+`\s*,\s*\[([^\]]+)\]\)/g,
  (match, params) => {
    // Verwijder RETURNING clause
    const queryWithoutReturning = match.replace(/RETURNING[^`]+/i, '');
    return queryWithoutReturning.replace('executeQuery', 'executeInsert');
  }
);

// 4. Fix voor queries die result.rows gebruiken (al gedaan door helper)
// 5. Fix voor queries die result.rowCount gebruiken (al gedaan door helper)

fs.writeFileSync(serverJsPath, content, 'utf8');
console.log('\n✅ Conversie voltooid!');
console.log('⚠️  Controleer handmatig INSERT queries met RETURNING');

