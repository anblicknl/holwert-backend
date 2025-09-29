const { pool } = require('../config/database');
const { logSystemEvent } = require('../utils/logger');

// Database optimization script
async function optimizeDatabase() {
  console.log('🔧 Starting database optimization...');
  
  try {
    // Create indexes for better performance
    const indexes = [
      // Users table indexes
      'CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)',
      'CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)',
      'CREATE INDEX IF NOT EXISTS idx_users_organization_id ON users(organization_id)',
      'CREATE INDEX IF NOT EXISTS idx_users_is_active ON users(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_users_created_at ON users(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_users_last_login ON users(last_login)',
      'CREATE INDEX IF NOT EXISTS idx_users_name_search ON users(first_name, last_name)',
      
      // Organizations table indexes
      'CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name)',
      'CREATE INDEX IF NOT EXISTS idx_organizations_type ON organizations(type)',
      'CREATE INDEX IF NOT EXISTS idx_organizations_is_active ON organizations(is_active)',
      'CREATE INDEX IF NOT EXISTS idx_organizations_created_at ON organizations(created_at)',
      
      // News table indexes
      'CREATE INDEX IF NOT EXISTS idx_news_title ON news(title)',
      'CREATE INDEX IF NOT EXISTS idx_news_category ON news(category)',
      'CREATE INDEX IF NOT EXISTS idx_news_is_published ON news(is_published)',
      'CREATE INDEX IF NOT EXISTS idx_news_organization_id ON news(organization_id)',
      'CREATE INDEX IF NOT EXISTS idx_news_created_at ON news(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_news_publish_date ON news(publish_date)',
      'CREATE INDEX IF NOT EXISTS idx_news_content_search ON news(title, excerpt)',
      
      // Events table indexes
      'CREATE INDEX IF NOT EXISTS idx_events_title ON events(title)',
      'CREATE INDEX IF NOT EXISTS idx_events_category ON events(category)',
      'CREATE INDEX IF NOT EXISTS idx_events_start_date ON events(start_date)',
      'CREATE INDEX IF NOT EXISTS idx_events_end_date ON events(end_date)',
      'CREATE INDEX IF NOT EXISTS idx_events_is_approved ON events(is_approved)',
      'CREATE INDEX IF NOT EXISTS idx_events_organization_id ON events(organization_id)',
      'CREATE INDEX IF NOT EXISTS idx_events_location ON events(location)',
      'CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at)',
      
      // Found/Lost table indexes
      'CREATE INDEX IF NOT EXISTS idx_found_lost_type ON found_lost(type)',
      'CREATE INDEX IF NOT EXISTS idx_found_lost_category ON found_lost(category)',
      'CREATE INDEX IF NOT EXISTS idx_found_lost_is_resolved ON found_lost(is_resolved)',
      'CREATE INDEX IF NOT EXISTS idx_found_lost_is_approved ON found_lost(is_approved)',
      'CREATE INDEX IF NOT EXISTS idx_found_lost_location ON found_lost(location)',
      'CREATE INDEX IF NOT EXISTS idx_found_lost_created_at ON found_lost(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_found_lost_title ON found_lost(title)',
      
      // User sessions table indexes (if exists)
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_token ON user_sessions(token)',
      'CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at)',
      
      // Audit logs table indexes (if exists)
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_action ON audit_logs(action)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at)',
      'CREATE INDEX IF NOT EXISTS idx_audit_logs_table_name ON audit_logs(table_name)'
    ];

    console.log('📊 Creating database indexes...');
    
    for (const indexQuery of indexes) {
      try {
        await pool.execute(indexQuery);
        console.log(`✅ Created index: ${indexQuery.split(' ')[5]}`);
      } catch (error) {
        if (error.code === 'ER_DUP_KEYNAME') {
          console.log(`⏭️  Index already exists: ${indexQuery.split(' ')[5]}`);
        } else {
          console.log(`⚠️  Warning creating index: ${error.message}`);
        }
      }
    }

    // Analyze tables for better query optimization
    console.log('📈 Analyzing tables for optimization...');
    
    const tables = ['users', 'organizations', 'news', 'events', 'found_lost'];
    
    for (const table of tables) {
      try {
        await pool.execute(`ANALYZE TABLE ${table}`);
        console.log(`✅ Analyzed table: ${table}`);
      } catch (error) {
        console.log(`⚠️  Warning analyzing table ${table}: ${error.message}`);
      }
    }

    // Create full-text search indexes for better search performance
    console.log('🔍 Creating full-text search indexes...');
    
    const fullTextIndexes = [
      'ALTER TABLE news ADD FULLTEXT(title, content, excerpt)',
      'ALTER TABLE events ADD FULLTEXT(title, description, location)',
      'ALTER TABLE found_lost ADD FULLTEXT(title, description, location)',
      'ALTER TABLE organizations ADD FULLTEXT(name, description)'
    ];

    for (const ftIndex of fullTextIndexes) {
      try {
        await pool.execute(ftIndex);
        console.log(`✅ Created full-text index for: ${ftIndex.split(' ')[2]}`);
      } catch (error) {
        if (error.code === 'ER_DUP_KEYNAME' || error.message.includes('Duplicate key name')) {
          console.log(`⏭️  Full-text index already exists for: ${ftIndex.split(' ')[2]}`);
        } else {
          console.log(`⚠️  Warning creating full-text index: ${error.message}`);
        }
      }
    }

    // Optimize tables
    console.log('⚡ Optimizing tables...');
    
    for (const table of tables) {
      try {
        await pool.execute(`OPTIMIZE TABLE ${table}`);
        console.log(`✅ Optimized table: ${table}`);
      } catch (error) {
        console.log(`⚠️  Warning optimizing table ${table}: ${error.message}`);
      }
    }

    // Create views for common queries
    console.log('👁️  Creating optimized views...');
    
    const views = [
      `CREATE OR REPLACE VIEW active_users AS
       SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.organization_id,
              u.profile_image, u.phone, u.email_verified, u.created_at, u.last_login,
              o.name as organization_name, o.type as organization_type
       FROM users u
       LEFT JOIN organizations o ON u.organization_id = o.id
       WHERE u.is_active = 1`,

      `CREATE OR REPLACE VIEW published_news AS
       SELECT n.id, n.title, n.excerpt, n.content, n.category, n.publish_date, n.created_at,
              o.name as organization_name, o.type as organization_type,
              u.first_name as author_first_name, u.last_name as author_last_name
       FROM news n
       LEFT JOIN organizations o ON n.organization_id = o.id
       LEFT JOIN users u ON n.created_by = u.id
       WHERE n.is_published = 1`,

      `CREATE OR REPLACE VIEW upcoming_events AS
       SELECT e.id, e.title, e.description, e.start_date, e.end_date, e.location, e.category,
              e.max_attendees, e.created_at,
              o.name as organization_name, o.type as organization_type
       FROM events e
       LEFT JOIN organizations o ON e.organization_id = o.id
       WHERE e.start_date >= CURDATE() AND e.is_approved = 1`,

      `CREATE OR REPLACE VIEW pending_content AS
       SELECT 'news' as type, n.id, n.title, n.created_at, o.name as organization_name
       FROM news n
       LEFT JOIN organizations o ON n.organization_id = o.id
       WHERE n.is_published = 0
       
       UNION ALL
       
       SELECT 'event' as type, e.id, e.title, e.created_at, o.name as organization_name
       FROM events e
       LEFT JOIN organizations o ON e.organization_id = o.id
       WHERE e.is_approved = 0
       
       UNION ALL
       
       SELECT 'found_lost' as type, fl.id, fl.title, fl.created_at, NULL as organization_name
       FROM found_lost fl
       WHERE fl.is_approved = 0
       
       ORDER BY created_at DESC`
    ];

    for (const viewQuery of views) {
      try {
        await pool.execute(viewQuery);
        console.log(`✅ Created view: ${viewQuery.split(' ')[5]}`);
      } catch (error) {
        console.log(`⚠️  Warning creating view: ${error.message}`);
      }
    }

    // Create stored procedures for common operations
    console.log('⚙️  Creating stored procedures...');
    
    const procedures = [
      `CREATE OR REPLACE PROCEDURE GetUserStats()
       BEGIN
         SELECT 
           COUNT(*) as total_users,
           COUNT(CASE WHEN is_active = 1 THEN 1 END) as active_users,
           COUNT(CASE WHEN role = 'admin' THEN 1 END) as admin_users,
           COUNT(CASE WHEN role = 'superadmin' THEN 1 END) as superadmin_users,
           COUNT(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as new_users_30d
         FROM users;
       END`,

      `CREATE OR REPLACE PROCEDURE GetContentStats()
       BEGIN
         SELECT 
           (SELECT COUNT(*) FROM news WHERE is_published = 1) as published_news,
           (SELECT COUNT(*) FROM news WHERE is_published = 0) as pending_news,
           (SELECT COUNT(*) FROM events WHERE is_approved = 1 AND start_date >= CURDATE()) as upcoming_events,
           (SELECT COUNT(*) FROM events WHERE is_approved = 0) as pending_events,
           (SELECT COUNT(*) FROM found_lost WHERE is_resolved = 0) as open_found_lost,
           (SELECT COUNT(*) FROM found_lost WHERE is_approved = 0) as pending_found_lost;
       END`
    ];

    for (const procedureQuery of procedures) {
      try {
        await pool.execute(procedureQuery);
        console.log(`✅ Created stored procedure: ${procedureQuery.split(' ')[5]}`);
      } catch (error) {
        console.log(`⚠️  Warning creating stored procedure: ${error.message}`);
      }
    }

    logSystemEvent('database_optimization_completed', {
      indexesCreated: indexes.length,
      tablesAnalyzed: tables.length,
      viewsCreated: views.length,
      proceduresCreated: procedures.length
    });

    console.log('🎉 Database optimization completed successfully!');
    console.log('📊 Performance improvements:');
    console.log('   - Added indexes for faster queries');
    console.log('   - Created full-text search indexes');
    console.log('   - Optimized table structures');
    console.log('   - Created views for common queries');
    console.log('   - Added stored procedures for statistics');

  } catch (error) {
    console.error('❌ Database optimization failed:', error);
    logSystemEvent('database_optimization_failed', { error: error.message });
    process.exit(1);
  } finally {
    await pool.end();
  }
}

// Run optimization if called directly
if (require.main === module) {
  optimizeDatabase();
}

module.exports = { optimizeDatabase };
