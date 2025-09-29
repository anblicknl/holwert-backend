const { testConnection, initDatabase } = require('../config/database');
require('dotenv').config();

async function initializeDatabase() {
  console.log('🚀 Initializing Holwert Database...\n');

  try {
    // Test database connection
    console.log('📡 Testing database connection...');
    await testConnection();

    // Initialize database tables
    console.log('🗄️  Creating database tables...');
    await initDatabase();

    console.log('\n✅ Database initialization completed successfully!');
    console.log('\n📋 Next steps:');
    console.log('1. Create your first superadmin user via the API');
    console.log('2. Create organizations for your admins');
    console.log('3. Start building your content!');
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Database initialization failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (require.main === module) {
  initializeDatabase();
}

module.exports = initializeDatabase;
