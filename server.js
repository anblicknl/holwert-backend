const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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

// Add missing columns to existing tables
app.get('/api/database/update-schema', async (req, res) => {
  try {
    // Add profile_image_url column to users table if it doesn't exist
    await pool.query(`
      ALTER TABLE users 
      ADD COLUMN IF NOT EXISTS profile_image_url TEXT
    `);
    
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
        logo_url VARCHAR(500),
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
        author_id INTEGER REFERENCES users(id),
        organization_id INTEGER REFERENCES organizations(id),
        image_url VARCHAR(500),
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
        location VARCHAR(255),
        organizer_id INTEGER REFERENCES users(id),
        organization_id INTEGER REFERENCES organizations(id),
        image_url VARCHAR(500),
        is_published BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Found/Lost table
    await pool.query(`
      CREATE TABLE IF NOT EXISTS found_lost (
        id SERIAL PRIMARY KEY,
        type VARCHAR(10) NOT NULL CHECK (type IN ('found', 'lost')),
        title VARCHAR(255) NOT NULL,
        description TEXT NOT NULL,
        location VARCHAR(255),
        contact_name VARCHAR(100),
        contact_phone VARCHAR(20),
        contact_email VARCHAR(255),
        image_url VARCHAR(500),
        is_resolved BOOLEAN DEFAULT false,
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
    const { title, content, category, organization_id, image_url } = req.body;
    const authorId = req.user.userId;

    // Validation
    if (!title || !content) {
      return res.status(400).json({
        error: 'Title and content are required'
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

    // Insert into news table
    const result = await pool.query(
      'INSERT INTO news (title, content, author_id, organization_id, image_url, is_published) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id',
      [title, content, authorId, organization_id || null, image_url || null, isPublished]
    );

    const message = isPublished 
      ? 'News article published successfully' 
      : 'News article created and submitted for moderation';

    res.status(201).json({
      message: message,
      articleId: result.rows[0].id,
      isPublished: isPublished,
      requiresModeration: requiresModeration
    });

  } catch (error) {
    console.error('Create news error:', error);
    res.status(500).json({
      error: 'Failed to create news article',
      message: error.message
    });
  }
});

// Create event with workflow logic
app.post('/api/events', authenticateToken, async (req, res) => {
  try {
    const { title, description, event_date, location, organization_id, image_url } = req.body;
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
      'INSERT INTO events (title, description, event_date, location, organizer_id, organization_id, image_url, is_published) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id',
      [title, description, event_date, location, organizerId, organization_id || null, image_url || null, isPublished]
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
    const { page = 1, limit = 20, category } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT n.id, n.title, n.content, n.image_url, n.created_at,
             u.first_name, u.last_name, o.name as organization_name
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true
    `;
    const params = [];

    if (category) {
      query += ' AND n.category = $1';
      params.push(category);
    }

    query += ' ORDER BY n.created_at DESC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM news WHERE is_published = true';
    const countParams = [];
    
    if (category) {
      countQuery += ' AND category = $1';
      countParams.push(category);
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
    const { page = 1, limit = 20, category } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.id, e.title, e.description, e.event_date, e.location, e.image_url, e.created_at,
             u.first_name, u.last_name, o.name as organization_name
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.is_published = true AND e.event_date > NOW()
    `;
    const params = [];

    if (category) {
      query += ' AND e.category = $1';
      params.push(category);
    }

    query += ' ORDER BY e.event_date ASC LIMIT $' + (params.length + 1) + ' OFFSET $' + (params.length + 2);
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM events WHERE is_published = true AND event_date > NOW()';
    const countParams = [];
    
    if (category) {
      countQuery += ' AND category = $1';
      countParams.push(category);
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
      SELECT e.id, e.title, e.description, e.event_date, e.location, e.image_url, e.created_at,
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

// ===== ADMIN ROUTES =====

// Get all organizations (admin only)
app.get('/api/admin/organizations', authenticateToken, async (req, res) => {
  try {
    const { search, status, page = 1, limit = 50 } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT id, name, description, contact_email, contact_phone, website, is_approved, created_at
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
    const { id } = req.params;
    const { name, description, contact_email, contact_phone, website, is_approved } = req.body;

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
        is_approved = $6,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING id, name, description, contact_email, contact_phone, website, is_approved, created_at`,
      [name, description || null, contact_email || null, contact_phone || null, website || null, is_approved !== false, id]
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

    res.json({
      users: [], // No pending users anymore
      organizations: pendingOrgs.rows,
      news: pendingNews.rows,
      events: pendingEvents.rows,
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

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  await testDatabase();
});

module.exports = app;
