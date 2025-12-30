#!/usr/bin/env node

/**
 * MySQL Database Setup Script
 * 
 * Dit script richt automatisch de MySQL database in met alle tabellen,
 * indexes en foreign keys die nodig zijn voor de Holwert app.
 * 
 * Gebruik:
 *   node scripts/setup-mysql-database.js
 * 
 * Of met environment variables:
 *   DB_HOST=localhost DB_USER=root DB_PASSWORD=password DB_NAME=holwert node scripts/setup-mysql-database.js
 */

const mysql = require('mysql2/promise');
require('dotenv').config();

// Database configuratie
const dbConfig = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'holwert',
  multipleStatements: true, // Voor meerdere queries in één keer
  charset: 'utf8mb4'
};

let connection;

// Helper functie om queries uit te voeren
async function executeQuery(query, params = []) {
  try {
    const [results] = await connection.execute(query, params);
    return results;
  } catch (error) {
    console.error(`❌ Query fout: ${error.message}`);
    console.error(`Query: ${query.substring(0, 100)}...`);
    throw error;
  }
}

// Helper functie om te checken of een tabel bestaat
async function tableExists(tableName) {
  try {
    const [results] = await connection.execute(
      `SELECT COUNT(*) as count FROM information_schema.tables 
       WHERE table_schema = ? AND table_name = ?`,
      [dbConfig.database, tableName]
    );
    return results[0].count > 0;
  } catch (error) {
    return false;
  }
}

// Helper functie om te checken of een index bestaat
async function indexExists(tableName, indexName) {
  try {
    const [results] = await connection.execute(
      `SELECT COUNT(*) as count FROM information_schema.statistics 
       WHERE table_schema = ? AND table_name = ? AND index_name = ?`,
      [dbConfig.database, tableName, indexName]
    );
    return results[0].count > 0;
  } catch (error) {
    return false;
  }
}

// Database aanmaken als deze niet bestaat
async function createDatabase() {
  try {
    // Connect zonder database te specificeren
    const tempConnection = await mysql.createConnection({
      host: dbConfig.host,
      port: dbConfig.port,
      user: dbConfig.user,
      password: dbConfig.password,
      multipleStatements: true
    });

    await tempConnection.execute(
      `CREATE DATABASE IF NOT EXISTS ${dbConfig.database} 
       CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
    
    await tempConnection.end();
    console.log(`✅ Database '${dbConfig.database}' bestaat of is aangemaakt`);
  } catch (error) {
    console.error(`❌ Fout bij aanmaken database: ${error.message}`);
    throw error;
  }
}

// Users tabel
async function createUsersTable() {
  if (await tableExists('users')) {
    console.log('⏭️  Tabel users bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) UNIQUE NOT NULL,
      password_hash VARCHAR(255) NOT NULL,
      first_name VARCHAR(100),
      last_name VARCHAR(100),
      role VARCHAR(20) DEFAULT 'user',
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_email (email),
      INDEX idx_users_role (role),
      INDEX idx_users_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel users aangemaakt');
}

// Organizations tabel
async function createOrganizationsTable() {
  if (await tableExists('organizations')) {
    console.log('⏭️  Tabel organizations bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE organizations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      category VARCHAR(50),
      description TEXT,
      bio TEXT,
      website VARCHAR(255),
      email VARCHAR(255),
      phone VARCHAR(20),
      whatsapp VARCHAR(20),
      address TEXT,
      facebook VARCHAR(255),
      instagram VARCHAR(255),
      twitter VARCHAR(255),
      linkedin VARCHAR(255),
      brand_color VARCHAR(7),
      logo_url TEXT,
      is_approved BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_organizations_name (name),
      INDEX idx_organizations_category (category),
      INDEX idx_organizations_approved (is_approved)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel organizations aangemaakt');
}

// News tabel
async function createNewsTable() {
  if (await tableExists('news')) {
    console.log('⏭️  Tabel news bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE news (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      content TEXT NOT NULL,
      excerpt TEXT,
      image_url TEXT,
      category VARCHAR(50),
      custom_category VARCHAR(100),
      author_id INT NOT NULL,
      organization_id INT,
      is_published BOOLEAN DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
      INDEX idx_news_author (author_id),
      INDEX idx_news_organization (organization_id),
      INDEX idx_news_published (is_published),
      INDEX idx_news_created (created_at DESC),
      INDEX idx_news_category (category)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel news aangemaakt');
}

// Events tabel
async function createEventsTable() {
  if (await tableExists('events')) {
    console.log('⏭️  Tabel events bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      event_date DATETIME NOT NULL,
      event_end_date DATETIME,
      location VARCHAR(255),
      location_details TEXT,
      organizer_id INT NOT NULL,
      organization_id INT,
      category VARCHAR(50) DEFAULT 'evenement',
      price DECIMAL(10,2) DEFAULT 0.00,
      max_attendees INT,
      image_url TEXT,
      status VARCHAR(20) DEFAULT 'scheduled',
      published_at DATETIME,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL,
      INDEX idx_events_organizer (organizer_id),
      INDEX idx_events_organization (organization_id),
      INDEX idx_events_date (event_date),
      INDEX idx_events_status (status)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel events aangemaakt');
}

// Bookmarks tabel
async function createBookmarksTable() {
  if (await tableExists('bookmarks')) {
    console.log('⏭️  Tabel bookmarks bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE bookmarks (
      user_id INT NOT NULL,
      news_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, news_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (news_id) REFERENCES news(id) ON DELETE CASCADE,
      INDEX idx_bookmarks_user (user_id),
      INDEX idx_bookmarks_news (news_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel bookmarks aangemaakt');
}

// Follows tabel
async function createFollowsTable() {
  if (await tableExists('follows')) {
    console.log('⏭️  Tabel follows bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE follows (
      user_id INT NOT NULL,
      organization_id INT NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (user_id, organization_id),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE,
      INDEX idx_follows_user (user_id),
      INDEX idx_follows_organization (organization_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel follows aangemaakt');
}

// Push tokens tabel
async function createPushTokensTable() {
  if (await tableExists('push_tokens')) {
    console.log('⏭️  Tabel push_tokens bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE push_tokens (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      token VARCHAR(255) UNIQUE NOT NULL,
      device_type VARCHAR(50),
      device_name VARCHAR(255),
      notification_preferences JSON DEFAULT ('{"news":true,"agenda":true,"organizations":true,"weather":true}'),
      is_active BOOLEAN DEFAULT true,
      last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      INDEX idx_push_tokens_user_id (user_id),
      INDEX idx_push_tokens_token (token),
      INDEX idx_push_tokens_active (is_active)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel push_tokens aangemaakt');
}

// Notification history tabel
async function createNotificationHistoryTable() {
  if (await tableExists('notification_history')) {
    console.log('⏭️  Tabel notification_history bestaat al, overslaan...');
    return;
  }

  await executeQuery(`
    CREATE TABLE notification_history (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT,
      push_token_id INT,
      notification_type VARCHAR(50),
      title VARCHAR(255),
      body TEXT,
      data JSON,
      status VARCHAR(50),
      error_message TEXT,
      sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      delivered_at TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (push_token_id) REFERENCES push_tokens(id) ON DELETE SET NULL,
      INDEX idx_notification_history_user_id (user_id),
      INDEX idx_notification_history_type (notification_type),
      INDEX idx_notification_history_sent_at (sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  
  console.log('✅ Tabel notification_history aangemaakt');
}

// Hoofdfunctie
async function setupDatabase() {
  console.log('🚀 MySQL Database Setup Script');
  console.log('================================\n');
  console.log(`Database: ${dbConfig.database}`);
  console.log(`Host: ${dbConfig.host}:${dbConfig.port}`);
  console.log(`User: ${dbConfig.user}\n`);

  try {
    // Database aanmaken
    await createDatabase();

    // Connectie maken met database
    connection = await mysql.createConnection(dbConfig);
    console.log('✅ Verbonden met database\n');

    // Tabellen aanmaken
    console.log('📦 Tabellen aanmaken...\n');
    await createUsersTable();
    await createOrganizationsTable();
    await createNewsTable();
    await createEventsTable();
    await createBookmarksTable();
    await createFollowsTable();
    await createPushTokensTable();
    await createNotificationHistoryTable();

    console.log('\n✅ Database setup voltooid!');
    console.log('\n📝 Volgende stappen:');
    console.log('1. Update DATABASE_URL in .env en Vercel');
    console.log('2. Update server.js om mysql2 te gebruiken in plaats van pg');
    console.log('3. Test de API endpoints');

  } catch (error) {
    console.error('\n❌ Fout bij setup:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    if (connection) {
      await connection.end();
      console.log('\n🔌 Database verbinding gesloten');
    }
  }
}

// Script uitvoeren
setupDatabase();

