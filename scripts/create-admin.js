const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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

async function createAdminUser() {
  try {
    console.log('🔧 Creating admin user...');
    
    const email = 'admin@holwert.nl';
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if admin already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );
    
    if (existingUser.rows.length > 0) {
      console.log('⚠️  Admin user already exists. Updating password...');
      
      await pool.query(
        'UPDATE users SET password = $1, role = $2, is_active = true WHERE email = $3',
        [hashedPassword, 'admin', email]
      );
      
      console.log('✅ Admin password updated!');
    } else {
      console.log('📝 Creating new admin user...');
      
      await pool.query(
        `INSERT INTO users (email, password, first_name, last_name, role, is_active)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [email, hashedPassword, 'Admin', 'Holwert', 'admin', true]
      );
      
      console.log('✅ Admin user created!');
    }
    
    console.log('\n📋 Admin credentials:');
    console.log('   Email: admin@holwert.nl');
    console.log('   Password: admin123');
    console.log('\n⚠️  Change the password after first login!\n');
    
  } catch (error) {
    console.error('❌ Error creating admin user:', error.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

createAdminUser();

