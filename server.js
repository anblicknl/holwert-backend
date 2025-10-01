const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
const https = require('https');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Routes temporarily disabled due to MySQL/PostgreSQL conflict
// TODO: Fix database configuration in routes

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

// Database connection - PostgreSQL (Neon)
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

// Export pool for use in routes
module.exports.pool = pool;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'holwert-secret-key-2024';

// Test route
app.get('/', (req, res) => {
  res.json({ 
    message: 'Holwert Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'Connected to PostgreSQL (Neon)'
  });
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    database: 'Connected to PostgreSQL (Neon)'
  });
});

// Simple test endpoint
app.get('/api/test', (req, res) => {
    res.json({
    success: true,
    message: 'Test endpoint working - FIXED VERSION',
      timestamp: new Date().toISOString()
    });
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

// ===== FIXED IMAGE UPLOAD TO EXTERNAL SERVER =====
app.post('/api/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }
    
    console.log('Uploading to external server:', {
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype
    });
    
    // Create form data for external upload
    const form = new FormData();
    form.append('file', req.file.buffer, {
      filename: req.file.originalname,
      contentType: req.file.mimetype
    });
    
    // Create WordPress-style year/month folder structure
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const folder = `uploads/${year}/${month}/`;
    
    form.append('folder', folder);
    
         // Upload to external server (HTTPS; ignore hostname mismatch on cert)
         const uploadResponse = await axios.post('https://holwert.appenvloed.com/upload/upload.php', form, {
           headers: {
             ...form.getHeaders(),
             'User-Agent': 'HolwertBackend/1.0',
             'Origin': 'https://holwert.appenvloed.com',
             'Referer': 'https://holwert.appenvloed.com/'
           },
           timeout: 30000,
           maxBodyLength: Infinity,
           maxContentLength: Infinity,
           httpsAgent: new https.Agent({ rejectUnauthorized: false })
         });
    
    if (uploadResponse.data.success) {
      // Convert HTTP URL to HTTPS
      const imageUrl = uploadResponse.data.url.replace('http://', 'https://');
      
      res.json({
        message: 'Image uploaded successfully to external server',
        url: imageUrl,
        image_data: JSON.stringify({
          original: { url: imageUrl },
          full: { url: imageUrl },
          large: { url: imageUrl },
          medium_large: { url: imageUrl },
          medium: { url: imageUrl },
          thumbnail: { url: imageUrl }
        }),
        sizes: {
          original: { url: imageUrl },
          full: { url: imageUrl },
          large: { url: imageUrl },
          medium_large: { url: imageUrl },
          medium: { url: imageUrl },
          thumbnail: { url: imageUrl }
        }
      });
    } else {
      throw new Error(uploadResponse.data.message || 'Upload failed');
    }
    
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      error: 'Failed to upload image', 
      message: error.message,
      details: error.response?.data || error.toString()
    });
  }
});

// ===== FIXED IMAGE UPLOAD FOR EDITING =====
app.post('/api/upload/image', authenticateToken, async (req, res) => {
  try {
    const { imageData, filename } = req.body;

    if (!imageData) {
      return res.status(400).json({
        error: 'No image data provided',
        message: 'Please provide imageData (base64 encoded image)'
      });
    }

    console.log('Uploading edit image to external server:', {
      filename: filename || 'unknown',
      dataLength: imageData.length
    });

    // Convert base64 to buffer
    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');
    
    // Create form data for external upload
    const form = new FormData();
    const uniqueFilename = filename || `image-${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`;
    
    form.append('file', buffer, {
      filename: uniqueFilename,
      contentType: 'image/jpeg'
    });
    
    // Create WordPress-style year/month folder structure
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const folder = `uploads/${year}/${month}/`;
    
    form.append('folder', folder);
    
        // Upload to external server (HTTPS; ignore hostname mismatch on cert)
        const uploadResponse = await axios.post('https://holwert.appenvloed.com/upload/upload.php', form, {
          headers: {
            ...form.getHeaders(),
            'User-Agent': 'HolwertBackend/1.0',
            'Origin': 'https://holwert.appenvloed.com',
            'Referer': 'https://holwert.appenvloed.com/'
          },
          timeout: 30000,
          maxBodyLength: Infinity,
          maxContentLength: Infinity,
          httpsAgent: new https.Agent({ rejectUnauthorized: false })
        });
    
        if (uploadResponse.data.success) {
          // Convert HTTP URL to HTTPS
          const imageUrl = uploadResponse.data.url.replace('http://', 'https://');
    
    res.json({
            message: 'Image uploaded successfully to external server (for editing)',
      imageUrl: imageUrl,
      filename: uniqueFilename,
        note: 'Uploaded to external server - high quality maintained'
    });
    } else {
      throw new Error(uploadResponse.data.message || 'Upload failed');
    }

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({
      error: 'Failed to process image',
      message: error.message,
      details: error.response?.data || error.toString()
    });
  }
});

// Get all published news (public)
app.get('/api/news', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.image_url, n.image_data,
             n.created_at, n.updated_at,
             u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true
      ORDER BY n.created_at DESC
      LIMIT 20
    `);

    // Process image data to provide multiple variants
    const processedNews = result.rows.map(article => {
      let imageVariants = {};
      
      // Parse image_data if it exists
      if (article.image_data) {
        try {
          const imageData = JSON.parse(article.image_data);
          imageVariants = {
            original: imageData.original?.url || article.image_url,
            full: imageData.full?.url || imageData.large?.url || article.image_url,
            large: imageData.large?.url || imageData.medium_large?.url || article.image_url,
            medium: imageData.medium?.url || imageData.thumbnail?.url || article.image_url,
            thumbnail: imageData.thumbnail?.url || article.image_url,
            webp_large: imageData.webp_large?.url || imageData.large?.url || article.image_url,
            webp_medium: imageData.webp_medium?.url || imageData.medium?.url || article.image_url
          };
        } catch (error) {
          console.error('Error parsing image_data:', error);
          imageVariants = {
            original: article.image_url,
            full: article.image_url,
            large: article.image_url,
            medium: article.image_url,
            thumbnail: article.image_url
          };
        }
      } else {
        // Fallback to single image_url
        imageVariants = {
          original: article.image_url,
          full: article.image_url,
          large: article.image_url,
          medium: article.image_url,
          thumbnail: article.image_url
        };
      }

      return {
        ...article,
        image_url: imageVariants.large, // Use large variant for mobile
        image_variants: imageVariants
      };
    });

    res.json({
      news: processedNews,
      pagination: {
        page: 1,
        limit: 20,
        total: result.rows.length,
        pages: 1
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
      'INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, image_data, category, custom_category, is_published) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, title, COALESCE(content, \'\') as content, excerpt, category, custom_category, image_url, is_published, created_at',
      [title, content, excerpt || null, authorId, organization_id || null, image_url || null, req.body.image_data || null, finalCategory, finalCustomCategory, isPublished]
    );

    const message = isPublished 
      ? 'News article published successfully' 
      : 'News article created and submitted for moderation';

    res.status(201).json({
      message: message,
      articleId: result.rows[0].id,
      article: result.rows[0],
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

// Update news article
app.put('/api/news/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, excerpt, category, custom_category, organization_id, image_url, image_data } = req.body;
    const userId = req.user.userId;

    // Check if article exists and user has permission
    const existingArticle = await pool.query(
      'SELECT id, author_id, is_published FROM news WHERE id = $1',
      [id]
    );

    if (existingArticle.rows.length === 0) {
      return res.status(404).json({
        error: 'Article not found'
      });
    }

    const article = existingArticle.rows[0];
    
    // Check permissions (author or admin)
    if (article.author_id !== userId && req.user.role !== 'admin') {
      return res.status(403).json({
        error: 'Not authorized to edit this article'
      });
    }

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

    // Update article
    const result = await pool.query(
      'UPDATE news SET title = $1, content = $2, excerpt = $3, organization_id = $4, image_url = $5, image_data = $6, category = $7, custom_category = $8, updated_at = NOW() WHERE id = $9 RETURNING id, title, COALESCE(content, \'\') as content, excerpt, category, custom_category, image_url, image_data, is_published, created_at, updated_at',
      [title, content, excerpt || null, organization_id || null, image_url || null, image_data || null, finalCategory, finalCustomCategory, id]
    );

    res.json({
      message: 'Article updated successfully',
      article: result.rows[0]
    });

  } catch (error) {
    console.error('Update news error:', error);
    res.status(500).json({
      error: 'Failed to update article',
      message: error.message
    });
  }
});

// ===== AUTH ENDPOINTS =====

// Login endpoint
app.post('/api/auth/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
        field: 'general'
      });
    }

    // Find user by email
    const userResult = await pool.query(
      'SELECT id, email, password, first_name, last_name, role, is_active FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      return res.status(401).json({
        error: 'Invalid email or password',
        field: 'email',
        suggestion: 'Check your email address'
      });
    }

    const user = userResult.rows[0];

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({
        error: 'Account is deactivated',
        field: 'account',
        suggestion: 'Contact administrator'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(401).json({
        error: 'Invalid email or password',
        field: 'password',
        suggestion: 'Check your password'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { 
        userId: user.id, 
        email: user.email, 
        role: user.role 
      },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    // Return success response
    res.json({
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        role: user.role
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      error: 'Login failed',
      message: error.message
    });
  }
});

// ===== ADMIN ENDPOINTS =====

// Get all news articles (admin)
app.get('/api/admin/news', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status, category } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT n.*, u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM news n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND n.status = $${params.length}`;
    }

    if (category) {
      params.push(category);
      query += ` AND n.category = $${params.length}`;
    }

    query += ` ORDER BY n.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM news n WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND n.status = $${countParams.length}`;
    }
    
    if (category) {
      countParams.push(category);
      countQuery += ` AND n.category = $${countParams.length}`;
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
      error: 'Failed to get news articles',
      message: error.message
    });
  }
});

// Get single news article (admin)
app.get('/api/admin/news/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT n.*, u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM news n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: 'Article not found'
      });
    }

    res.json({
      article: result.rows[0]
    });

  } catch (error) {
    console.error('Get admin news article error:', error);
    res.status(500).json({
      error: 'Failed to get news article',
      message: error.message
    });
  }
});

// Get all organizations (admin)
app.get('/api/admin/organizations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*
      FROM organizations o
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND o.is_approved = $${params.length}`;
    }

    query += ` ORDER BY o.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM organizations o WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND o.is_approved = $${countParams.length}`;
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
    console.error('Get admin organizations error:', error);
    res.status(500).json({
      error: 'Failed to get organizations',
      message: error.message
    });
  }
});

// Get all events (admin)
app.get('/api/admin/events', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, u.first_name, u.last_name, o.name as organization_name
      FROM events e
      LEFT JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND e.status = $${params.length}`;
    }

    query += ` ORDER BY e.event_date DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND e.status = $${countParams.length}`;
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

// Get all users (admin)
app.get('/api/admin/users', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, role } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.*
      FROM users u
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      params.push(role);
      query += ` AND u.role = $${params.length}`;
    }

    query += ` ORDER BY u.created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users u WHERE 1=1';
    const countParams = [];
    
    if (role) {
      countParams.push(role);
      countQuery += ` AND u.role = $${countParams.length}`;
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
    console.error('Get admin users error:', error);
    res.status(500).json({
      error: 'Failed to get users',
      message: error.message
    });
  }
});

// ===== PUBLIC ORGANIZATIONS ENDPOINT =====
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

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

module.exports = app;
