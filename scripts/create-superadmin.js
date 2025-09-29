const bcrypt = require('bcryptjs');
const { pool, testConnection } = require('../config/database');
require('dotenv').config();

async function createSuperAdmin() {
    console.log('🚀 Creating first Superadmin user...\n');

    try {
        // Test database connection
        console.log('📡 Testing database connection...');
        await testConnection();

        // Check if superadmin already exists
        const [existingAdmins] = await pool.execute(
            'SELECT id FROM users WHERE role = "superadmin"'
        );

        if (existingAdmins.length > 0) {
            console.log('⚠️  Superadmin user already exists!');
            console.log('   If you want to create a new one, delete the existing superadmin first.');
            process.exit(0);
        }

        // Create superadmin user
        const email = 'admin@holwert.nl';
        const password = 'admin123';
        const firstName = 'Super';
        const lastName = 'Admin';

        // Hash password
        const saltRounds = 12;
        const hashedPassword = await bcrypt.hash(password, saltRounds);

        // Insert superadmin
        const [result] = await pool.execute(
            'INSERT INTO users (email, password, first_name, last_name, role, is_active, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [email, hashedPassword, firstName, lastName, 'superadmin', true, true]
        );

        console.log('✅ Superadmin user created successfully!');
        console.log('\n📋 Login Credentials:');
        console.log(`   Email: ${email}`);
        console.log(`   Password: ${password}`);
        console.log('\n⚠️  IMPORTANT: Change these credentials after first login!');
        console.log('\n🌐 You can now:');
        console.log('   1. Start the backend: npm start');
        console.log('   2. Open the webinterface: holwert-web/index.html');
        console.log('   3. Log in with the credentials above');
        
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Failed to create superadmin:', error.message);
        process.exit(1);
    }
}

// Run if called directly
if (require.main === module) {
    createSuperAdmin();
}

module.exports = createSuperAdmin;
