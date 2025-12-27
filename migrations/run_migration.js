const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// Check if we're using a local or remote database
const isLocalDB = !process.env.DATABASE_URL || 
                  process.env.DATABASE_URL.includes('localhost') || 
                  process.env.DATABASE_URL.includes('127.0.0.1');

const poolConfig = {
  connectionString: process.env.DATABASE_URL
};

// Only add SSL config for remote databases
if (!isLocalDB) {
  poolConfig.ssl = {
    rejectUnauthorized: false
  };
}

const pool = new Pool(poolConfig);

async function runMigration() {
  try {
    console.log('📦 Running push_tokens migration...');
    
    const sql = fs.readFileSync(path.join(__dirname, 'create_push_tokens.sql'), 'utf8');
    
    await pool.query(sql);
    
    console.log('✅ Migration completed successfully!');
    console.log('   - push_tokens table created');
    console.log('   - notification_history table created');
    console.log('   - Indexes created');
    
    // Verify tables
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('push_tokens', 'notification_history')
    `);
    
    console.log('\n📊 Created tables:');
    result.rows.forEach(row => {
      console.log('   -', row.table_name);
    });
    
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

runMigration();

