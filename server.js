const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
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
    const { email, password, first_name, last_name, phone } = req.body;

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

    // Create user
    const result = await pool.query(
      'INSERT INTO users (email, password, first_name, last_name, phone) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, first_name, last_name, role, created_at',
      [email, hashedPassword, first_name, last_name, phone]
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

// ===== CONTENT ROUTES =====

// Create news article with workflow logic
app.post('/api/news', authenticateToken, async (req, res) => {
  try {
    const { title, content, category, organization_id } = req.body;
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
      'INSERT INTO news (title, content, author_id, organization_id, is_published) VALUES ($1, $2, $3, $4, $5) RETURNING id',
      [title, content, authorId, organization_id || null, isPublished]
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
    const { title, description, event_date, location, organization_id } = req.body;
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
      'INSERT INTO events (title, description, event_date, location, organizer_id, organization_id, is_published) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id',
      [title, description, event_date, location, organizerId, organization_id || null, isPublished]
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

    // Get pending content (users and organizations that need approval)
    const [pendingUsers, pendingOrgs, pendingNews, pendingEvents] = await Promise.all([
      pool.query('SELECT id, email, first_name, last_name, created_at FROM users WHERE is_active = false'),
      pool.query('SELECT id, name, contact_email, created_at FROM organizations WHERE is_approved = false'),
      pool.query('SELECT id, title, author_id, created_at FROM news WHERE is_published = false'),
      pool.query('SELECT id, title, organizer_id, event_date, created_at FROM events WHERE is_published = false')
    ]);

    res.json({
      users: pendingUsers.rows,
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
