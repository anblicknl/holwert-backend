const mysql = require('mysql2/promise');
require('dotenv').config();

const dbConfig = {
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'holwert_db',
  port: process.env.DB_PORT || 3306,
  waitForConnections: true,
  connectionLimit: 5, // Reduced for shared hosting
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  // Shared hosting specific settings
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false,
  charset: 'utf8mb4'
};

// Create connection pool
const pool = mysql.createPool(dbConfig);

// Test database connection
const testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    console.log('✅ Database connected successfully');
    connection.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
    process.exit(1);
  }
};

// Initialize database tables
const initDatabase = async () => {
  try {
    const connection = await pool.getConnection();
    
    // Organizations table (must be created first)
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS organizations (
        id INT PRIMARY KEY AUTO_INCREMENT,
        name VARCHAR(255) NOT NULL,
        description TEXT NULL,
        category ENUM('gemeente', 'natuur', 'cultuur', 'sport', 'onderwijs', 'zorg', 'overig') NOT NULL,
        logo VARCHAR(255) NULL,
        website VARCHAR(255) NULL,
        email VARCHAR(255) NULL,
        phone VARCHAR(20) NULL,
        address TEXT NULL,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);

    // Users table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT PRIMARY KEY AUTO_INCREMENT,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        role ENUM('superadmin', 'admin', 'user') DEFAULT 'user',
        organization_id INT NULL,
        profile_image VARCHAR(255) NULL,
        phone VARCHAR(20) NULL,
        address TEXT NULL,
        is_active BOOLEAN DEFAULT true,
        email_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
      )
    `);

    // News articles table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS news_articles (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        excerpt TEXT NULL,
        image VARCHAR(255) NULL,
        author_id INT NOT NULL,
        organization_id INT NULL,
        category ENUM('dorpsnieuws', 'sport', 'cultuur', 'onderwijs', 'zorg', 'overig') DEFAULT 'dorpsnieuws',
        status ENUM('draft', 'pending', 'published', 'rejected') DEFAULT 'pending',
        published_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
      )
    `);

    // Events table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS events (
        id INT PRIMARY KEY AUTO_INCREMENT,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        event_date DATE NOT NULL,
        event_time TIME NOT NULL,
        location VARCHAR(255) NOT NULL,
        location_details TEXT NULL,
        organizer_id INT NOT NULL,
        organization_id INT NULL,
        category ENUM('vergadering', 'evenement', 'sport', 'cultuur', 'markt', 'overig') NOT NULL,
        price DECIMAL(10,2) DEFAULT 0.00,
        max_attendees INT NULL,
        image VARCHAR(255) NULL,
        status ENUM('draft', 'pending', 'published', 'cancelled') DEFAULT 'pending',
        published_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
      )
    `);

    // Found/Lost items table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS found_lost_items (
        id INT PRIMARY KEY AUTO_INCREMENT,
        type ENUM('found', 'lost') NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        location VARCHAR(255) NULL,
        contact_info VARCHAR(255) NULL,
        image VARCHAR(255) NULL,
        reporter_id INT NOT NULL,
        status ENUM('pending', 'approved', 'rejected', 'resolved') DEFAULT 'pending',
        approved_by INT NULL,
        approved_at TIMESTAMP NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // User follows organizations table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_follows_organization (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        organization_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_follow (user_id, organization_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE
      )
    `);

    // User saved articles table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS user_saved_articles (
        id INT PRIMARY KEY AUTO_INCREMENT,
        user_id INT NOT NULL,
        article_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY unique_save (user_id, article_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (article_id) REFERENCES news_articles(id) ON DELETE CASCADE
      )
    `);

    // Event attendees table
    await connection.execute(`
      CREATE TABLE IF NOT EXISTS event_attendees (
        id INT PRIMARY KEY AUTO_INCREMENT,
        event_id INT NOT NULL,
        user_id INT NOT NULL,
        status ENUM('attending', 'maybe', 'not_attending') DEFAULT 'attending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE KEY unique_attendance (event_id, user_id),
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      )
    `);

    connection.release();
    console.log('✅ Database tables initialized successfully');
  } catch (error) {
    console.error('❌ Database initialization failed:', error.message);
    throw error;
  }
};

module.exports = {
  pool,
  testConnection,
  initDatabase
};
