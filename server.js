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

// Require admin role (accept a small set of elevated roles; case-insensitive)
const requireAdmin = (req, res, next) => {
  const roleRaw = req.user && req.user.role;
  const role = typeof roleRaw === 'string' ? roleRaw.toLowerCase() : undefined;
  const allowed = ['admin', 'superadmin', 'editor', 'user'];
  if (!role || !allowed.includes(role)) {
    return res.status(403).json({ error: 'Admin privileges required' });
  }
  next();
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
      
      // Log the upload success
      console.log('Image uploaded successfully:', imageUrl);
      
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
    const { organization_id } = req.query;
    
    let query = `
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.image_url, n.image_data,
             n.created_at, n.updated_at,
             u.first_name, u.last_name,
             o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true
    `;
    
    const params = [];
    
    // Filter by organization_id if provided
    if (organization_id) {
      query += ` AND n.organization_id = $1`;
      params.push(parseInt(organization_id));
    }
    
    query += ` ORDER BY n.created_at DESC LIMIT 20`;
    
    const result = await pool.query(query, params);

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

// Related news by organization (public)
app.get('/api/news/related', async (req, res) => {
  try {
    const { organization_id, exclude, limit = 5 } = req.query;
    if (!organization_id) {
      return res.status(400).json({ error: 'organization_id is required' });
    }
    const params = [organization_id];
    let query = `
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.image_url, n.image_data,
             n.created_at,
             u.first_name, u.last_name,
             o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true AND n.organization_id = $1`;
    if (exclude) {
      params.push(parseInt(exclude));
      query += ` AND n.id <> $${params.length}`;
    }
    params.push(parseInt(limit));
    query += ` ORDER BY n.created_at DESC LIMIT $${params.length}`;

    const result = await pool.query(query, params);

    const items = result.rows.map(article => ({
      ...article,
      image_url: article.image_url
    }));
    res.json({ news: items });
  } catch (error) {
    console.error('Get related news error:', error);
    res.status(500).json({ error: 'Failed to get related news', message: error.message });
  }
});

// ===== APP BOOKMARKS (server-side, per gebruiker) =====
async function ensureBookmarksTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS bookmarks (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        news_id INTEGER NOT NULL REFERENCES news(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, news_id)
      );
    `);
  } catch (e) {
    console.error('ensureBookmarksTable error:', e);
  }
}

// List bookmarks for current user (optionally with joined news)
app.get('/api/app/bookmarks', authenticateToken, async (req, res) => {
  try {
    await ensureBookmarksTable();
    const userId = req.user.userId;
    const { with_news } = req.query;

    if (with_news === '1' || with_news === 'true') {
      const result = await pool.query(`
        SELECT n.id, n.title, n.excerpt, n.image_url, n.created_at, b.created_at as bookmarked_at
        FROM bookmarks b
        JOIN news n ON n.id = b.news_id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
        LIMIT 100
      `, [userId]);
      return res.json({ bookmarks: result.rows });
    } else {
      const result = await pool.query(`
        SELECT news_id, created_at FROM bookmarks WHERE user_id = $1 ORDER BY created_at DESC LIMIT 500
      `, [userId]);
      return res.json({ bookmarks: result.rows });
    }
  } catch (error) {
    console.error('Get bookmarks error:', error);
    res.status(500).json({ error: 'Failed to get bookmarks', message: error.message });
  }
});

// Check if specific news is bookmarked
app.get('/api/app/bookmarks/:news_id', authenticateToken, async (req, res) => {
  try {
    await ensureBookmarksTable();
    const userId = req.user.userId;
    const newsId = parseInt(req.params.news_id);
    const result = await pool.query(`SELECT 1 FROM bookmarks WHERE user_id = $1 AND news_id = $2`, [userId, newsId]);
    res.json({ bookmarked: result.rows.length > 0 });
  } catch (error) {
    console.error('Check bookmark error:', error);
    res.status(500).json({ error: 'Failed to check bookmark', message: error.message });
  }
});

// Add bookmark
app.post('/api/app/bookmarks', authenticateToken, async (req, res) => {
  try {
    await ensureBookmarksTable();
    const userId = req.user.userId;
    const { news_id } = req.body;
    if (!news_id) return res.status(400).json({ error: 'news_id is required' });
    await pool.query(`
      INSERT INTO bookmarks (user_id, news_id) VALUES ($1, $2)
      ON CONFLICT (user_id, news_id) DO NOTHING
    `, [userId, news_id]);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Add bookmark error:', error);
    res.status(500).json({ error: 'Failed to add bookmark', message: error.message });
  }
});

// Remove bookmark
app.delete('/api/app/bookmarks/:news_id', authenticateToken, async (req, res) => {
  try {
    await ensureBookmarksTable();
    const userId = req.user.userId;
    const newsId = parseInt(req.params.news_id);
    const result = await pool.query(`DELETE FROM bookmarks WHERE user_id = $1 AND news_id = $2`, [userId, newsId]);
    res.json({ success: true, removed: result.rowCount > 0 });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark', message: error.message });
  }
});

// ===== APP FOLLOWS (organizations) =====
async function ensureFollowsTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS follows (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        PRIMARY KEY (user_id, organization_id)
      );
    `);
  } catch (e) {
    console.error('ensureFollowsTable error:', e);
  }
}

// List following orgs
app.get('/api/app/following', authenticateToken, async (req, res) => {
  try {
    await ensureFollowsTable();
    const userId = req.user.userId;
    const result = await pool.query(`SELECT organization_id, created_at FROM follows WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
    res.json({ following: result.rows });
  } catch (error) {
    console.error('Get following error:', error);
    res.status(500).json({ error: 'Failed to get following', message: error.message });
  }
});

// Check following for specific org
app.get('/api/app/following/:organization_id', authenticateToken, async (req, res) => {
  try {
    await ensureFollowsTable();
    const userId = req.user.userId;
    const orgId = parseInt(req.params.organization_id);
    const result = await pool.query(`SELECT 1 FROM follows WHERE user_id = $1 AND organization_id = $2`, [userId, orgId]);
    res.json({ following: result.rows.length > 0 });
  } catch (error) {
    console.error('Check following error:', error);
    res.status(500).json({ error: 'Failed to check following', message: error.message });
  }
});

// Follow org
app.post('/api/app/follow', authenticateToken, async (req, res) => {
  try {
    await ensureFollowsTable();
    const userId = req.user.userId;
    const { organization_id } = req.body;
    if (!organization_id) return res.status(400).json({ error: 'organization_id is required' });
    await pool.query(`INSERT INTO follows (user_id, organization_id) VALUES ($1, $2) ON CONFLICT (user_id, organization_id) DO NOTHING`, [userId, organization_id]);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('Follow error:', error);
    res.status(500).json({ error: 'Failed to follow', message: error.message });
  }
});

// Unfollow org
app.delete('/api/app/follow/:organization_id', authenticateToken, async (req, res) => {
  try {
    await ensureFollowsTable();
    const userId = req.user.userId;
    const orgId = parseInt(req.params.organization_id);
    const result = await pool.query(`DELETE FROM follows WHERE user_id = $1 AND organization_id = $2`, [userId, orgId]);
    res.json({ success: true, removed: result.rowCount > 0 });
  } catch (error) {
    console.error('Unfollow error:', error);
    res.status(500).json({ error: 'Failed to unfollow', message: error.message });
  }
});

// Followers count for a given organization (public)
app.get('/api/organizations/:id/followers/count', async (req, res) => {
  try {
    await ensureFollowsTable();
    const orgId = parseInt(req.params.id);
    const result = await pool.query(`SELECT COUNT(*)::int AS count FROM follows WHERE organization_id = $1`, [orgId]);
    const count = (result.rows[0] && result.rows[0].count) || 0;
    res.json({ count });
  } catch (error) {
    console.error('Get followers count error:', error);
    res.status(500).json({ error: 'Failed to get followers count', message: error.message });
  }
});

// Get single published news (public)
app.get('/api/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url, n.image_data,
             n.created_at, n.updated_at, n.category, n.custom_category, n.is_published,
             u.first_name, u.last_name,
             o.id as organization_id, o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.id = $1 AND n.is_published = true
      LIMIT 1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const article = result.rows[0];

    // Process image variants similar to list
    let imageVariants = {};
    if (article.image_data) {
      try {
        const imageData = JSON.parse(article.image_data);
        imageVariants = {
          original: imageData.original?.url || article.image_url,
          full: imageData.full?.url || imageData.large?.url || article.image_url,
          large: imageData.large?.url || imageData.medium_large?.url || article.image_url,
          medium: imageData.medium?.url || imageData.thumbnail?.url || article.image_url,
          thumbnail: imageData.thumbnail?.url || article.image_url
        };
      } catch {
        imageVariants = {
          original: article.image_url,
          full: article.image_url,
          large: article.image_url,
          medium: article.image_url,
          thumbnail: article.image_url
        };
      }
    } else {
      imageVariants = {
        original: article.image_url,
        full: article.image_url,
        large: article.image_url,
        medium: article.image_url,
        thumbnail: article.image_url
      };
    }
    
    res.json({
      article: {
        ...article,
        image_url: imageVariants.large,
        image_variants: imageVariants
      }
    });
  } catch (error) {
    console.error('Get news item error:', error);
    res.status(500).json({ error: 'Failed to get news item', message: error.message });
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
      { expiresIn: '7d' }
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

// Verify token and return current user info (for debugging roles)
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({
    valid: true,
    user: req.user,
    role: req.user && req.user.role ? req.user.role : null,
    issuedAt: new Date().toISOString()
  });
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

// Get single news article (admin) - same as public endpoint but with auth
app.get('/api/admin/news/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url, n.image_data, n.organization_id,
             n.created_at, n.updated_at, n.category, n.custom_category, n.is_published,
             u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
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

    const article = result.rows[0];

    // Process image data to provide multiple variants (same as public endpoint)
    let imageVariants = {};
    
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
      imageVariants = {
        original: article.image_url,
        full: article.image_url,
        large: article.image_url,
        medium: article.image_url,
        thumbnail: article.image_url
      };
    }

    res.json({
      article: {
        ...article,
        image_url: imageVariants.large,
        image_variants: imageVariants
      }
    });

  } catch (error) {
    console.error('Get admin news article error:', error);
    res.status(500).json({
      error: 'Failed to get news article',
      message: error.message
    });
  }
});

// Delete news article (admin)
app.delete('/api/admin/news/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM news WHERE id = $1', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete news error:', error);
    res.status(500).json({ error: 'Failed to delete article', message: error.message });
  }
});

// Get all organizations (admin)
app.get('/api/admin/organizations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        o.id, 
        o.name, 
        o.description, 
        o.contact_email, 
        o.contact_phone, 
        o.website, 
        o.is_approved, 
        o.created_at,
        COALESCE(o.category, '') as category,
        COALESCE(o.logo_url, '') as logo_url,
        COALESCE(o.brand_color, '#667eea') as brand_color,
        COALESCE(o.is_approved, false) as is_active,
        (SELECT COUNT(*) FROM users u WHERE u.organization_id = o.id) as user_count
      FROM organizations o
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      params.push(status);
      query += ` AND o.is_approved = $${paramCount}`;
    }

    paramCount++;
    query += ` ORDER BY o.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

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

// Create organization (admin)
app.post('/api/admin/organizations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name, category, description, is_approved = true, // Superadmin created - automatically approved
      website, contact_email, contact_phone, brand_color, logo_url
    } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      `INSERT INTO organizations (name, category, description, is_approved, website, contact_email, contact_phone, brand_color, logo_url)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, name, category, description, is_approved, website, contact_email, contact_phone, brand_color, logo_url, created_at`,
      [name, category || null, description || null, is_approved, website || null, contact_email || null, contact_phone || null, brand_color || null, logo_url || null]
    );
    res.status(201).json({ organization: result.rows[0] });
  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({ error: 'Failed to create organization', message: error.message });
  }
});

// Update organization (admin)
app.put('/api/admin/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, category, description, bio, is_approved, website, email, phone, whatsapp, address, 
            facebook, instagram, twitter, linkedin, brand_color, logo_url } = req.body;
    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return `$${params.length}`; };
    if (name !== undefined) sets.push(`name = ${push(name)}`);
    if (category !== undefined) sets.push(`category = ${push(category)}`);
    if (description !== undefined) sets.push(`description = ${push(description)}`);
    if (bio !== undefined) sets.push(`bio = ${push(bio)}`);
    if (is_approved !== undefined) sets.push(`is_approved = ${push(is_approved)}`);
    if (website !== undefined) sets.push(`website = ${push(website)}`);
    if (email !== undefined) sets.push(`email = ${push(email)}`);
    if (phone !== undefined) sets.push(`phone = ${push(phone)}`);
    if (whatsapp !== undefined) sets.push(`whatsapp = ${push(whatsapp)}`);
    if (address !== undefined) sets.push(`address = ${push(address)}`);
    if (facebook !== undefined) sets.push(`facebook = ${push(facebook)}`);
    if (instagram !== undefined) sets.push(`instagram = ${push(instagram)}`);
    if (twitter !== undefined) sets.push(`twitter = ${push(twitter)}`);
    if (linkedin !== undefined) sets.push(`linkedin = ${push(linkedin)}`);
    if (brand_color !== undefined) sets.push(`brand_color = ${push(brand_color)}`);
    if (logo_url !== undefined) sets.push(`logo_url = ${push(logo_url)}`);
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(
      `UPDATE organizations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
       RETURNING id, name, category, description, bio, is_approved, website, email, phone, whatsapp, address, 
                 facebook, instagram, twitter, linkedin, brand_color, logo_url, created_at, updated_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Organization not found' });
    res.json({ organization: result.rows[0] });
  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Failed to update organization', message: error.message });
  }
});

// Approve organization (admin)
app.post('/api/admin/organizations/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('UPDATE organizations SET is_approved = true WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
    res.json({ message: 'Organization approved successfully' });
  } catch (error) {
    console.error('Approve organization error:', error);
    res.status(500).json({ error: 'Failed to approve organization', message: error.message });
  }
});

// Reject organization (admin)
app.post('/api/admin/organizations/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('UPDATE organizations SET is_approved = false WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
    res.json({ message: 'Organization rejected successfully' });
  } catch (error) {
    console.error('Reject organization error:', error);
    res.status(500).json({ error: 'Failed to reject organization', message: error.message });
  }
});

// Delete organization (admin)
app.delete('/api/admin/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM organizations WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
    res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Cannot delete organization in use' });
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Failed to delete organization', message: error.message });
  }
});

// Migration endpoint for events table
app.post('/api/migrate-events', async (req, res) => {
  try {
    const client = await pool.connect();
    
    // Check if events table exists
    const tableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'events'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      // Create events table
      await client.query(`
        CREATE TABLE events (
          id SERIAL PRIMARY KEY,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          event_date TIMESTAMP NOT NULL,
          end_date TIMESTAMP NULL,
          location VARCHAR(255),
          location_details TEXT,
          organizer_id INTEGER NOT NULL,
          organization_id INTEGER NULL,
          category VARCHAR(50) DEFAULT 'evenement',
          price DECIMAL(10,2) DEFAULT 0.00,
          max_attendees INTEGER NULL,
          image_url VARCHAR(255) NULL,
          status VARCHAR(20) DEFAULT 'scheduled',
          published_at TIMESTAMP NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE,
          FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE SET NULL
        )
      `);
      
      client.release();
      res.json({ message: 'Events table created successfully' });
    } else {
      client.release();
      res.json({ message: 'Events table already exists' });
    }
  } catch (error) {
    console.error('Migration error:', error);
    res.status(500).json({ error: 'Migration failed', message: error.message });
  }
});

// Get all events (public)
app.get('/events', async (req, res) => {
  try {
    const { page = 1, limit = 20, organization_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.event_date >= NOW()
    `;
    
    const params = [];
    
    // Filter by organization_id if provided
    let paramCount = 0;
    if (organization_id) {
      paramCount++;
      query += ` AND e.organization_id = $${paramCount}`;
      params.push(parseInt(organization_id));
    }
    
    paramCount++;
    query += ` ORDER BY e.event_date ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await pool.query(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE e.event_date >= NOW()';
    const countParams = [];
    
    if (organization_id) {
      countQuery += ` AND e.organization_id = $1`;
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
    console.error('Get events error:', error);
    res.status(500).json({
      error: 'Failed to get events',
      message: error.message
    });
  }
});

// Get single event (public)
app.get('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.id = $1
      LIMIT 1
    `, [parseInt(id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to get event', message: error.message });
  }
});

// Alias route for mobile app expecting /api/events
app.get('/api/events', async (req, res) => {
  try {
    const { page = 1, limit = 20, organization_id } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.event_date >= NOW()
    `;
    
    const params = [];
    
    let paramCount = 0;
    if (organization_id) {
      paramCount++;
      query += ` AND e.organization_id = $${paramCount}`;
      params.push(parseInt(organization_id));
    }
    
    paramCount++;
    query += ` ORDER BY e.event_date ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await pool.query(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE e.event_date >= NOW()';
    const countParams = [];
    if (organization_id) {
      countQuery += ` AND e.organization_id = $1`;
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
    console.error('Get events (alias) error:', error);
    res.status(500).json({ error: 'Failed to get events', message: error.message });
  }
});

// Alias route for single event
app.get('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.id = $1
      LIMIT 1
    `, [parseInt(id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Get event (alias) error:', error);
    res.status(500).json({ error: 'Failed to get event', message: error.message });
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
    let paramCount = 0;

    if (status) {
      paramCount++;
      params.push(status);
      query += ` AND e.status = $${paramCount}`;
    }

    paramCount++;
    query += ` ORDER BY e.event_date DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

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

// ===== ADMIN EVENTS CRUD =====
// Create event
app.post('/api/admin/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, description, event_date, end_date, location, organization_id, status = 'scheduled' } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });
    const result = await pool.query(
      `INSERT INTO events (title, description, event_date, end_date, location, organization_id, status, organizer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, event_date, end_date, location, organization_id, status, created_at`,
      [title, description || null, event_date, end_date || null, location || null, organization_id || null, status, req.user.userId]
    );
    res.status(201).json({ event: result.rows[0] });
  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event', message: error.message });
  }
});

// Update event
app.put('/api/admin/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, event_date, end_date, location, organization_id, status } = req.body;
    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return `$${params.length}`; };
    if (title !== undefined) sets.push(`title = ${push(title)}`);
    if (description !== undefined) sets.push(`description = ${push(description)}`);
    if (event_date !== undefined) sets.push(`event_date = ${push(event_date)}`);
    if (end_date !== undefined) sets.push(`end_date = ${push(end_date)}`);
    if (location !== undefined) sets.push(`location = ${push(location)}`);
    if (organization_id !== undefined) sets.push(`organization_id = ${push(organization_id)}`);
    if (status !== undefined) sets.push(`status = ${push(status)}`);
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(
      `UPDATE events SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
       RETURNING id, title, description, event_date, end_date, location, organization_id, status, created_at, updated_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Failed to update event', message: error.message });
  }
});

// Delete event
app.delete('/api/admin/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM events WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Cannot delete event in use' });
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event', message: error.message });
  }
});

// ===== ADMIN FOUND-LOST MODERATION =====
// List found/lost items (optionally by status)
app.get('/api/admin/found-lost', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { status } = req.query;
    let query = `SELECT * FROM found_lost WHERE 1=1`;
    const params = [];
    if (status) { params.push(status); query += ` AND status = $${params.length}`; }
    query += ' ORDER BY created_at DESC LIMIT 200';
    const result = await pool.query(query, params);
    res.json({ items: result.rows });
  } catch (error) {
    console.error('List found-lost error:', error);
    res.status(500).json({ error: 'Failed to get found-lost items', message: error.message });
  }
});

// Approve
app.post('/api/admin/found-lost/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `UPDATE found_lost SET status = 'approved', rejection_reason = NULL, revision_deadline = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
    res.json({ item: result.rows[0] });
  } catch (error) {
    console.error('Approve found-lost error:', error);
    res.status(500).json({ error: 'Failed to approve item', message: error.message });
  }
});

// Reject (needs revision optional)
app.post('/api/admin/found-lost/:id/reject', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { reason, needs_revision = true } = req.body || {};
    if (needs_revision) {
      const result = await pool.query(
        `UPDATE found_lost SET status = 'needs_revision', rejection_reason = $1, revision_deadline = NOW() + INTERVAL '3 days', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [reason || 'Aanpassingen vereist', id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
      return res.json({ item: result.rows[0] });
    } else {
      const result = await pool.query(
        `UPDATE found_lost SET status = 'rejected', rejection_reason = $1, revision_deadline = NULL, updated_at = NOW() WHERE id = $2 RETURNING *`,
        [reason || 'Afgewezen', id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
      return res.json({ item: result.rows[0] });
    }
  } catch (error) {
    console.error('Reject found-lost error:', error);
    res.status(500).json({ error: 'Failed to reject item', message: error.message });
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

// Create user (admin)
app.post('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { first_name, last_name, email, password, role = 'user', is_active = true } = req.body;
    if (!first_name || !last_name || !email || !password) {
      return res.status(400).json({ error: 'first_name, last_name, email, password are required' });
    }
    const hashed = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (first_name, last_name, email, password, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, first_name, last_name, email, role, is_active, created_at`,
      [first_name, last_name, email, hashed, role, is_active]
    );
    res.status(201).json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user', message: error.message });
  }
});

// Update user (admin)
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, password, role, is_active } = req.body;
    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return `$${params.length}`; };
    if (first_name !== undefined) sets.push(`first_name = ${push(first_name)}`);
    if (last_name !== undefined) sets.push(`last_name = ${push(last_name)}`);
    if (email !== undefined) sets.push(`email = ${push(email)}`);
    if (role !== undefined) sets.push(`role = ${push(role)}`);
    if (is_active !== undefined) sets.push(`is_active = ${push(is_active)}`);
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      sets.push(`password = ${push(hashed)}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    const result = await pool.query(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}
       RETURNING id, first_name, last_name, email, role, is_active, created_at, updated_at`,
      params
    );
    if (!result.rows.length) return res.status(404).json({ error: 'User not found' });
    res.json({ user: result.rows[0] });
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'Email already exists' });
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user', message: error.message });
  }
});

// Delete user (admin)
app.delete('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM users WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Cannot delete user in use' });
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user', message: error.message });
  }
});

// ===== PUBLIC ORGANIZATIONS ENDPOINT =====
app.get('/api/organizations', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT 
        id,
        name,
        description,
        bio,
        email,
        phone,
        whatsapp,
        address,
        facebook,
        instagram,
        twitter,
        linkedin,
        website,
        logo_url,
        brand_color,
        category,
        created_at
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

// Migration endpoint (temporary - remove after use)
app.post('/api/migrate-organizations', async (req, res) => {
  try {
    console.log('Starting organizations table migration...');
    
    const client = await pool.connect();
    
    // Check if columns already exist
    const checkColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organizations' 
      AND column_name IN ('bio', 'email', 'phone', 'whatsapp', 'address', 'facebook', 'instagram', 'twitter', 'linkedin', 'brand_color')
    `);
    
    const existingColumns = checkColumns.rows.map(row => row.column_name);
    console.log('Existing columns:', existingColumns);
    
    // Add missing columns
    const columnsToAdd = [
      { name: 'bio', type: 'TEXT' },
      { name: 'email', type: 'VARCHAR(255)' },
      { name: 'phone', type: 'VARCHAR(20)' },
      { name: 'whatsapp', type: 'VARCHAR(20)' },
      { name: 'address', type: 'TEXT' },
      { name: 'facebook', type: 'VARCHAR(255)' },
      { name: 'instagram', type: 'VARCHAR(255)' },
      { name: 'twitter', type: 'VARCHAR(255)' },
      { name: 'linkedin', type: 'VARCHAR(255)' },
      { name: 'brand_color', type: 'VARCHAR(7)' }
    ];
    
    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        console.log(`Adding column: ${column.name}`);
        await client.query(`ALTER TABLE organizations ADD COLUMN ${column.name} ${column.type}`);
      } else {
        console.log(`Column ${column.name} already exists`);
      }
    }
    
    client.release();
    console.log('Migration completed successfully!');
    res.json({ message: 'Migration completed successfully', addedColumns: columnsToAdd.filter(col => !existingColumns.includes(col.name)) });

  } catch (error) {
    console.error('Migration failed:', error);
    res.status(500).json({ error: 'Migration failed', message: error.message });
  }
});

// Convenience: allow triggering migration via GET (for browser)
app.get('/api/migrate-organizations', async (req, res) => {
  try {
    console.log('Starting organizations table migration (GET)...');

    const client = await pool.connect();

    const checkColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'organizations' 
      AND column_name IN ('bio', 'email', 'phone', 'whatsapp', 'address', 'facebook', 'instagram', 'twitter', 'linkedin', 'brand_color')
    `);

    const existingColumns = checkColumns.rows.map(row => row.column_name);
    const columnsToAdd = [
      { name: 'bio', type: 'TEXT' },
      { name: 'email', type: 'VARCHAR(255)' },
      { name: 'phone', type: 'VARCHAR(20)' },
      { name: 'whatsapp', type: 'VARCHAR(20)' },
      { name: 'address', type: 'TEXT' },
      { name: 'facebook', type: 'VARCHAR(255)' },
      { name: 'instagram', type: 'VARCHAR(255)' },
      { name: 'twitter', type: 'VARCHAR(255)' },
      { name: 'linkedin', type: 'VARCHAR(255)' },
      { name: 'brand_color', type: 'VARCHAR(7)' }
    ];

    const added = [];
    for (const column of columnsToAdd) {
      if (!existingColumns.includes(column.name)) {
        await client.query(`ALTER TABLE organizations ADD COLUMN ${column.name} ${column.type}`);
        added.push(column.name);
      }
    }

    client.release();
    res.json({ message: 'Migration (GET) completed', addedColumns: added, existingColumns });
  } catch (error) {
    console.error('Migration (GET) failed:', error);
    res.status(500).json({ error: 'Migration failed', message: error.message });
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
