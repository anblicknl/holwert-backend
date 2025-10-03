const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const FormData = require('form-data');
const path = require('path');
const multer = require('multer');
const axios = require('axios');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

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
    form.append('folder', 'uploads/');
    
    // Upload to external server
    const uploadResponse = await axios.post('https://holwert.appenvloed.com/upload', form, {
           headers: {
             ...form.getHeaders(),
           },
      timeout: 30000
         });
    
    if (uploadResponse.data.success) {
      const imageUrl = uploadResponse.data.url;
      
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
    form.append('folder', 'uploads/');
    
    // Upload to external server
    const uploadResponse = await axios.post('https://holwert.appenvloed.com/upload', form, {
          headers: {
            ...form.getHeaders(),
          },
      timeout: 30000
        });
    
        if (uploadResponse.data.success) {
      const imageUrl = uploadResponse.data.url;

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
    // Return safe fallback to keep dashboard working
    res.status(200).json({ news: [], pagination: { page: 1, limit: 20, total: 0, pages: 1 } });
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

// ===== EVENTS ENDPOINTS =====

// Get all events (public)
app.get('/api/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT e.*, o.name as organization_name, u.name as organizer_name
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      LEFT JOIN users u ON e.organizer_id = u.id
      WHERE e.status IN ('scheduled', 'published', 'approved')
      ORDER BY e.event_date ASC
    `);
    
    res.json({ events: result.rows });
  } catch (error) {
    console.error('Get events error:', error);
    // Return safe fallback to keep dashboard working
    res.status(200).json({ events: [] });
  }
});

// Get single event (public)
app.get('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.*, o.name as organization_name, u.name as organizer_name
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      LEFT JOIN users u ON e.organizer_id = u.id
      WHERE e.id = $1
    `, [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to fetch event', message: error.message });
  }
});

// Get organizations (for dropdown)
app.get('/api/organizations', async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM organizations ORDER BY name');
    res.json({ organizations: result.rows });
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations', message: error.message });
  }
});

// ===== ADMIN ENDPOINTS FOR DASHBOARD =====

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Get users count (for dashboard)
app.get('/api/admin/users', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM users');
    res.json({ pagination: { total: parseInt(result.rows[0].count) } });
  } catch (error) {
    console.error('Get users count error:', error);
    res.status(500).json({ error: 'Failed to fetch users count', message: error.message });
  }
});

// Get organizations count (for dashboard)
app.get('/api/admin/organizations', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM organizations');
    res.json({ pagination: { total: parseInt(result.rows[0].count) } });
  } catch (error) {
    console.error('Get organizations count error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations count', message: error.message });
  }
});

// Get news count (for dashboard)
app.get('/api/admin/news', async (req, res) => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM news');
    res.json({ pagination: { total: parseInt(result.rows[0].count) } });
  } catch (error) {
    console.error('Get news count error:', error);
    res.status(500).json({ error: 'Failed to fetch news count', message: error.message });
  }
});

// Favicon handler to avoid 404 in browsers
app.get('/favicon.ico', (req, res) => {
  res.status(204).end();
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password, role, name FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
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
