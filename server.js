const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');
const path = require('path');
const multer = require('multer');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());
// Serve uploaded images (local storage)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads'), { maxAge: '7d' }));

// Multer configuration for image uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage: storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'holwert-secret-key-2024';

// Test database connection
async function testDatabase() {
  try {
    const client = await pool.connect();
    console.log('✅ Database connected successfully');
    client.release();
  } catch (error) {
    console.error('❌ Database connection failed:', error.message);
  }
}

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Holwert Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'Connected to PostgreSQL'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'Connected to PostgreSQL'
  });
});

// Info + migratiestatus
app.get('/api/info', async (req, res) => {
  try {
    const version = `v${new Date().getFullYear()}.${String(new Date().getMonth()+1).padStart(2,'0')}.${String(new Date().getDate()).padStart(2,'0')}`;
    const colCheck = await pool.query(`
      SELECT COUNT(*) AS cnt
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'events' AND column_name = 'event_end_date'
    `);
    const hasEventEnd = parseInt(colCheck.rows[0].cnt, 10) > 0;
    res.json({
      name: 'Holwert Backend',
      version,
      timestamp: new Date().toISOString(),
      migrations: {
        events_event_end_date: hasEventEnd ? 'present' : 'missing'
      }
    });
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch info', message: e.message });
  }
});

// Unified update-schema endpoint (idempotent)
app.get('/api/database/update-schema', async (req, res) => {
  try {
    // Organizations
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS category VARCHAR(100)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS twitter_url VARCHAR(255)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(255)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tiktok_url VARCHAR(255)`);
    await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) DEFAULT '#667eea'`);

    // Users
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT`);

    // News
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS excerpt TEXT`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'dorpsnieuws'`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS custom_category VARCHAR(100)`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS medium_url TEXT`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS large_url TEXT`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE news ALTER COLUMN image_url TYPE TEXT`);

    // Events
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'evenement'`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS medium_url TEXT`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS large_url TEXT`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE events ALTER COLUMN image_url TYPE TEXT`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_date TIMESTAMP NULL`);
    // Backfill: zet event_end_date = event_date waar nog leeg
    await pool.query(`UPDATE events SET event_end_date = event_date WHERE event_end_date IS NULL`);
    // Constraint: einddatum mag niet vóór startdatum liggen
    // Found/Lost
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS is_published BOOLEAN DEFAULT false`);
    await pool.query(`ALTER TABLE found_lost ALTER COLUMN image_url TYPE TEXT`);
    
    // Add rejection and revision tracking
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS rejection_reason TEXT`);
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS rejection_date TIMESTAMP`);
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS revision_deadline TIMESTAMP`);
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pending'`);
    
    // Migrate found_lost column names
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS item_type VARCHAR(10)`);
    await pool.query(`ALTER TABLE found_lost ADD COLUMN IF NOT EXISTS contact_info TEXT`);
    
    // Set default values for new columns if they are NULL
    await pool.query(`UPDATE found_lost SET item_type = 'found' WHERE item_type IS NULL`);
    
    // Migrate data from old columns to new columns (only if old columns exist)
    try {
      await pool.query(`UPDATE found_lost SET item_type = type WHERE item_type IS NULL AND type IS NOT NULL`);
    } catch (err) {
      console.log('Column "type" does not exist, skipping migration');
    }
    
    try {
      await pool.query(`UPDATE found_lost SET contact_info = CONCAT_WS(' | ', contact_name, contact_phone, contact_email) WHERE contact_info IS NULL AND (contact_name IS NOT NULL OR contact_phone IS NOT NULL OR contact_email IS NOT NULL)`);
    } catch (err) {
      console.log('Old contact columns do not exist, skipping migration');
    }
    
    // Drop old columns if they exist
    await pool.query(`ALTER TABLE found_lost DROP COLUMN IF EXISTS type`);
    await pool.query(`ALTER TABLE found_lost DROP COLUMN IF EXISTS contact_name`);
    await pool.query(`ALTER TABLE found_lost DROP COLUMN IF EXISTS contact_phone`);
    await pool.query(`ALTER TABLE found_lost DROP COLUMN IF EXISTS contact_email`);
    
    // Add constraints for new columns
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'found_lost_item_type_check'
        ) THEN
          ALTER TABLE found_lost
          ADD CONSTRAINT found_lost_item_type_check
          CHECK (item_type IN ('found', 'lost'));
        END IF;
      END $$;
    `);
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'events_end_after_start'
        ) THEN
          ALTER TABLE events
          ADD CONSTRAINT events_end_after_start
          CHECK (event_end_date IS NULL OR event_end_date >= event_date);
        END IF;
      END $$;
    `);

    res.json({ message: 'Database schema updated successfully', timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('Schema update error:', error);
    res.status(500).json({ error: 'Failed to update schema', message: error.message });
  }
});

// Database test route
app.get('/api/database/test', async (req, res) => {
  try {
    const result = await pool.query('SELECT 1 as test');
    res.json({ 
      status: 'Database connected',
      test: result.rows[0].test,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Database connection failed',
      message: error.message
    });
  }
});

// Quick test data creation
app.get('/api/database/quick-test', async (req, res) => {
  try {
    const result = await pool.query(`
      INSERT INTO found_lost (item_type, title, description, location, contact_info, is_published, status, created_at)
      VALUES ('found', 'Test Gevonden Item', 'Dit is een test item', 'Test Locatie', 'test@example.com', false, 'pending', NOW())
      RETURNING id
    `);
    res.json({ 
      message: 'Test item created',
      id: result.rows[0].id,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'Failed to create test item',
      message: error.message
    });
  }
});

// Test database connection and schema
app.get('/api/database/test', async (req, res) => {
  try {
    // Test basic connection
    const connectionTest = await pool.query('SELECT NOW() as current_time');
    
    // Test found_lost table structure
    const tableTest = await pool.query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_name = 'found_lost' 
      ORDER BY ordinal_position
    `);
    
    // Test if we can query found_lost
    const dataTest = await pool.query('SELECT COUNT(*) as count FROM found_lost');
    
    res.json({
      message: 'Database test successful',
      connection: connectionTest.rows[0],
      table_structure: tableTest.rows,
      item_count: dataTest.rows[0].count
    });
  } catch (error) {
    console.error('Database test error:', error);
    res.status(500).json({ error: 'Database test failed', message: error.message });
  }
});

// Test data endpoint (temporary)
app.get('/api/database/create-test-data', async (req, res) => {
  try {
    // Create test found/lost items
    const testItems = [
      {
        item_type: 'found',
        title: 'Gevonden: Zwarte portemonnee',
        description: 'Ik heb een zwarte portemonnee gevonden bij de bushalte. Bevat een bankpas en wat contant geld.',
        location: 'Busstation Holwert',
        contact_info: 'Jan de Vries - 06-12345678 - jan@example.com',
        is_published: false
      },
      {
        item_type: 'lost',
        title: 'Verloren: Rode fiets',
        description: 'Mijn rode fiets is gestolen uit de fietsenstalling. Heeft een zwarte bagagedrager en een bel.',
        location: 'Centrum Holwert',
        contact_info: 'Maria Jansen - 06-87654321 - maria@example.com',
        is_published: false
      },
      {
        item_type: 'found',
        title: 'Gevonden: Sleutelbos',
        description: 'Een sleutelbos met 3 sleutels gevonden op het schoolplein.',
        location: 'Basisschool Holwert',
        contact_info: 'Piet Bakker - piet@example.com',
        is_published: true
      }
    ];

    const results = [];
    for (const item of testItems) {
      const result = await pool.query(
        `INSERT INTO found_lost (item_type, title, description, location, contact_info, is_published, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, NOW()) RETURNING id`,
        [item.item_type, item.title, item.description, item.location, item.contact_info, item.is_published]
      );
      results.push({ id: result.rows[0].id, title: item.title });
    }

    res.json({ 
      message: 'Test data created successfully',
      items: results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Create test data error:', error);
    res.status(500).json({ 
      error: 'Failed to create test data',
      message: error.message
    });
  }
});

// On-demand migration just for events end date
app.get('/api/database/migrate-events-end-date', async (req, res) => {
  try {
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_date TIMESTAMP NULL`);
    const result = await pool.query(`UPDATE events SET event_end_date = event_date WHERE event_end_date IS NULL`);
    // ensure constraint
    await pool.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'events_end_after_start'
        ) THEN
          ALTER TABLE events
          ADD CONSTRAINT events_end_after_start
          CHECK (event_end_date IS NULL OR event_end_date >= event_date);
        END IF;
      END $$;
    `);
    res.json({ message: 'event_end_date ensured, backfilled and constrained', updated: result.rowCount, timestamp: new Date().toISOString() });
  } catch (error) {
    console.error('migrate-events-end-date error:', error);
    res.status(500).json({ error: 'Failed to migrate events end date', message: error.message });
  }
});

// Add missing columns to existing tables
app.get('/api/database/update-schema', async (req, res) => {
  try {
    // Add profile_image_url column to users table if it doesn't exist
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS profile_image_url TEXT
    `);

    // Extend news table with variant URLs
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS medium_url TEXT`);
    await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS large_url TEXT`);
    await pool.query(`ALTER TABLE news ALTER COLUMN image_url TYPE TEXT`);

    // Extend events table with variant URLs
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS thumbnail_url TEXT`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS medium_url TEXT`);
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS large_url TEXT`);
    await pool.query(`ALTER TABLE events ALTER COLUMN image_url TYPE TEXT`);
    // Add optional end datetime for events
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_date TIMESTAMP NULL`);
    
    res.json({
      message: 'Database schema updated successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Schema update error:', error);
    res.status(500).json({
      error: 'Failed to update schema',
      message: error.message
    });
  }
});

// Create tables endpoint (GET for easy testing)
app.get('/api/database/create-tables', async (req, res) => {
  try {
    // Users table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        first_name VARCHAR(100) NOT NULL,
        last_name VARCHAR(100) NOT NULL,
        phone VARCHAR(20),
        profile_image_url TEXT,
        role VARCHAR(20) DEFAULT 'user',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Organizations table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS organizations (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        contact_email VARCHAR(255),
        contact_phone VARCHAR(20),
        website VARCHAR(255),
        logo_url TEXT,
        brand_color VARCHAR(7) DEFAULT '#667eea',
        category VARCHAR(100),
        facebook_url VARCHAR(255),
        instagram_url VARCHAR(255),
        twitter_url VARCHAR(255),
        linkedin_url VARCHAR(255),
        youtube_url VARCHAR(255),
        tiktok_url VARCHAR(255),
        is_approved BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // News table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS news (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL,
        excerpt TEXT,
        author_id INTEGER REFERENCES users(id),
        organization_id INTEGER REFERENCES organizations(id),
        image_url TEXT,
        thumbnail_url TEXT,
        medium_url TEXT,
        large_url TEXT,
        category VARCHAR(100) DEFAULT 'dorpsnieuws',
        custom_category VARCHAR(100),
        is_featured BOOLEAN DEFAULT false,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Events table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS events (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        event_date TIMESTAMP NOT NULL,
        event_end_date TIMESTAMP NULL,
        location VARCHAR(255),
        organizer_id INTEGER REFERENCES users(id),
        organization_id INTEGER REFERENCES organizations(id),
        image_url TEXT,
        thumbnail_url TEXT,
        medium_url TEXT,
        large_url TEXT,
        category VARCHAR(100) DEFAULT 'evenement',
        is_featured BOOLEAN DEFAULT false,
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Found/Lost table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS found_lost (
        id SERIAL PRIMARY KEY,
        item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('found', 'lost')),
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        location VARCHAR(255),
        contact_info TEXT,
        image_url TEXT,
        is_published BOOLEAN DEFAULT false,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'needs_revision', 'expired')),
        rejection_reason TEXT,
        rejection_date TIMESTAMP,
        revision_deadline TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    res.status(200).json({ 
      message: 'All tables created successfully',
      tables: ['users', 'organizations', 'news', 'events', 'found_lost'],
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to create tables:', error);
    res.status(500).json({ 
      error: 'Failed to create tables',
      message: error.message
    });
  }
});

// Database tables info
app.get('/api/database/tables', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
    `);
    res.json({ 
      tables: result.rows.map(row => row.table_name),
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Failed to get tables:', error);
    res.status(500).json({ 
      error: 'Failed to get tables',
      message: error.message
    });
  }
});

// ===== AUTHENTICATION ROUTES =====

// User registration
app.post('/api/auth/register', async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone, profile_image_url } = req.body;

    // Validation
    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Email, password, first name and last name are required'
      });
    }

    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        error: 'User already exists',
        message: 'A user with this email already exists'
      });
    }

    // Hash password
    const saltRounds = 10;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user (automatically active)
    const result = await pool.query(
      'INSERT INTO users (email, password, first_name, last_name, phone, profile_image_url, is_active) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id, email, first_name, last_name, phone, profile_image_url, role, created_at',
      [email, hashedPassword, first_name, last_name, phone, profile_image_url, true]
    );

    const user = result.rows[0];

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        phone: user.phone,
        profile_image_url: user.profile_image_url,
        role: user.role,
        created_at: user.created_at
      },
      token
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: error.message
    });
  }
});

// User login
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({
        error: 'Missing credentials',
        message: 'Email and password are required'
      });
    }

    // Find user
    const result = await pool.query(
      'SELECT id, email, password, first_name, last_name, role, is_active FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Email not found'
      });
    }

    const user = result.rows[0];

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        error: 'Account deactivated',
        message: 'Your account has been deactivated'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid credentials',
        message: 'Incorrect password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role
      },
      token
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

// Middleware to verify JWT token
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Access denied',
      message: 'No token provided'
    });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({
        error: 'Invalid token',
        message: 'Token is invalid or expired'
      });
    }
    req.user = user;
    next();
  });
};

// Protected route example
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, email, first_name, last_name, phone, role, created_at FROM users WHERE id = $1',
      [req.user.userId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      error: 'Failed to get profile',
      message: error.message
    });
  }
});

// ===== ROUTES =====
// Note: Route files are not loaded yet as they use MySQL syntax
// We'll add simple PostgreSQL routes directly in server.js for now

// ===== ORGANIZATION ROUTES =====

// Organization registration
app.post('/api/organizations/register', async (req, res) => {
  try {
    const { name, description, contact_email, contact_phone, website } = req.body;

    // Validation
    if (!name || !contact_email) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'Name and contact email are required'
      });
    }

    // Check if organization already exists
    const existingOrg = await pool.query(
      'SELECT id FROM organizations WHERE name = $1 OR contact_email = $2',
      [name, contact_email]
    );

    if (existingOrg.rows.length > 0) {
      return res.status(400).json({
        error: 'Organization already exists',
        message: 'An organization with this name or email already exists'
      });
    }

    // Create organization
    const result = await pool.query(
      'INSERT INTO organizations (name, description, contact_email, contact_phone, website, is_approved) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id, name, contact_email, created_at',
      [name, description, contact_email, contact_phone, website, false]
    );

    const organization = result.rows[0];

    res.status(201).json({
      message: 'Organization registered successfully',
      organization: {
        id: organization.id,
        name: organization.name,
        contact_email: organization.contact_email,
        created_at: organization.created_at
      }
    });

  } catch (error) {
    console.error('Organization registration error:', error);
    res.status(500).json({
      error: 'Registration failed',
      message: error.message
    });
  }
});

// ===== UPLOAD ROUTES =====

// Upload image (using base64 data URLs for now)
app.post('/api/upload/image', authenticateToken, async (req, res) => {
  try {
    const { imageData, filename } = req.body;

    if (!imageData) {
      return res.status(400).json({
        error: 'No image data provided',
        message: 'Please provide imageData (base64 encoded image)'
      });
    }

    // Generate unique filename
    const uniqueFilename = filename || `image-${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`;
    
    console.log('Processing image upload:', {
      filename: uniqueFilename,
      dataLength: imageData.length
    });

    // For now, just return the base64 data URL as the image URL
    // This works perfectly for profile images and other small images
    const imageUrl = imageData;
    
    res.json({
      message: 'Image processed successfully (using base64 data URL)',
      imageUrl: imageUrl,
      filename: uniqueFilename,
      note: 'Using base64 data URL - works perfectly for profile images'
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Failed to process image',
      message: error.message,
      details: error.toString()
    });
  }
});

// ===== CONTENT ROUTES =====

// Create news article with workflow logic
app.post('/api/news', authenticateToken, async (req, res) => {
  try {
    const { title, content, excerpt, category, custom_category, organization_id, image_url } = req.body;
    const authorId = req.user.userId;

    // Validation
    if (!title || !content) {
      return res.status(400).json({
        error: 'Title and content are required'
      });
    }

    // Determine publication status based on user type
    let isPublished = false;

    // Check if user is associated with an approved organization
    if (organization_id) {
      const orgResult = await pool.query(
        'SELECT is_approved FROM organizations WHERE id = $1',
        [organization_id]
      );
      
      if (orgResult.rows.length > 0 && orgResult.rows[0].is_approved) {
        // Organization content: publish immediately
        isPublished = true;
      }
    }

    // Handle category logic
    let finalCategory = category || 'dorpsnieuws';
    let finalCustomCategory = null;
    
    if (category === 'overig' && custom_category) {
      finalCustomCategory = custom_category;
    }

    // Insert into news table
    const result = await pool.query(
      'INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, category, custom_category, is_published) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
      [title, content, excerpt || null, authorId, organization_id || null, image_url || null, finalCategory, finalCustomCategory, isPublished]
    );

    const message = isPublished 
      ? 'News article published successfully' 
      : 'News article created and submitted for moderation';

    res.status(201).json({
      message: message,
      articleId: result.rows[0].id,
      isPublished: isPublished,
      requiresModeration: !isPublished
    });

  } catch (error) {
    console.error('Create news error:', error);
    res.status(500).json({
      error: 'Failed to create news article',
      message: error.message
    });
  }
});

// Create Found/Lost (user submits -> always pending)
app.post('/api/found-lost', authenticateToken, async (req, res) => {
  try {
    const { item_type, title, description, location, contact_info, image_url } = req.body;

    if (!item_type || !['found','lost'].includes(item_type) || !title || !description) {
      return res.status(400).json({ error: 'Invalid payload', message: 'item_type(found|lost), title, description verplicht' });
    }

    const insert = await pool.query(
      `INSERT INTO found_lost (item_type, title, description, location, contact_info, image_url, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,false) RETURNING id`,
      [item_type, title, description, location || null, contact_info || null, image_url || null]
    );

    res.status(201).json({
      message: 'Bericht aangemaakt en wacht op goedkeuring',
      id: insert.rows[0].id,
      requiresModeration: true
    });
  } catch (error) {
    console.error('Create found_lost error:', error);
    res.status(500).json({ error: 'Failed to create found/lost', message: error.message });
  }
});

// Public list Found/Lost (only approved)
app.get('/api/found-lost', async (req, res) => {
  try {
    const { page = 1, limit = 20, type, q } = req.query;
    const offset = (page - 1) * limit;

    let query = `SELECT id, item_type, title, description, location, contact_info, image_url, created_at
                 FROM found_lost WHERE is_published = true`;
    const params = [];
    if (type && ['found','lost'].includes(type)) {
      params.push(type);
      query += ` AND item_type = $${params.length}`;
    }
    if (q) {
      params.push(`%${q}%`);
      query += ` AND (title ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }
    params.push(parseInt(limit), parseInt(offset));
    query += ` ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;

    const result = await pool.query(query, params);

    // Count
    let countQuery = `SELECT COUNT(*) AS total FROM found_lost WHERE is_published = true`;
    const countParams = [];
    if (type && ['found','lost'].includes(type)) {
      countParams.push(type);
      countQuery += ` AND type = $${countParams.length}`;
    }
    if (q) {
      countParams.push(`%${q}%`);
      countQuery += ` AND (title ILIKE $${countParams.length} OR description ILIKE $${countParams.length})`;
    }
    const totalRes = await pool.query(countQuery, countParams);

    res.json({
      items: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(totalRes.rows[0].total),
        pages: Math.ceil(parseInt(totalRes.rows[0].total) / parseInt(limit))
      }
    });
  } catch (error) {
    console.error('List found_lost error:', error);
    res.status(500).json({ error: 'Failed to get found/lost', message: error.message });
  }
});

// Single Found/Lost (only approved)
app.get('/api/found-lost/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const r = await pool.query(`SELECT id, item_type, title, description, location, contact_info, image_url, created_at
                                FROM found_lost WHERE id = $1 AND is_published = true`, [id]);
    if (r.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (error) {
    console.error('Get found_lost error:', error);
    res.status(500).json({ error: 'Failed to get found/lost', message: error.message });
  }
});

// Create event with workflow logic
app.post('/api/events', authenticateToken, async (req, res) => {
  try {
    const { title, description, event_date, event_end_date, location, organization_id, image_url } = req.body;
    const organizerId = req.user.userId;

    // Validation
    if (!title || !description || !event_date || !location) {
      return res.status(400).json({
        error: 'Title, description, event date and location are required'
      });
    }

    // Determine publication status based on user type
    let isPublished = false;
    let requiresModeration = true;

    // Check if user is associated with an approved organization
    if (organization_id) {
      const orgResult = await pool.query(
        'SELECT is_approved FROM organizations WHERE id = $1',
        [organization_id]
      );
      
      if (orgResult.rows.length > 0 && orgResult.rows[0].is_approved) {
        // Organization content: publish immediately
        isPublished = true;
        requiresModeration = false;
      }
    }

    // Insert into events table
    const result = await pool.query(
      'INSERT INTO events (title, description, event_date, event_end_date, location, organizer_id, organization_id, image_url, is_published) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id',
      [title, description, event_date, event_end_date || null, location, organizerId, organization_id || null, image_url || null, isPublished]
    );

    const message = isPublished 
      ? 'Event published successfully' 
      : 'Event created and submitted for moderation';

    res.status(201).json({
      message: message,
      eventId: result.rows[0].id,
      isPublished: isPublished,
      requiresModeration: requiresModeration
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({
      error: 'Failed to create event',
      message: error.message
    });
  }
});

// ===== MODERATION ROUTES =====

// Approve content (news or event)
app.post('/api/admin/approve/:type/:id', authenticateToken, async (req, res) => {
  try {
    const { type, id } = req.params;
    
    if (!['news', 'events'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid content type'
      });
    }

    const tableName = type === 'news' ? 'news' : 'events';
    
    // Update content to published
    const result = await pool.query(
      `UPDATE ${tableName} SET is_published = true WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Content not found'
      });
    }

    res.json({
      message: `${type} approved and published successfully`,
      id: result.rows[0].id
    });

  } catch (error) {
    console.error('Approve content error:', error);
    res.status(500).json({
      error: 'Failed to approve content',
      message: error.message
    });
  }
});

// Approve Found/Lost
app.post('/api/admin/found-lost/:id/approve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE found_lost 
       SET is_published = true, 
           status = 'approved',
           rejection_reason = NULL,
           rejection_date = NULL,
           revision_deadline = NULL,
           updated_at = NOW()
       WHERE id = $1 
       RETURNING id, title, status`,
      [id]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Found/Lost approved and published', item: result.rows[0] });
  } catch (error) {
    console.error('Approve found_lost error:', error);
    res.status(500).json({ error: 'Failed to approve found/lost', message: error.message });
  }
});

// Reject Found/Lost with reason and 3-day revision period
app.post('/api/admin/found-lost/:id/reject', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, custom_reason } = req.body;
    
    if (!reason) {
      return res.status(400).json({ error: 'Rejection reason is required' });
    }
    
    // Combine predefined reason with custom reason if provided
    let rejectionReason = reason;
    if (custom_reason && custom_reason.trim()) {
      rejectionReason = `${reason}: ${custom_reason.trim()}`;
    }
    
    // Set revision deadline to 3 days from now
    const revisionDeadline = new Date();
    revisionDeadline.setDate(revisionDeadline.getDate() + 3);
    
    const result = await pool.query(
      `UPDATE found_lost 
       SET status = 'needs_revision', 
           rejection_reason = $1, 
           rejection_date = NOW(), 
           revision_deadline = $2,
           updated_at = NOW()
       WHERE id = $3 
       RETURNING id, title, status, revision_deadline`,
      [rejectionReason, revisionDeadline, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Found/Lost item not found' });
    }
    
    res.json({ 
      message: 'Found/Lost item rejected with 3-day revision period', 
      item: result.rows[0]
    });
  } catch (error) {
    console.error('Reject found_lost error:', error);
    res.status(500).json({ error: 'Failed to reject found/lost', message: error.message });
  }
});

// Admin list Found/Lost
app.get('/api/admin/found-lost', authenticateToken, async (req, res) => {
  try {
    const { status, page = 1, limit = 20, q } = req.query;
    const offset = (page - 1) * limit;
    let query = `SELECT id, item_type, title, description, contact_info, is_published, status, rejection_reason, rejection_date, revision_deadline, created_at FROM found_lost WHERE 1=1`;
    const params = [];
    if (status === 'published') query += ' AND is_published = true';
    if (status === 'pending') query += ' AND is_published = false';
    if (q) { params.push(`%${q}%`); query += ` AND (title ILIKE $${params.length})`; }
    params.push(parseInt(limit), parseInt(offset));
    query += ` ORDER BY created_at DESC LIMIT $${params.length-1} OFFSET $${params.length}`;
    const list = await pool.query(query, params);
    const cnt = await pool.query('SELECT COUNT(*) AS total FROM found_lost');
    res.json({ items: list.rows, pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(cnt.rows[0].total) }});
  } catch (error) {
    console.error('Admin list found_lost error:', error);
    res.status(500).json({ error: 'Failed to get found/lost admin list', message: error.message });
  }
});

// Reject content (news or event)
app.post('/api/admin/reject/:type/:id', authenticateToken, async (req, res) => {
  try {
    const { type, id } = req.params;
    
    if (!['news', 'events'].includes(type)) {
      return res.status(400).json({
        error: 'Invalid content type'
      });
    }

    const tableName = type === 'news' ? 'news' : 'events';
    
    // Delete content (or mark as rejected)
    const result = await pool.query(
      `DELETE FROM ${tableName} WHERE id = $1 RETURNING id`,
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Content not found'
      });
    }

    res.json({
      message: `${type} rejected and removed successfully`,
      id: result.rows[0].id
    });

  } catch (error) {
    console.error('Reject content error:', error);
    res.status(500).json({
      error: 'Failed to reject content',
      message: error.message
    });
  }
});

// Approve organization
app.post('/api/admin/approve-organization/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Update organization to approved
    const result = await pool.query(
      'UPDATE organizations SET is_approved = true WHERE id = $1 RETURNING id, name',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    res.json({
      message: 'Organization approved successfully',
      organization: result.rows[0]
    });

  } catch (error) {
    console.error('Approve organization error:', error);
    res.status(500).json({
      error: 'Failed to approve organization',
      message: error.message
    });
  }
});

// ===== CONTENT MANAGEMENT ROUTES =====

// Get all published news (public)
app.get('/api/news', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, organization, search, featured } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT n.id, n.title, n.content, n.excerpt, n.image_url, n.thumbnail_url, n.medium_url, n.large_url,
             n.category, n.created_at, n.updated_at,
             u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND n.category = $${params.length}`;
    }

    if (organization) {
      params.push(`%${organization}%`);
      query += ` AND o.name ILIKE $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (n.title ILIKE $${params.length} OR n.content ILIKE $${params.length} OR n.excerpt ILIKE $${params.length})`;
    }

    if (featured === 'true') {
      query += ` AND n.is_featured = true`;
    }

    query += ' ORDER BY n.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count with same filters
    let countQuery = `
      SELECT COUNT(*) as total
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true
    `;
    const countParams = [];
    
    if (category) {
      countParams.push(category);
      countQuery += ` AND n.category = $${countParams.length}`;
    }

    if (organization) {
      countParams.push(`%${organization}%`);
      countQuery += ` AND o.name ILIKE $${countParams.length}`;
    }

    if (search) {
      countParams.push(`%${search}%`);
      countQuery += ` AND (n.title ILIKE $${countParams.length} OR n.content ILIKE $${countParams.length} OR n.excerpt ILIKE $${countParams.length})`;
    }

    if (featured === 'true') {
      countQuery += ` AND n.is_featured = true`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      news: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get news error:', error);
    res.status(500).json({
      error: 'Failed to get news',
      message: error.message
    });
  }
});

// Get single news article (public)
app.get('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT n.id, n.title, n.content, n.image_url, n.created_at,
             u.first_name, u.last_name, o.name as organization_name
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.id = $1 AND n.is_published = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'News article not found'
      });
    }

    res.json({
      article: result.rows[0]
    });

  } catch (error) {
    console.error('Get news article error:', error);
    res.status(500).json({
      error: 'Failed to get news article',
      message: error.message
    });
  }
});

// Get all published events (public)
app.get('/api/events', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, organization, search, featured } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.id, e.title, e.description, e.event_date, e.event_end_date, e.location, e.image_url, e.thumbnail_url, e.medium_url, e.large_url, e.category, e.created_at,
             u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.is_published = true AND COALESCE(e.event_end_date, e.event_date) > NOW()
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND e.category = $${params.length}`;
    }

    if (organization) {
      params.push(`%${organization}%`);
      query += ` AND o.name ILIKE $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (e.title ILIKE $${params.length} OR e.description ILIKE $${params.length} OR e.location ILIKE $${params.length})`;
    }

    if (featured === 'true') {
      query += ` AND e.is_featured = true`;
    }

    query += ' ORDER BY COALESCE(e.event_date, NOW()) ASC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count with same filters
    let countQuery = `
      SELECT COUNT(*) as total
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.is_published = true AND COALESCE(e.event_end_date, e.event_date) > NOW()
    `;
    const countParams = [];
    
    if (category) {
      countParams.push(category);
      countQuery += ` AND e.category = $${countParams.length}`;
    }

    if (organization) {
      countParams.push(`%${organization}%`);
      countQuery += ` AND o.name ILIKE $${countParams.length}`;
    }

    if (search) {
      countParams.push(`%${search}%`);
      countQuery += ` AND (e.title ILIKE $${countParams.length} OR e.description ILIKE $${countParams.length} OR e.location ILIKE $${countParams.length})`;
    }

    if (featured === 'true') {
      countQuery += ` AND e.is_featured = true`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      events: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({
      error: 'Failed to get events',
      message: error.message
    });
  }
});

// Get single event (public)
app.get('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT e.id, e.title, e.description, e.event_date, e.event_end_date, e.location, e.image_url, e.created_at,
             u.first_name, u.last_name, o.name as organization_name
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.id = $1 AND e.is_published = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Event not found'
      });
    }

    res.json({
      event: result.rows[0]
    });

  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({
      error: 'Failed to get event',
      message: error.message
    });
  }
});

// ===== USER MANAGEMENT ROUTES =====

// Get all users (admin only)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, role, is_active } = req.query;
    const offset = (page - 1) * limit;

    // Try to add the profile_image_url column if it doesn't exist
    try {
      await pool.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS profile_image_url TEXT');
    } catch (alterError) {
      console.log('Column might already exist or alter failed:', alterError.message);
    }

    let query = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.phone, COALESCE(u.profile_image_url, '') as profile_image_url, u.role, u.is_active, u.created_at
      FROM users u
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (u.first_name ILIKE $${paramCount} OR u.last_name ILIKE $${paramCount} OR u.email ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (role) {
      paramCount++;
      query += ` AND u.role = $${paramCount}`;
      params.push(role);
    }

    if (is_active !== undefined) {
      paramCount++;
      query += ` AND u.is_active = $${paramCount}`;
      params.push(is_active === 'true');
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users WHERE 1=1';
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND (first_name ILIKE $${countParamCount} OR last_name ILIKE $${countParamCount} OR email ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (role) {
      countParamCount++;
      countQuery += ` AND role = $${countParamCount}`;
      countParams.push(role);
    }

    if (is_active !== undefined) {
      countParamCount++;
      countQuery += ` AND is_active = $${countParamCount}`;
      countParams.push(is_active === 'true');
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      users: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({
      error: 'Failed to get users',
      message: error.message
    });
  }
});

// Update user status (admin only)
app.put('/api/admin/users/:id/status', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { is_active } = req.body;

    if (typeof is_active !== 'boolean') {
      return res.status(400).json({
        error: 'is_active must be a boolean value'
      });
    }

    const result = await pool.query(
      'UPDATE users SET is_active = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, email, first_name, last_name, is_active',
      [is_active, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      message: `User ${is_active ? 'activated' : 'deactivated'} successfully`,
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update user status error:', error);
    res.status(500).json({
      error: 'Failed to update user status',
      message: error.message
    });
  }
});

// Update user role (admin only)
app.put('/api/admin/users/:id/role', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { role } = req.body;

    const validRoles = ['user', 'admin', 'superadmin'];
    if (!validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'Role must be one of: ' + validRoles.join(', ')
      });
    }

    const result = await pool.query(
      'UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 RETURNING id, email, first_name, last_name, role',
      [role, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      message: 'User role updated successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Update user role error:', error);
    res.status(500).json({
      error: 'Failed to update user role',
      message: error.message
    });
  }
});

// Update user (admin only) - Full update
app.put('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, phone, role, is_active, profile_image_url } = req.body;

    // Validate required fields
    if (!first_name || !last_name || !email) {
      return res.status(400).json({
        error: 'Missing required fields',
        message: 'First name, last name and email are required'
      });
    }

    // Check if email is already taken by another user
    const existingUser = await pool.query(
      'SELECT id FROM users WHERE email = $1 AND id != $2',
      [email, id]
    );

    if (existingUser.rows.length > 0) {
      return res.status(400).json({
        error: 'Email already exists',
        message: 'A user with this email already exists'
      });
    }

    // Validate role
    const validRoles = ['user', 'admin', 'superadmin'];
    if (role && !validRoles.includes(role)) {
      return res.status(400).json({
        error: 'Invalid role',
        message: 'Role must be one of: ' + validRoles.join(', ')
      });
    }

    const result = await pool.query(
      `UPDATE users SET 
        first_name = $1, 
        last_name = $2, 
        email = $3, 
        phone = $4, 
        role = $5, 
        is_active = $6, 
        profile_image_url = $7,
        updated_at = CURRENT_TIMESTAMP 
      WHERE id = $8 
      RETURNING id, email, first_name, last_name, phone, profile_image_url, role, is_active, created_at`,
      [first_name, last_name, email, phone || null, role || 'user', is_active !== false, profile_image_url || null, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    res.json({
      message: 'User updated successfully',
      user: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({
      error: 'Failed to update user',
      message: error.message
    });
  }
});

// Delete user (admin only)
app.delete('/api/admin/users/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const userResult = await pool.query('SELECT id, email FROM users WHERE id = $1', [id]);
    if (userResult.rows.length === 0) {
      return res.status(404).json({
        error: 'User not found'
      });
    }

    // Delete user
    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    res.json({
      message: 'User deleted successfully',
      deletedUser: userResult.rows[0]
    });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({
      error: 'Failed to delete user',
      message: error.message
    });
  }
});

// Get all approved organizations (public)
app.get('/api/organizations', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, name, description, contact_email, contact_phone, website, logo_url, brand_color, category, created_at
      FROM organizations
      WHERE is_approved = true
    `;
    const params = [];

    if (category) {
      params.push(category);
      query += ` AND category = $${params.length}`;
    }

    if (search) {
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${params.length} OR description ILIKE $${params.length})`;
    }

    query += ` ORDER BY name ASC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM organizations WHERE is_approved = true';
    const countParams = [];
    
    if (category) {
      countParams.push(category);
      countQuery += ` AND category = $${countParams.length}`;
    }

    if (search) {
      countParams.push(`%${search}%`);
      countQuery += ` AND (name ILIKE $${countParams.length} OR description ILIKE $${countParams.length})`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      organizations: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({
      error: 'Failed to get organizations',
      message: error.message
    });
  }
});

// Get single organization (public)
app.get('/api/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT id, name, description, contact_email, contact_phone, website, logo_url, brand_color, category, created_at
      FROM organizations
      WHERE id = $1 AND is_approved = true
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    res.json({
      organization: result.rows[0]
    });

  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({
      error: 'Failed to get organization',
      message: error.message
    });
  }
});

// ===== MOBILE APP SPECIFIC ENDPOINTS =====

// Get app configuration and metadata
app.get('/api/app/config', async (req, res) => {
  try {
    const config = {
      app_name: 'Dorpsapp Holwert',
      version: '1.0.0',
      api_version: 'v1',
      features: {
        news: true,
        events: true,
        organizations: true,
        found_lost: true,
        push_notifications: true
      },
      settings: {
        max_image_size: 5242880, // 5MB
        supported_image_formats: ['jpg', 'jpeg', 'png', 'webp'],
        pagination_default_limit: 20,
        search_min_length: 2
      }
    };
    
    res.json(config);
  } catch (error) {
    console.error('App config error:', error);
    res.status(500).json({ error: 'Failed to get app config' });
  }
});

// Get categories for filtering
app.get('/api/categories', async (req, res) => {
  try {
    const [newsCategories, eventCategories, orgCategories] = await Promise.all([
      pool.query('SELECT DISTINCT category FROM news WHERE category IS NOT NULL AND is_published = true'),
      pool.query('SELECT DISTINCT category FROM events WHERE category IS NOT NULL AND is_published = true'),
      pool.query('SELECT DISTINCT category FROM organizations WHERE category IS NOT NULL AND is_approved = true')
    ]);
    
    res.json({
      news: newsCategories.rows.map(r => r.category),
      events: eventCategories.rows.map(r => r.category),
      organizations: orgCategories.rows.map(r => r.category)
    });
  } catch (error) {
    console.error('Categories error:', error);
    res.status(500).json({ error: 'Failed to get categories' });
  }
});

// Search across all content types
app.get('/api/search', async (req, res) => {
  try {
    const { q, type, limit = 10 } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search query too short' });
    }
    
    const searchTerm = `%${q}%`;
    const results = {};
    
    // Search news
    if (!type || type === 'news') {
      const newsResults = await pool.query(`
        SELECT 'news' as type, id, title, excerpt, image_url, thumbnail_url, created_at
        FROM news 
        WHERE is_published = true 
        AND (title ILIKE $1 OR content ILIKE $1 OR excerpt ILIKE $1)
        ORDER BY created_at DESC 
        LIMIT $2
      `, [searchTerm, parseInt(limit)]);
      results.news = newsResults.rows;
    }
    
    // Search events
    if (!type || type === 'events') {
      const eventResults = await pool.query(`
        SELECT 'events' as type, id, title, description, image_url, thumbnail_url, event_date, location
        FROM events 
        WHERE is_published = true 
        AND (title ILIKE $1 OR description ILIKE $1 OR location ILIKE $1)
        ORDER BY event_date DESC 
        LIMIT $2
      `, [searchTerm, parseInt(limit)]);
      results.events = eventResults.rows;
    }
    
    // Search organizations
    if (!type || type === 'organizations') {
      const orgResults = await pool.query(`
        SELECT 'organizations' as type, id, name, description, logo_url, category
        FROM organizations 
        WHERE is_approved = true 
        AND (name ILIKE $1 OR description ILIKE $1)
        ORDER BY name ASC 
        LIMIT $2
      `, [searchTerm, parseInt(limit)]);
      results.organizations = orgResults.rows;
    }
    
    // Search found/lost items
    if (!type || type === 'found_lost') {
      const foundLostResults = await pool.query(`
        SELECT 'found_lost' as type, id, title, description, item_type, location, created_at
        FROM found_lost 
        WHERE is_published = true 
        AND (title ILIKE $1 OR description ILIKE $1 OR location ILIKE $1)
        ORDER BY created_at DESC 
        LIMIT $2
      `, [searchTerm, parseInt(limit)]);
      results.found_lost = foundLostResults.rows;
    }
    
    res.json({
      query: q,
      results,
      total: Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
    });
    
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Get featured content for home screen
app.get('/api/featured', async (req, res) => {
  try {
    const [featuredNews, upcomingEvents, recentFoundLost] = await Promise.all([
      pool.query(`
        SELECT n.id, n.title, n.excerpt, n.thumbnail_url, n.created_at, o.name as organization_name
        FROM news n
        LEFT JOIN organizations o ON n.organization_id = o.id
        WHERE n.is_published = true AND n.is_featured = true
        ORDER BY n.created_at DESC
        LIMIT 5
      `),
      pool.query(`
        SELECT e.id, e.title, e.description, e.thumbnail_url, e.event_date, e.location, o.name as organization_name
        FROM events e
        LEFT JOIN organizations o ON e.organization_id = o.id
        WHERE e.is_published = true AND e.event_date >= NOW()
        ORDER BY e.event_date ASC
        LIMIT 5
      `),
      pool.query(`
        SELECT id, title, description, item_type, location, created_at
        FROM found_lost
        WHERE is_published = true
        ORDER BY created_at DESC
        LIMIT 3
      `)
    ]);
    
    res.json({
      featured_news: featuredNews.rows,
      upcoming_events: upcomingEvents.rows,
      recent_found_lost: recentFoundLost.rows
    });
    
  } catch (error) {
    console.error('Featured content error:', error);
    res.status(500).json({ error: 'Failed to get featured content' });
  }
});

// Submit found/lost item (public endpoint for mobile app)
app.post('/api/found-lost/submit', async (req, res) => {
  try {
    const { item_type, title, description, location, contact_info, image_url } = req.body;
    
    if (!item_type || !['found','lost'].includes(item_type) || !title || !description) {
      return res.status(400).json({ 
        error: 'Invalid payload', 
        message: 'item_type(found|lost), title, description verplicht' 
      });
    }
    
    const insert = await pool.query(
      `INSERT INTO found_lost (item_type, title, description, location, contact_info, image_url, is_published, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,false,'pending',NOW()) RETURNING id`,
      [item_type, title, description, location || null, contact_info || null, image_url || null]
    );
    
    res.status(201).json({
      message: 'Item succesvol ingediend voor moderatie',
      id: insert.rows[0].id,
      status: 'pending'
    });
    
  } catch (error) {
    console.error('Submit found/lost error:', error);
    res.status(500).json({ error: 'Failed to submit item', message: error.message });
  }
});

// ===== ADMIN ROUTES =====

// Get all news for admin management
app.get('/api/admin/news', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT n.id, n.title, n.excerpt, n.category, n.custom_category, n.is_published, n.created_at, n.updated_at,
             u.first_name, u.last_name, u.email,
             o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_color
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (n.title ILIKE $${paramCount} OR n.excerpt ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (category) {
      paramCount++;
      query += ` AND n.category = $${paramCount}`;
      params.push(category);
    }

    if (status === 'published') {
      query += ` AND n.is_published = true`;
    } else if (status === 'pending') {
      query += ` AND n.is_published = false`;
    }

    query += ` ORDER BY n.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND (n.title ILIKE $${countParamCount} OR n.excerpt ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (category) {
      countParamCount++;
      countQuery += ` AND n.category = $${countParamCount}`;
      countParams.push(category);
    }

    if (status === 'published') {
      countQuery += ` AND n.is_published = true`;
    } else if (status === 'pending') {
      countQuery += ` AND n.is_published = false`;
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      news: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get admin news error:', error);
    res.status(500).json({
      error: 'Failed to get news',
      message: error.message
    });
  }
});

// Update news article
app.put('/api/admin/news/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, excerpt, category, custom_category, image_url, thumbnail_url, medium_url, large_url, is_published } = req.body;

    // Validation
    if (!title || !content) {
      return res.status(400).json({
        error: 'Title and content are required'
      });
    }

    // Handle category logic
    let finalCategory = category || 'dorpsnieuws';
    let finalCustomCategory = null;
    
    if (category === 'overig' && custom_category) {
      finalCustomCategory = custom_category;
    }

    const result = await pool.query(
      `UPDATE news SET 
        title = $1, 
        content = $2, 
        excerpt = $3, 
        category = $4, 
        custom_category = $5, 
        image_url = $6,
        thumbnail_url = COALESCE($7, thumbnail_url),
        medium_url = COALESCE($8, medium_url),
        large_url = COALESCE($9, large_url),
        is_published = $10, 
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $11
      RETURNING id, title, content, excerpt, category, custom_category, image_url, is_published, created_at, updated_at`,
      [title, content, excerpt || null, finalCategory, finalCustomCategory, image_url || null, thumbnail_url || null, medium_url || null, large_url || null, is_published !== false, id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'News article not found'
      });
    }

    res.json({
      message: 'News article updated successfully',
      article: result.rows[0]
    });

  } catch (error) {
    console.error('Update news error:', error);
    res.status(500).json({
      error: 'Failed to update news article',
      message: error.message
    });
  }
});

// Delete news article
app.delete('/api/admin/news/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(
      'DELETE FROM news WHERE id = $1 RETURNING id, title',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'News article not found'
      });
    }

    res.json({
      message: 'News article deleted successfully',
      deletedArticle: result.rows[0]
    });

  } catch (error) {
    console.error('Delete news error:', error);
    res.status(500).json({
      error: 'Failed to delete news article',
      message: error.message
    });
  }
});

// ===== ADMIN EVENTS ROUTES =====

// Get all events for admin management
app.get('/api/admin/events', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, search, status, organization_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.id, e.title, e.description, e.event_date, e.event_end_date, e.location, e.image_url,
             e.is_published, e.created_at, e.updated_at,
             u.first_name, u.last_name, u.email,
             o.name as organization_name
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE 1=1`;
    const params = [];
    let paramCount = 0;

    if (search) {
      paramCount++;
      query += ` AND (e.title ILIKE $${paramCount} OR e.description ILIKE $${paramCount} OR e.location ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    if (status === 'published') {
      query += ` AND e.is_published = true`;
    } else if (status === 'pending') {
      query += ` AND e.is_published = false`;
    }

    if (organization_id) {
      paramCount++;
      query += ` AND e.organization_id = $${paramCount}`;
      params.push(parseInt(organization_id));
    }

    query += ` ORDER BY COALESCE(e.event_date, e.created_at) DESC NULLS LAST, e.created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Total count
    let countQuery = `
      SELECT COUNT(*) as total
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE 1=1`;
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND (e.title ILIKE $${countParamCount} OR e.description ILIKE $${countParamCount} OR e.location ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
    }
    if (status === 'published') {
      countQuery += ` AND e.is_published = true`;
    } else if (status === 'pending') {
      countQuery += ` AND e.is_published = false`;
    }
    if (organization_id) {
      countParamCount++;
      countQuery += ` AND e.organization_id = $${countParamCount}`;
      countParams.push(parseInt(organization_id));
    }

    const countResult = await pool.query(countQuery, countParams);

    res.json({
      events: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    });

  } catch (error) {
    console.error('Get admin events error:', error);
    res.status(500).json({
      error: 'Failed to get events',
      message: error.message
    });
  }
});

// Create event (admin)
app.post('/api/admin/events', authenticateToken, async (req, res) => {
  try {
    const { title, description, event_date, event_end_date, location, organization_id, image_url, is_published } = req.body;
    const organizerId = req.user.userId;

    if (!title || !description || !event_date || !location) {
      return res.status(400).json({ error: 'Title, description, event_date and location are required' });
    }

    const insert = await pool.query(
      'INSERT INTO events (title, description, event_date, event_end_date, location, organizer_id, organization_id, image_url, is_published) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id',
      [title, description, event_date, event_end_date || null, location, organizerId, organization_id || null, image_url || null, is_published === true]
    );

    res.status(201).json({
      message: 'Event created successfully',
      eventId: insert.rows[0].id
    });

  } catch (error) {
    console.error('Create admin event error:', error);
    res.status(500).json({ error: 'Failed to create event', message: error.message });
  }
});

// Update event (admin)
app.put('/api/admin/events/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, event_date, event_end_date, location, organization_id, image_url, is_published } = req.body;

    if (!title || !description || !event_date || !location) {
      return res.status(400).json({ error: 'Title, description, event_date and location are required' });
    }

    const existing = await pool.query('SELECT id FROM events WHERE id = $1', [id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const update = await pool.query(
      `UPDATE events SET
        title = $1,
        description = $2,
        event_date = $3,
        event_end_date = $4,
        location = $5,
        organization_id = $6,
        image_url = $7,
        is_published = $8,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $9
      RETURNING id, title, description, event_date, event_end_date, location, organization_id, image_url, is_published, created_at, updated_at`,
      [title, description, event_date, event_end_date || null, location, organization_id || null, image_url || null, is_published === true, id]
    );

    res.json({ message: 'Event updated successfully', event: update.rows[0] });

  } catch (error) {
    console.error('Update admin event error:', error);
    res.status(500).json({ error: 'Failed to update event', message: error.message });
  }
});

// Delete event (admin)
app.delete('/api/admin/events/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const del = await pool.query('DELETE FROM events WHERE id = $1 RETURNING id, title', [id]);
    if (del.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    res.json({ message: 'Event deleted successfully', event: del.rows[0] });
  } catch (error) {
    console.error('Delete admin event error:', error);
    res.status(500).json({ error: 'Failed to delete event', message: error.message });
  }
});

// Get all organizations (admin only)
app.get('/api/admin/organizations', authenticateToken, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    // First, ensure all columns exist
    try {
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS category VARCHAR(100)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS twitter_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tiktok_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) DEFAULT '#667eea'`);
      // Extend logo_url column to support base64 images
      await pool.query(`ALTER TABLE organizations ALTER COLUMN logo_url TYPE TEXT`);
      
      // Add news table columns if they don't exist
      await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS excerpt TEXT`);
      await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'dorpsnieuws'`);
      await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS custom_category VARCHAR(100)`);
      await pool.query(`ALTER TABLE news ALTER COLUMN image_url TYPE TEXT`);
    } catch (alterError) {
      console.log('Columns may already exist:', alterError.message);
    }

    let query = `
      SELECT id, name, description, contact_email, contact_phone, website, is_approved, created_at,
             COALESCE(category, '') as category,
             COALESCE(logo_url, '') as logo_url,
             COALESCE(brand_color, '#667eea') as brand_color
      FROM organizations
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    // Add search filter
    if (search) {
      paramCount++;
      query += ` AND (name ILIKE $${paramCount} OR contact_email ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
      params.push(`%${search}%`);
    }

    // Add status filter
    if (status === 'approved') {
      query += ` AND is_approved = true`;
    } else if (status === 'pending') {
      query += ` AND is_approved = false`;
    }

    // Add ordering and pagination
    query += ` ORDER BY created_at DESC LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}`;
    params.push(limit, offset);

    const result = await pool.query(query, params);

    // Get total count for pagination
    let countQuery = `
      SELECT COUNT(*) as total
      FROM organizations
      WHERE 1=1
    `;
    const countParams = [];
    let countParamCount = 0;

    if (search) {
      countParamCount++;
      countQuery += ` AND (name ILIKE $${countParamCount} OR contact_email ILIKE $${countParamCount} OR description ILIKE $${countParamCount})`;
      countParams.push(`%${search}%`);
    }

    if (status === 'approved') {
      countQuery += ` AND is_approved = true`;
    } else if (status === 'pending') {
      countQuery += ` AND is_approved = false`;
    }

    const countResult = await pool.query(countQuery, countParams);
    const total = parseInt(countResult.rows[0].total);

    res.json({
      organizations: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      },
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error fetching organizations:', error);
    res.status(500).json({
      error: 'Failed to fetch organizations',
      message: error.message
    });
  }
});

// Update organization (admin only)
app.put('/api/admin/organizations/:id', authenticateToken, async (req, res) => {
  try {
    // First, ensure all columns exist
    try {
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS category VARCHAR(100)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS facebook_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS instagram_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS twitter_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS linkedin_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS youtube_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tiktok_url VARCHAR(255)`);
      await pool.query(`ALTER TABLE organizations ADD COLUMN IF NOT EXISTS brand_color VARCHAR(7) DEFAULT '#667eea'`);
      // Extend logo_url column to support base64 images
      await pool.query(`ALTER TABLE organizations ALTER COLUMN logo_url TYPE TEXT`);
      
      // Add news table columns if they don't exist
      await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS excerpt TEXT`);
      await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS category VARCHAR(100) DEFAULT 'dorpsnieuws'`);
      await pool.query(`ALTER TABLE news ADD COLUMN IF NOT EXISTS custom_category VARCHAR(100)`);
      await pool.query(`ALTER TABLE news ALTER COLUMN image_url TYPE TEXT`);
    } catch (alterError) {
      console.log('Columns may already exist:', alterError.message);
    }

    const { id } = req.params;
    const { 
      name, 
      description, 
      contact_email, 
      contact_phone, 
      website, 
      category,
      logo_url,
      brand_color,
      facebook_url,
      instagram_url,
      twitter_url,
      linkedin_url,
      youtube_url,
      tiktok_url,
      is_approved 
    } = req.body;

    // Validate required fields
    if (!name || name.trim() === '') {
      return res.status(400).json({
        error: 'Organization name is required'
      });
    }

    // Check if organization exists
    const existingOrg = await pool.query('SELECT id FROM organizations WHERE id = $1', [id]);
    if (existingOrg.rows.length === 0) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    // Check for duplicate name (excluding current organization)
    if (name) {
      const duplicateCheck = await pool.query(
        'SELECT id FROM organizations WHERE name = $1 AND id != $2',
        [name, id]
      );
      if (duplicateCheck.rows.length > 0) {
        return res.status(400).json({
          error: 'Organization name already exists'
        });
      }
    }

    // Update organization
    const result = await pool.query(
      `UPDATE organizations SET
        name = $1,
        description = $2,
        contact_email = $3,
        contact_phone = $4,
        website = $5,
        category = $6,
        logo_url = $7,
        brand_color = $8,
        is_approved = $9,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $10
      RETURNING id, name, description, contact_email, contact_phone, website, COALESCE(category, '') as category, COALESCE(logo_url, '') as logo_url, COALESCE(brand_color, '#667eea') as brand_color, is_approved, created_at`,
      [
        name, 
        description || null, 
        contact_email || null, 
        contact_phone || null, 
        website || null,
        category || null,
        logo_url || null,
        brand_color || '#667eea',
        is_approved !== false, 
        id
      ]
    );

    res.json({
      message: 'Organization updated successfully',
      organization: result.rows[0]
    });

  } catch (error) {
    console.error('Error updating organization:', error);
    res.status(500).json({
      error: 'Failed to update organization',
      message: error.message
    });
  }
});

// Delete organization (admin only)
app.delete('/api/admin/organizations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if organization exists
    const existingOrg = await pool.query('SELECT id, name FROM organizations WHERE id = $1', [id]);
    if (existingOrg.rows.length === 0) {
      return res.status(404).json({
        error: 'Organization not found'
      });
    }

    // Check if organization has associated content
    const [newsCount, eventsCount] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM news WHERE organization_id = $1', [id]),
      pool.query('SELECT COUNT(*) as count FROM events WHERE organization_id = $1', [id])
    ]);

    const totalContent = parseInt(newsCount.rows[0].count) + parseInt(eventsCount.rows[0].count);
    if (totalContent > 0) {
      return res.status(400).json({
        error: 'Cannot delete organization with associated content',
        message: `This organization has ${totalContent} associated news articles or events. Please remove or reassign this content first.`
      });
    }

    // Delete organization
    await pool.query('DELETE FROM organizations WHERE id = $1', [id]);

    res.json({
      message: 'Organization deleted successfully',
      organization: existingOrg.rows[0]
    });

  } catch (error) {
    console.error('Error deleting organization:', error);
    res.status(500).json({
      error: 'Failed to delete organization',
      message: error.message
    });
  }
});

// ===== ADMIN STATS ROUTES =====

// Get dashboard stats
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    // Allow all authenticated users to see stats for now
    // TODO: Add proper admin check later

    // Get counts from database
    const [usersResult, orgsResult, newsResult, eventsResult] = await Promise.all([
      pool.query('SELECT COUNT(*) as count FROM users'),
      pool.query('SELECT COUNT(*) as count FROM organizations'),
      pool.query('SELECT COUNT(*) as count FROM news'),
      pool.query('SELECT COUNT(*) as count FROM events')
    ]);

    res.json({
      users: usersResult.rows[0].count,
      organizations: orgsResult.rows[0].count,
      news: newsResult.rows[0].count,
      events: eventsResult.rows[0].count,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({
      error: 'Failed to get stats',
      message: error.message
    });
  }
});

// ===== IMAGE UPLOAD (UNIFORM) =====
try {
  const { processImageSizes } = require('./utils/imageUpload');
  const authenticateToken = (req, res, next) => {
    try {
      const authHeader = req.headers['authorization'];
      const token = authHeader && authHeader.split(' ')[1];
      if (!token) return res.status(401).json({ error: 'Missing token' });
      const payload = jwt.verify(token, JWT_SECRET);
      req.user = { userId: payload.userId, email: payload.email, role: payload.role };
      next();
    } catch (err) {
      return res.status(401).json({ error: 'Invalid token' });
    }
  };

  app.post('/api/upload', authenticateToken, upload.single('image'), async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No image provided' });
      }
      const type = (req.body.type || 'event').toLowerCase();
      const results = await processImageSizes(req.file.buffer, req.file.originalname || 'upload.jpg', type);
      // Prefer large/medium urls if available
      const bestUrl = (results.large && (results.large.url || results.large.path))
        || (results.medium && (results.medium.url || results.medium.path))
        || (results.original && (results.original.url || results.original.path));
      res.json({
        message: 'Image uploaded successfully',
        url: bestUrl,
        sizes: results
      });
    } catch (error) {
      console.error('Image upload error:', error);
      res.status(500).json({ error: 'Failed to upload image', message: error.message });
    }
  });
} catch (e) {
  console.warn('Image upload module not available or failed to init:', e.message);
}

// Get pending content
app.get('/api/admin/pending', authenticateToken, async (req, res) => {
  try {
    // Allow all authenticated users to see pending content for now
    // TODO: Add proper admin check later

    // Get pending content (only content that needs approval, not users)
    const [pendingOrgs, pendingNews, pendingEvents] = await Promise.all([
      pool.query('SELECT id, name, contact_email, created_at FROM organizations WHERE is_approved = false'),
      pool.query('SELECT id, title, author_id, created_at FROM news WHERE is_published = false'),
      pool.query('SELECT id, title, organizer_id, event_date, created_at FROM events WHERE is_published = false')
    ]);

    const pendingFoundLost = await pool.query('SELECT id, item_type, title, contact_info, status, rejection_reason, revision_deadline, created_at FROM found_lost WHERE is_published = false AND status = \'pending\'');

    res.json({
      users: [],
      organizations: pendingOrgs.rows,
      news: pendingNews.rows,
      events: pendingEvents.rows,
      found_lost: pendingFoundLost.rows,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Pending content error:', error);
    res.status(500).json({
      error: 'Failed to get pending content',
      message: error.message
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Simple, safe migrations at boot (idempotent)
async function runBootMigrations() {
  try {
    // Ensure optional end date exists for events
    await pool.query(`ALTER TABLE events ADD COLUMN IF NOT EXISTS event_end_date TIMESTAMP NULL`);
    // Keep image_url TEXT for larger external URLs
    await pool.query(`ALTER TABLE events ALTER COLUMN image_url TYPE TEXT`);
    console.log('✅ Boot migrations executed');
  } catch (e) {
    console.warn('⚠️ Boot migrations skipped:', e.message);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  await runBootMigrations();
  await testDatabase();
});

module.exports = app;// Force Vercel redeploy - Tue Sep 30 00:37:38 CEST 2025
// Force Vercel redeploy - Tue Sep 30 00:40:29 CEST 2025
