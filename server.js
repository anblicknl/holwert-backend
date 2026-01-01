const express = require('express');
const cors = require('cors');
const compression = require('compression');
const mysql = require('mysql2/promise');
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

// Simple in-memory cache for read queries (performance optimization)
const cache = new Map();
const CACHE_TTL = {
  stats: 30 * 1000, // 30 seconden voor stats
  moderation: 20 * 1000, // 20 seconden voor moderation count
  organizations: 10 * 1000, // 10 seconden voor organizations list
  default: 5 * 1000 // 5 seconden default
};

function getCacheKey(endpoint, params = {}) {
  return `${endpoint}:${JSON.stringify(params)}`;
}

function getCached(key) {
  const cached = cache.get(key);
  if (cached && cached.expires > Date.now()) {
    return cached.data;
  }
  cache.delete(key);
  return null;
}

function setCache(key, data, ttl = CACHE_TTL.default) {
  cache.set(key, {
    data,
    expires: Date.now() + ttl
  });
}

function invalidateCache(pattern) {
  // Invalidate all cache entries that match the pattern
  for (const key of cache.keys()) {
    if (key.includes(pattern)) {
      cache.delete(key);
    }
  }
}

// Cleanup old cache entries every minute
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of cache.entries()) {
    if (value.expires <= now) {
      cache.delete(key);
    }
  }
}, 60000);

// Middleware
app.use(compression()); // Compress responses for faster transfer
app.use(cors());
app.use(express.json({ limit: '50mb' })); // Verhoogd voor afbeelding uploads
app.use(express.urlencoded({ limit: '50mb', extended: true }));

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

// Database connection - MySQL
const dbConfig = {
  host: process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
  port: process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
  user: process.env.DB_USER || process.env.MYSQL_USER || 'root',
  password: process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
  database: process.env.DB_NAME || process.env.MYSQL_DATABASE || 'holwert',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  charset: 'utf8mb4',
  connectTimeout: 5000, // 5 seconden timeout voor connectie
  acquireTimeout: 5000, // 5 seconden timeout voor het krijgen van een connectie
  timeout: 10000 // 10 seconden timeout voor queries
};

// Log database config (zonder password)
console.log('[MySQL] Database config:', {
  host: dbConfig.host,
  port: dbConfig.port,
  user: dbConfig.user,
  database: dbConfig.database,
  hasPassword: !!dbConfig.password
});

const pool = mysql.createPool(dbConfig);

// Export pool for use in routes
module.exports.pool = pool;

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'holwert-secret-key-2024';

// PHP Proxy URL (fallback als direct MySQL niet werkt)
const PHP_PROXY_URL = process.env.PHP_PROXY_URL || 'https://holwert.appenvloed.com/admin/db-proxy.php';
const PHP_PROXY_API_KEY = process.env.PHP_PROXY_API_KEY || 'holwert-db-proxy-2026-secure-key-change-in-production';

// Helper om query via PHP proxy uit te voeren
async function executeQueryViaProxy(query, params = [], action = 'execute') {
  try {
    console.log(`[PHP Proxy] Executing ${action} query via proxy...`);
    console.log(`[PHP Proxy] Query: ${query.substring(0, 100)}...`);
    console.log(`[PHP Proxy] Params count: ${params.length}`);
    
    const response = await axios.post(PHP_PROXY_URL, {
      action: action,
      query: query,
      params: params
    }, {
      headers: {
        'X-API-Key': PHP_PROXY_API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 10000 // 10 seconden timeout (verlaagd voor snellere failures)
    });

    console.log(`[PHP Proxy] Response status: ${response.status}`);
    console.log(`[PHP Proxy] Response data:`, JSON.stringify(response.data).substring(0, 200));

    // Check for error in response
    if (response.data.error) {
      throw new Error(`PHP Proxy error: ${response.data.error} - ${response.data.message || ''}`);
    }

    if (action === 'insert') {
      const insertId = response.data.insertId ? parseInt(response.data.insertId) : null;
      console.log(`[PHP Proxy] Insert result - insertId: ${insertId}, affectedRows: ${response.data.affectedRows}`);
      
      if (!insertId) {
        throw new Error('PHP Proxy returned null insertId for INSERT query');
      }
      
      return {
        rows: [{ id: insertId }],
        rowCount: response.data.affectedRows || 0,
        insertId: insertId
      };
    }

    if (action === 'update' || action === 'delete') {
      return {
        rows: [],
        rowCount: response.data.affectedRows || 0
      };
    }

    return {
      rows: response.data.rows || [],
      rowCount: response.data.rowCount || response.data.affectedRows || 0
    };
  } catch (error) {
    console.error('[PHP Proxy] Error:', error.message);
    if (error.response) {
      console.error('[PHP Proxy] Response status:', error.response.status);
      console.error('[PHP Proxy] Response data:', error.response.data);
    }
    throw error;
  }
}

// Helper function voor query execution (MySQL compatible)
// Probeert eerst direct MySQL, fallback naar PHP proxy
async function executeQuery(query, params = []) {
  // Converteer $1, $2, $3 naar ? voor MySQL
  let mysqlQuery = query.replace(/\$(\d+)/g, '?');
  
  // Converteer ILIKE naar LIKE (case-insensitive)
  mysqlQuery = mysqlQuery.replace(/ILIKE/gi, 'LIKE');
  
  try {
    // Probeer direct MySQL
    if (params && params.length > 0) {
      const [result] = await pool.execute(mysqlQuery, params);
      return {
        rows: Array.isArray(result) ? result : [result],
        rowCount: result.affectedRows || result.length || 0
      };
    } else {
      const [result] = await pool.execute(mysqlQuery);
      return {
        rows: Array.isArray(result) ? result : [result],
        rowCount: result.affectedRows || result.length || 0
      };
    }
  } catch (error) {
    // Als direct MySQL faalt, gebruik PHP proxy
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log('[MySQL] Direct connection failed, using PHP proxy...');
      
      // Detect query type voor juiste action
      const queryUpper = mysqlQuery.trim().toUpperCase();
      let proxyAction = 'execute'; // default voor SELECT
      
      if (queryUpper.startsWith('INSERT')) {
        proxyAction = 'insert';
      } else if (queryUpper.startsWith('UPDATE')) {
        proxyAction = 'update';
      } else if (queryUpper.startsWith('DELETE')) {
        proxyAction = 'delete';
      }
      
      return await executeQueryViaProxy(mysqlQuery, params, proxyAction);
    }
    throw error;
  }
}

// Helper voor INSERT queries met LAST_INSERT_ID (MySQL equivalent van RETURNING)
async function executeInsert(query, params = []) {
  let mysqlQuery = query.replace(/\$(\d+)/g, '?');
  mysqlQuery = mysqlQuery.replace(/RETURNING\s+id/gi, '');
  mysqlQuery = mysqlQuery.replace(/RETURNING\s+\*/gi, '');
  
  try {
    // Probeer direct MySQL
    if (params && params.length > 0) {
      const [result] = await pool.execute(mysqlQuery, params);
      const insertId = result.insertId;
      return {
        rows: insertId ? [{ id: insertId }] : [],
        rowCount: result.affectedRows || 0,
        insertId: insertId
      };
    } else {
      const [result] = await pool.execute(mysqlQuery);
      return {
        rows: result.insertId ? [{ id: result.insertId }] : [],
        rowCount: result.affectedRows || 0,
        insertId: result.insertId
      };
    }
  } catch (error) {
    // Als direct MySQL faalt, gebruik PHP proxy
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log('[MySQL] Direct connection failed, using PHP proxy for INSERT...');
      return await executeQueryViaProxy(mysqlQuery, params, 'insert');
    }
    throw error;
  }
}

// Test route
app.get('/', async (req, res) => {
  try {
    await executeQuery('SELECT 1');
    const dbHost = process.env.DATABASE_URL?.includes('supabase.co') ? 'Supabase' : 
                   process.env.DATABASE_URL?.includes('neon.tech') ? 'Neon' : 'PostgreSQL';
  res.json({ 
    message: 'Holwert Backend is running!',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
      database: `Connected to ${dbHost}`
    });
  } catch (error) {
    res.json({ 
      message: 'Holwert Backend is running!',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: 'Database connection failed',
      error: error.message
    });
  }
});

// Setup admin user (one-time use endpoint - remove after use!)
app.get('/api/setup-admin', async (req, res) => {
  try {
    const email = 'admin@holwert.nl';
    const password = 'admin123';
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Check if admin already exists
    const existingUser = await executeQuery(
      'SELECT id, email, first_name, last_name FROM users WHERE email = ?',
      [email]
    );
    
    let userId;
    
    if (existingUser.rows.length > 0) {
      // Update existing admin
      await executeQuery(
        'UPDATE users SET password_hash = ?, role = ?, is_active = true WHERE email = ?',
        [hashedPassword, 'admin', email]
      );
      
      userId = existingUser.rows[0].id;
      const user = existingUser.rows[0];
      
      // Generate NEW token with admin role
      const newToken = jwt.sign(
        { 
          userId: user.id, 
          email: user.email, 
          role: 'admin' 
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.json({ 
        success: true,
        message: 'Admin user updated - Use this new token!',
        email: email,
        note: 'Password has been reset to: admin123',
        token: newToken,
        instruction: 'Copy this token and run: localStorage.setItem("authToken", "' + newToken + '") then refresh the page'
      });
    } else {
      // Create new admin
      const result = await executeInsert(
        `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [email, hashedPassword, 'Admin', 'Holwert', 'admin', true]
      );
      
      // Fetch the created user
      const userResult = await executeQuery(
        'SELECT id, email, first_name, last_name FROM users WHERE id = ?',
        [result.insertId]
      );
      const user = userResult.rows[0];
      
      // Generate token
      const newToken = jwt.sign(
        { 
          userId: user.id, 
          email: user.email, 
          role: 'admin' 
        },
        JWT_SECRET,
        { expiresIn: '7d' }
      );
      
      res.json({ 
        success: true,
        message: 'Admin user created',
        email: email,
        password: 'admin123',
        token: newToken,
        note: 'Please change password after first login!',
        instruction: 'Copy this token and run: localStorage.setItem("authToken", "' + newToken + '") then refresh the page'
      });
    }
  } catch (error) {
    console.error('Setup admin error:', error);
    res.status(500).json({ 
      success: false,
      error: 'Failed to setup admin user',
      message: error.message 
    });
  }
});

// Health check
app.get('/api/health', async (req, res) => {
  try {
    // Test database connection
    await executeQuery('SELECT 1');
    const dbHost = process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost';
    const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'holwert';
    
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: `Connected to MySQL (${dbHost}/${dbName})`
    });
  } catch (error) {
    const dbHost = process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost (NOT SET!)';
    const dbUser = process.env.DB_USER || process.env.MYSQL_USER || 'NOT SET';
    const dbName = process.env.DB_NAME || process.env.MYSQL_DATABASE || 'NOT SET';
    
    res.status(500).json({
      status: 'ERROR',
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      database: 'Connection failed',
      error: error.message,
      config: {
        host: dbHost,
        user: dbUser,
        database: dbName,
        hasPassword: !!(process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD)
      },
      hint: 'Check Vercel environment variables: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME'
    });
  }
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

// Get all published news (public, with optional bookmark status if authenticated)
app.get('/api/news', async (req, res) => {
  try {
    await ensureBookmarksTable();
    const { organization_id } = req.query;
    
    // Check if user is authenticated (optional)
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch (e) {
        // Token invalid, continue without userId
        console.log('Invalid token in /api/news, continuing without auth');
      }
    }
    
    let query = `
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url,
             n.created_at, n.updated_at, n.organization_id,
             u.first_name, u.last_name,
             o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
             ${userId ? ', CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as is_bookmarked' : ', false as is_bookmarked'}
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      ${userId ? `LEFT JOIN bookmarks b ON b.news_id = n.id AND b.user_id = ${userId}` : ''}
      WHERE n.is_published = true
    `;
    
    const params = [];
    
    // Filter by organization_id if provided
    if (organization_id) {
      query += ` AND n.organization_id = $1`;
      params.push(parseInt(organization_id));
    }
    
    query += ` ORDER BY n.created_at DESC LIMIT 20`;
    
    const result = await executeQuery(query, params);

    // Use image_url directly - no more base64 processing!
    const processedNews = result.rows.map(article => ({
      ...article,
      // Provide image variants all pointing to the same URL for backward compatibility
      image_variants: {
            original: article.image_url,
            full: article.image_url,
            large: article.image_url,
            medium: article.image_url,
            thumbnail: article.image_url
      }
    }));

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
    let paramCount = 1; // organization_id is already $1
    let query = `
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.image_url,
             n.created_at,
             u.first_name, u.last_name,
             o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true AND n.organization_id = $1`;
    if (exclude) {
      paramCount++;
      params.push(parseInt(exclude));
      query += ` AND n.id <> $${paramCount}`;
    }
    paramCount++;
    params.push(parseInt(limit));
    query += ` ORDER BY n.created_at DESC LIMIT $${paramCount}`;

    const result = await executeQuery(query, params);

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
    await executeQuery(`
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
      const result = await executeQuery(`
        SELECT n.id, n.title, n.excerpt, n.image_url, n.created_at, b.created_at as bookmarked_at
        FROM bookmarks b
        JOIN news n ON n.id = b.news_id
        WHERE b.user_id = $1
        ORDER BY b.created_at DESC
        LIMIT 100
      `, [userId]);
      return res.json({ bookmarks: result.rows });
    } else {
      const result = await executeQuery(`
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
    const result = await executeQuery(`SELECT 1 FROM bookmarks WHERE user_id = $1 AND news_id = $2`, [userId, newsId]);
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
    await executeQuery(`
      INSERT INTO bookmarks (user_id, news_id) VALUES ($1, $2)
      ON DUPLICATE KEY UPDATE user_id = user_id
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
    const result = await executeQuery(`DELETE FROM bookmarks WHERE user_id = $1 AND news_id = $2`, [userId, newsId]);
    res.json({ success: true, removed: result.rowCount > 0 });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark', message: error.message });
  }
});

// ===== APP FOLLOWS (organizations) =====
async function ensureFollowsTable() {
  try {
    await executeQuery(`
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
    const result = await executeQuery(`SELECT organization_id, created_at FROM follows WHERE user_id = $1 ORDER BY created_at DESC`, [userId]);
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
    const result = await executeQuery(`SELECT 1 FROM follows WHERE user_id = $1 AND organization_id = $2`, [userId, orgId]);
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
    await executeQuery(`INSERT INTO follows (user_id, organization_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id`, [userId, organization_id]);
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
    const result = await executeQuery(`DELETE FROM follows WHERE user_id = $1 AND organization_id = $2`, [userId, orgId]);
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
    const result = await executeQuery(`SELECT COUNT(*)::int AS count FROM follows WHERE organization_id = $1`, [orgId]);
    const count = (result.rows[0] && result.rows[0].count) || 0;
    res.json({ count });
  } catch (error) {
    console.error('Get followers count error:', error);
    res.status(500).json({ error: 'Failed to get followers count', message: error.message });
  }
});

// ==================== PUSH NOTIFICATIONS ENDPOINTS ====================

// Register/Update push token
app.post('/api/push/token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token, device_type, device_name, notification_preferences } = req.body;
    
    if (!token) {
      return res.status(400).json({ error: 'Push token is required' });
    }
    
    // Check if token already exists
    const existingToken = await executeQuery(
      'SELECT id FROM push_tokens WHERE token = $1',
      [token]
    );
    
    if (existingToken.rows.length > 0) {
      // Update existing token
      await executeQuery(
        `UPDATE push_tokens 
         SET user_id = $1, 
             device_type = $2, 
             device_name = $3,
             notification_preferences = COALESCE($4, notification_preferences),
             is_active = true,
             last_used_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE token = $5`,
        [userId, device_type, device_name, notification_preferences ? JSON.stringify(notification_preferences) : null, token]
      );
      
      console.log(`✅ Updated push token for user ${userId}`);
      res.json({ success: true, message: 'Push token updated' });
    } else {
      // Insert new token
      await executeQuery(
        `INSERT INTO push_tokens (user_id, token, device_type, device_name, notification_preferences)
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, token, device_type, device_name, notification_preferences ? JSON.stringify(notification_preferences) : null]
      );
      
      console.log(`✅ Registered new push token for user ${userId}`);
      res.json({ success: true, message: 'Push token registered' });
    }
  } catch (error) {
    console.error('Register push token error:', error);
    res.status(500).json({ error: 'Failed to register push token', message: error.message });
  }
});

// Update notification preferences for current user
app.put('/api/push/preferences', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { notification_preferences } = req.body;
    
    if (!notification_preferences) {
      return res.status(400).json({ error: 'Notification preferences are required' });
    }
    
    await executeQuery(
      `UPDATE push_tokens 
       SET notification_preferences = $1, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = $2`,
      [JSON.stringify(notification_preferences), userId]
    );
    
    res.json({ success: true, message: 'Notification preferences updated' });
  } catch (error) {
    console.error('Update notification preferences error:', error);
    res.status(500).json({ error: 'Failed to update preferences', message: error.message });
  }
});

// Delete push token (unregister device)
app.delete('/api/push/token/:token', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { token } = req.params;
    
    const result = await executeQuery(
      'DELETE FROM push_tokens WHERE token = $1 AND user_id = $2',
      [token, userId]
    );
    
    if (result.rowCount > 0) {
      console.log(`✅ Deleted push token for user ${userId}`);
      res.json({ success: true, message: 'Push token deleted' });
    } else {
      res.status(404).json({ error: 'Push token not found' });
    }
  } catch (error) {
    console.error('Delete push token error:', error);
    res.status(500).json({ error: 'Failed to delete push token', message: error.message });
  }
});

// Deactivate all push tokens for current user
app.post('/api/push/deactivate', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    await executeQuery(
      'UPDATE push_tokens SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE user_id = $1',
      [userId]
    );
    
    console.log(`✅ Deactivated all push tokens for user ${userId}`);
    res.json({ success: true, message: 'All push tokens deactivated' });
  } catch (error) {
    console.error('Deactivate push tokens error:', error);
    res.status(500).json({ error: 'Failed to deactivate push tokens', message: error.message });
  }
});

// Get user's push tokens (for debugging/management)
app.get('/api/push/tokens', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    
    const result = await executeQuery(
      `SELECT id, device_type, device_name, notification_preferences, is_active, 
              last_used_at, created_at, updated_at
       FROM push_tokens 
       WHERE user_id = $1
       ORDER BY last_used_at DESC`,
      [userId]
    );
    
    res.json({ tokens: result.rows });
  } catch (error) {
    console.error('Get push tokens error:', error);
    res.status(500).json({ error: 'Failed to get push tokens', message: error.message });
  }
});

// Get single published news (public, with optional bookmark status if authenticated)
app.get('/api/news/:id', async (req, res) => {
  try {
    await ensureBookmarksTable();
    const { id } = req.params;
    
    // Check if user is authenticated (optional)
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        userId = decoded.userId;
      } catch (e) {
        console.log('Invalid token in /api/news/:id, continuing without auth');
      }
    }
    
    const result = await executeQuery(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url,
             n.created_at, n.updated_at, n.category, n.custom_category, n.is_published,
             u.first_name, u.last_name,
             o.id as organization_id, o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
             ${userId ? ', CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as is_bookmarked' : ', false as is_bookmarked'}
      FROM news n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      ${userId ? `LEFT JOIN bookmarks b ON b.news_id = n.id AND b.user_id = ${userId}` : ''}
      WHERE n.id = $1 AND n.is_published = true
      LIMIT 1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const article = result.rows[0];

    // Use image_url directly - no more base64 processing!
    const imageVariants = {
          original: article.image_url,
          full: article.image_url,
          large: article.image_url,
          medium: article.image_url,
          thumbnail: article.image_url
        };
    
    res.json({
      article: {
        ...article,
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
      const orgResult = await executeQuery(
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
    const result = await executeQuery(
      'INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, image_data, category, custom_category, is_published) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id, title, COALESCE(content, \'\') as content, excerpt, category, custom_category, image_url, is_published, created_at',
      [title, content, excerpt || null, authorId, organization_id || null, image_url || null, req.body.image_data || null, finalCategory, finalCustomCategory, isPublished]
    );

    const newArticle = result.rows[0];
    
    // Send push notification if published and has organization
    if (isPublished && organization_id) {
      try {
        // Get organization name
        const orgResult = await executeQuery(
          'SELECT name FROM organizations WHERE id = $1',
          [organization_id]
        );
        
        if (orgResult.rows.length > 0) {
          const orgName = orgResult.rows[0].name;
          
          // Send notification to followers (async, don't wait)
          sendNotificationToFollowers(
            organization_id,
            {
              title: `📰 Nieuw bericht van ${orgName}`,
              body: title,
              data: {
                type: 'news',
                newsId: newArticle.id,
                organizationId: organization_id
              }
            },
            'news'
          ).catch(err => console.error('Push notification error:', err));
          
          console.log(`📢 Queued push notification for news article ${newArticle.id}`);
        }
      } catch (notifError) {
        console.error('Error preparing push notification:', notifError);
        // Don't fail the request if notification fails
      }
    }

    const message = isPublished 
      ? 'News article published successfully' 
      : 'News article created and submitted for moderation';

    res.status(201).json({
      message: message,
      articleId: newArticle.id,
      article: newArticle,
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
    const existingArticle = await executeQuery(
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
    const result = await executeQuery(
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
    const userResult = await executeQuery(
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

// Get admin dashboard statistics - OPTIMIZED: Single query + caching
app.get('/api/admin/stats', authenticateToken, async (req, res) => {
  try {
    const cacheKey = getCacheKey('/api/admin/stats');
    const cached = getCached(cacheKey);
    
    if (cached) {
      console.log('[Stats] Returning cached data');
      return res.json(cached);
    }
    
    console.log('[Stats] Fetching fresh data from database');
    // Single query to get all counts at once - MUCH faster!
    const result = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM organizations) as organizations_count,
        (SELECT COUNT(*) FROM news) as news_count,
        (SELECT COUNT(*) FROM events) as events_count
    `);
    
    const row = result.rows[0] || {};
    const stats = {
      users: parseInt(row.users_count) || 0,
      organizations: parseInt(row.organizations_count) || 0,
      news: parseInt(row.news_count) || 0,
      events: parseInt(row.events_count) || 0
    };
    
    // Cache for 30 seconds
    setCache(cacheKey, stats, CACHE_TTL.stats);
    res.json(stats);
  } catch (error) {
    console.error('Get admin stats error:', error);
    res.status(500).json({ error: 'Failed to get stats', message: error.message });
  }
});

// Get moderation count (admin) - OPTIMIZED: Single query + caching
app.get('/api/admin/moderation/count', authenticateToken, async (req, res) => {
  try {
    const cacheKey = getCacheKey('/api/admin/moderation/count');
    const cached = getCached(cacheKey);
    
    if (cached) {
      console.log('[Moderation Count] Returning cached data');
      return res.json(cached);
    }
    
    console.log('[Moderation Count] Fetching fresh data from database');
    // Single query to get all pending counts at once
    const result = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as orgs_count,
        (SELECT COUNT(*) FROM news WHERE is_published = false) as news_count,
        (SELECT COUNT(*) FROM events WHERE is_published = false) as events_count
    `);
    
    const row = result.rows[0] || {};
    const totalCount = (parseInt(row.orgs_count) || 0) + 
                      (parseInt(row.news_count) || 0) + 
                      (parseInt(row.events_count) || 0);
    
    const response = { count: totalCount };
    setCache(cacheKey, response, CACHE_TTL.moderation);
    res.json(response);
  } catch (error) {
    // If events table doesn't exist, try without it
    try {
      const result = await executeQuery(`
        SELECT 
          (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as orgs_count,
          (SELECT COUNT(*) FROM news WHERE is_published = false) as news_count
      `);
      const row = result.rows[0] || {};
      const totalCount = (parseInt(row.orgs_count) || 0) + (parseInt(row.news_count) || 0);
      const response = { count: totalCount };
      setCache(getCacheKey('/api/admin/moderation/count'), response, CACHE_TTL.moderation);
      res.json(response);
    } catch (e) {
      console.error('Get moderation count error:', error);
      res.status(500).json({ error: 'Failed to get moderation count', message: error.message });
    }
  }
});

// Get all pending items for moderation (admin)
app.get('/api/admin/pending', authenticateToken, async (req, res) => {
  try {
    let orgsResult = { rows: [] };
    let newsResult = { rows: [] };
    let eventsResult = { rows: [] };
    
    try {
      orgsResult = await executeQuery(`
        SELECT id, name, description, email as contact_email, is_approved, created_at, 
               'organization' as type
        FROM organizations 
        WHERE is_approved = false 
        ORDER BY created_at DESC 
        LIMIT 10
      `);
    } catch (e) {
      console.warn('Error fetching pending organizations:', e.message);
    }
    
    try {
      newsResult = await executeQuery(`
        SELECT n.id, n.title as name, n.excerpt as description, n.is_published, n.created_at,
               'news' as type, u.first_name, u.last_name
        FROM news n
        LEFT JOIN users u ON n.author_id = u.id
        WHERE n.is_published = false
        ORDER BY n.created_at DESC
        LIMIT 10
      `);
    } catch (e) {
      console.warn('Error fetching pending news:', e.message);
    }
    
    try {
      eventsResult = await executeQuery(`
        SELECT e.id, e.title as name, e.description, e.is_published, e.created_at,
               'event' as type, u.first_name, u.last_name
        FROM events e
        LEFT JOIN users u ON e.organizer_id = u.id
        WHERE e.is_published = false
        ORDER BY e.event_date DESC
        LIMIT 10
      `);
    } catch (e) {
      // Events table might not exist, that's OK
      console.warn('Error fetching pending events (table might not exist):', e.message);
    }

    res.json({
      organizations: orgsResult.rows,
      news: newsResult.rows,
      events: eventsResult.rows
    });
  } catch (error) {
    console.error('Get pending items error:', error);
    res.status(500).json({ error: 'Failed to get pending items', message: error.message });
  }
});

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

    let paramCount = 0;
    if (status) {
      paramCount++;
      params.push(status);
      query += ` AND n.status = $${paramCount}`;
    }

    if (category) {
      paramCount++;
      params.push(category);
      query += ` AND n.category = $${paramCount}`;
    }

    paramCount++;
    query += ` ORDER BY n.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await executeQuery(query, params);

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

    const countResult = await executeQuery(countQuery, countParams);

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

    const result = await executeQuery(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url, n.organization_id,
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

    // Use image_url directly - no more base64 processing!
    const imageVariants = {
          original: article.image_url,
          full: article.image_url,
          large: article.image_url,
          medium: article.image_url,
          thumbnail: article.image_url
        };

    res.json({
      article: {
        ...article,
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

// Update news article (admin) - allows changing organization
app.put('/api/admin/news/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, excerpt, category, custom_category, organization_id, image_url, image_data, is_published } = req.body;

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

    // Build update query dynamically to handle optional fields
    let updateFields = [];
    let values = [];
    let paramCount = 1;

    updateFields.push(`title = $${paramCount++}`);
    values.push(title);

    updateFields.push(`content = $${paramCount++}`);
    values.push(content);

    updateFields.push(`excerpt = $${paramCount++}`);
    values.push(excerpt || null);

    updateFields.push(`category = $${paramCount++}`);
    values.push(finalCategory);

    updateFields.push(`custom_category = $${paramCount++}`);
    values.push(finalCustomCategory);

    updateFields.push(`organization_id = $${paramCount++}`);
    values.push(organization_id || null);

    if (image_url !== undefined) {
      updateFields.push(`image_url = $${paramCount++}`);
      values.push(image_url || null);
    }

    if (image_data !== undefined) {
      updateFields.push(`image_data = $${paramCount++}`);
      values.push(image_data || null);
    }

    if (is_published !== undefined) {
      updateFields.push(`is_published = $${paramCount++}`);
      values.push(is_published);
    }

    // Note: published_at column doesn't exist in database, using created_at instead
    // if (published_at) {
    //   updateFields.push(`published_at = $${paramCount++}`);
    //   values.push(published_at);
    // }

    updateFields.push('updated_at = NOW()');

    values.push(id);
    const query = `UPDATE news SET ${updateFields.join(', ')} WHERE id = $${paramCount} RETURNING id, title, content, excerpt, category, custom_category, organization_id, image_url, is_published, created_at, updated_at`;

    const result = await executeQuery(query, values);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json({
      message: 'Article updated successfully',
      article: result.rows[0]
    });

  } catch (error) {
    console.error('Update admin news error:', error);
    res.status(500).json({
      error: 'Failed to update article',
      message: error.message
    });
  }
});

// Delete news article (admin)
app.delete('/api/admin/news/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery('DELETE FROM news WHERE id = $1', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Article not found' });
    }
    res.json({ success: true });
  } catch (error) {
    console.error('Delete news error:', error);
    res.status(500).json({ error: 'Failed to delete article', message: error.message });
  }
});

// Get single organization (admin) - MUST BE BEFORE /api/admin/organizations (without :id)
app.get('/api/admin/organizations/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[GET /api/admin/organizations/:id] Request for organization ID: ${id}, user:`, req.user);
    
    // Check admin privileges
    const roleRaw = req.user && req.user.role;
    const role = typeof roleRaw === 'string' ? roleRaw.toLowerCase() : undefined;
    const allowed = ['admin', 'superadmin', 'editor', 'user'];
    if (!role || !allowed.includes(role)) {
      console.log(`[GET /api/admin/organizations/:id] Access denied for role: ${role}`);
      return res.status(403).json({ error: 'Admin privileges required' });
    }
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }
    
    const result = await executeQuery(
      `SELECT id, name, category, description, bio, is_approved, website, email, phone, whatsapp, address, 
              facebook, instagram, twitter, linkedin, brand_color, logo_url, created_at, updated_at
       FROM organizations 
       WHERE id = $1`,
      [id]
    );
    
    if (!result.rows.length) {
      console.log(`[GET /api/admin/organizations/:id] Organization ${id} not found in database`);
      return res.status(404).json({ error: 'Organization not found' });
    }
    
    console.log(`[GET /api/admin/organizations/:id] Successfully retrieved organization ${id}`);
    res.json({ organization: result.rows[0] });
  } catch (error) {
    console.error('[GET /api/admin/organizations/:id] Error:', error);
    res.status(500).json({ error: 'Failed to get organization', message: error.message });
  }
});

// Get all organizations (admin) - OPTIMIZED: Caching + combined queries
app.get('/api/admin/organizations', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    
    // Check cache
    const cacheKey = getCacheKey('/api/admin/organizations', { page, limit, status });
    const cached = getCached(cacheKey);
    
    if (cached) {
      console.log('[Organizations] Returning cached data');
      return res.json(cached);
    }
    
    console.log('[Organizations] Fetching fresh data from database');

    let query = `
      SELECT 
        o.id, 
        o.name, 
        o.description, 
        o.is_approved, 
        o.created_at
      FROM organizations o
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (status) {
      paramCount++;
      // Convert status string to boolean: 'pending' = false, 'approved' = true
      const isApproved = status === 'approved';
      params.push(isApproved);
      query += ` AND o.is_approved = ?`;
    }

    query += ` ORDER BY o.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    // Get data and count in parallel (but still only 2 queries instead of sequential)
    const [result, countResult] = await Promise.all([
      executeQuery(query, params),
      executeQuery(
        `SELECT COUNT(*) as total FROM organizations o WHERE 1=1${status ? ` AND o.is_approved = ?` : ''}`,
        status ? [status === 'approved'] : []
      )
    ]);

    const response = {
      organizations: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(countResult.rows[0].total),
        pages: Math.ceil(countResult.rows[0].total / limit)
      }
    };
    
    // Cache for 10 seconds
    setCache(cacheKey, response, CACHE_TTL.organizations);
    res.json(response);

  } catch (error) {
    console.error('Get admin organizations error:', error);
    console.error('Error details:', {
      message: error.message,
      stack: error.stack,
      params: params
    });
    res.status(500).json({
      error: 'Failed to get organizations',
      message: error.message,
      details: error.stack
    });
  }
});

// Create organization (admin)
app.post('/api/admin/organizations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name, category, description, bio, is_approved = true,
      website, email, phone, whatsapp, address,
      facebook, instagram, twitter, linkedin,
      brand_color, logo_url
    } = req.body;
    
    if (!name) return res.status(400).json({ error: 'name is required' });
    
    console.log('[POST /api/admin/organizations] Creating organization:', { name, category, hasLogo: !!logo_url });
    
    const result = await executeInsert(
      `INSERT INTO organizations (
        name, category, description, bio, is_approved,
        website, email, phone, whatsapp, address,
        facebook, instagram, twitter, linkedin,
        brand_color, logo_url, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name,
        category || null,
        description || null,
        bio || null,
        is_approved !== false,
        website || null,
        email || null,
        phone || null,
        whatsapp || null,
        address || null,
        facebook || null,
        instagram || null,
        twitter || null,
        linkedin || null,
        brand_color || null,
        logo_url || null
      ]
    );
    
    console.log('[POST /api/admin/organizations] Insert result:', { 
      insertId: result.insertId, 
      rowCount: result.rowCount,
      hasRows: !!result.rows && result.rows.length > 0
    });
    
    if (!result.insertId) {
      console.error('[POST /api/admin/organizations] No insertId returned from executeInsert');
      throw new Error('Failed to get insert ID from database. Insert may have failed.');
    }
    
    // Fetch the created organization
    console.log('[POST /api/admin/organizations] Fetching created organization with id:', result.insertId);
    const orgResult = await executeQuery(
      `SELECT id, name, category, description, bio, is_approved, website, email, phone, whatsapp, address,
              facebook, instagram, twitter, linkedin, brand_color, logo_url, created_at, updated_at
       FROM organizations WHERE id = ?`,
      [result.insertId]
    );
    
    console.log('[POST /api/admin/organizations] Fetch result:', { 
      rowCount: orgResult.rowCount,
      hasRows: !!orgResult.rows && orgResult.rows.length > 0
    });
    
    if (!orgResult.rows || orgResult.rows.length === 0) {
      console.error('[POST /api/admin/organizations] Organization not found after insert. InsertId was:', result.insertId);
      throw new Error(`Failed to fetch created organization with id ${result.insertId}. Organization may not have been created.`);
    }
    
    console.log('[POST /api/admin/organizations] Successfully created organization:', orgResult.rows[0].id);
    
    // Invalidate cache
    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    
    res.status(201).json({ organization: orgResult.rows[0] });
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
    const push = (v) => { params.push(v); return '?'; }; // MySQL uses ? instead of $1, $2, etc.
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
    
    // MySQL UPDATE query (no RETURNING clause)
    await executeQuery(
      `UPDATE organizations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );
    
    // Fetch the updated organization
    const result = await executeQuery(
      `SELECT id, name, category, description, bio, is_approved, website, email, phone, whatsapp, address, 
              facebook, instagram, twitter, linkedin, brand_color, logo_url, created_at, updated_at
       FROM organizations WHERE id = ?`,
      [id]
    );
    
    if (!result.rows.length) return res.status(404).json({ error: 'Organization not found' });
    
    // Invalidate cache
    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    
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
    const result = await executeQuery('UPDATE organizations SET is_approved = true WHERE id = ?', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
    
    // Invalidate cache
    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    
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
    const result = await executeQuery('UPDATE organizations SET is_approved = false WHERE id = ?', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
    
    // Invalidate cache
    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    
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
    const result = await executeQuery('DELETE FROM organizations WHERE id = ?', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Organization not found' });
    
    // Invalidate cache
    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    
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
    // Check if events table exists first
    const tableCheck = await executeQuery(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'events'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('[GET /events] Events table does not exist, returning empty array');
      return res.json({
        events: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          pages: 0
        }
      });
    }

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
      const orgId = parseInt(organization_id);
      if (isNaN(orgId)) {
        return res.status(400).json({ error: 'Invalid organization_id' });
      }
      paramCount++;
      query += ` AND e.organization_id = $${paramCount}`;
      params.push(orgId);
    }
    
    paramCount++;
    query += ` ORDER BY e.event_date ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await executeQuery(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE e.event_date >= NOW()';
    const countParams = [];
    
    if (organization_id) {
      const orgId = parseInt(organization_id);
      if (!isNaN(orgId)) {
      countQuery += ` AND e.organization_id = $1`;
        countParams.push(orgId);
      }
    }
    
    const countResult = await executeQuery(countQuery, countParams);

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
    console.error('[GET /events] Error:', error);
    console.error('[GET /events] Error stack:', error.stack);
    // Return empty array instead of error to prevent breaking the app
    res.json({
      events: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        pages: 0
      }
    });
  }
});

// Get single event (public)
app.get('/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery(`
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
    // Check if events table exists first
    const tableCheck = await executeQuery(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'events'
      );
    `);
    
    if (!tableCheck.rows[0].exists) {
      console.log('[GET /api/events] Events table does not exist, returning empty array');
      return res.json({
        events: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          pages: 0
        }
      });
    }

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
      const orgId = parseInt(organization_id);
      if (isNaN(orgId)) {
        return res.status(400).json({ error: 'Invalid organization_id' });
      }
      paramCount++;
      query += ` AND e.organization_id = $${paramCount}`;
      params.push(orgId);
    }
    
    paramCount++;
    query += ` ORDER BY e.event_date ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await executeQuery(query, params);

    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE e.event_date >= NOW()';
    const countParams = [];
    if (organization_id) {
      const orgId = parseInt(organization_id);
      if (!isNaN(orgId)) {
      countQuery += ` AND e.organization_id = $1`;
        countParams.push(orgId);
    }
    }
    const countResult = await executeQuery(countQuery, countParams);

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
    console.error('[GET /api/events] Error:', error);
    console.error('[GET /api/events] Error stack:', error.stack);
    // Return empty array instead of error to prevent breaking the app
    res.json({
      events: [],
      pagination: {
        page: 1,
        limit: 20,
        total: 0,
        pages: 0
      }
    });
  }
});

// Alias route for single event
app.get('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery(`
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

    const result = await executeQuery(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND e.status = $${countParams.length}`;
    }

    const countResult = await executeQuery(countQuery, countParams);

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
    const result = await executeQuery(
      `INSERT INTO events (title, description, event_date, end_date, location, organization_id, status, organizer_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, title, description, event_date, end_date, location, organization_id, status, created_at`,
      [title, description || null, event_date, end_date || null, location || null, organization_id || null, status, req.user.userId]
    );
    
    const newEvent = result.rows[0];
    
    // Send push notification if event is scheduled and has organization
    if (status === 'scheduled' && organization_id) {
      try {
        // Get organization name
        const orgResult = await executeQuery(
          'SELECT name FROM organizations WHERE id = $1',
          [organization_id]
        );
        
        if (orgResult.rows.length > 0) {
          const orgName = orgResult.rows[0].name;
          const eventDate = new Date(event_date).toLocaleDateString('nl-NL', { 
            day: 'numeric', 
            month: 'long' 
          });
          
          // Send notification to followers (async, don't wait)
          sendNotificationToFollowers(
            organization_id,
            {
              title: `📅 Nieuw evenement: ${title}`,
              body: `${orgName} organiseert dit op ${eventDate}`,
              data: {
                type: 'event',
                eventId: newEvent.id,
                organizationId: organization_id
              }
            },
            'agenda'
          ).catch(err => console.error('Push notification error:', err));
          
          console.log(`📢 Queued push notification for event ${newEvent.id}`);
        }
      } catch (notifError) {
        console.error('Error preparing push notification:', notifError);
        // Don't fail the request if notification fails
      }
    }
    
    res.status(201).json({ event: newEvent });
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
    const result = await executeQuery(
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
    const result = await executeQuery('DELETE FROM events WHERE id = $1', [id]);
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
    if (status) { 
      params.push(status); 
      query += ` AND status = $1`; 
    }
    query += ' ORDER BY created_at DESC LIMIT 200';
    const result = await executeQuery(query, params);
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
    const result = await executeQuery(
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
      const result = await executeQuery(
        `UPDATE found_lost SET status = 'needs_revision', rejection_reason = $1, revision_deadline = NOW() + INTERVAL '3 days', updated_at = NOW() WHERE id = $2 RETURNING *`,
        [reason || 'Aanpassingen vereist', id]
      );
      if (!result.rows.length) return res.status(404).json({ error: 'Item not found' });
      return res.json({ item: result.rows[0] });
    } else {
      const result = await executeQuery(
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

    let paramCount = 0;
    if (role) {
      paramCount++;
      params.push(role);
      query += ` AND u.role = $${paramCount}`;
    }

    paramCount++;
    query += ` ORDER BY u.created_at DESC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await executeQuery(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users u WHERE 1=1';
    const countParams = [];
    
    if (role) {
      countParams.push(role);
      countQuery += ` AND u.role = $${countParams.length}`;
    }

    const countResult = await executeQuery(countQuery, countParams);

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
    const result = await executeQuery(
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
    const result = await executeQuery(
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
    const result = await executeQuery('DELETE FROM users WHERE id = $1', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'User not found' });
    res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Cannot delete user in use' });
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user', message: error.message });
  }
});

// ===== PUBLIC ORGANIZATIONS DETAIL ENDPOINT =====
app.get('/api/organizations/:id', async (req, res) => {
  try {
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    const result = await executeQuery(
      `SELECT 
        id, name, category, description, bio,
        website, email, phone, whatsapp, address,
        facebook, instagram, twitter, linkedin,
        brand_color, logo_url, is_approved,
        created_at, updated_at
       FROM organizations
       WHERE id = ? AND is_approved = true`,
      [id]
    );

    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ organization: result.rows[0] });
  } catch (error) {
    console.error('Error fetching organization detail:', error);
    res.status(500).json({ error: 'Failed to fetch organization detail', message: error.message });
  }
});

// ===== PUBLIC ORGANIZATIONS ENDPOINT =====
app.get('/api/organizations', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search, minimal = false } = req.query;
    const offset = (page - 1) * limit;

    // For list view, only get essential fields (much faster)
    const fields = minimal === 'true' ? `
      id,
      name,
      description,
      logo_url,
      brand_color,
      category
    ` : `
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
    `;

    let query = `
      SELECT ${fields}
      FROM organizations
      WHERE is_approved = true
    `;
    const params = [];
    let paramCount = 0;

    if (category) {
      paramCount++;
      params.push(category);
      query += ` AND category = $${paramCount}`;
    }

    if (search) {
      paramCount++;
      params.push(`%${search}%`);
      query += ` AND (name ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
    }

    paramCount++;
    query += ` ORDER BY name ASC LIMIT $${paramCount}`;
    params.push(parseInt(limit));
    
    paramCount++;
    query += ` OFFSET $${paramCount}`;
    params.push(parseInt(offset));

    const result = await executeQuery(query, params);

    // Get total count (only if not minimal, to save time)
    let total = result.rows.length;
    if (minimal !== 'true') {
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

    const countResult = await executeQuery(countQuery, countParams);
      total = parseInt(countResult.rows[0].total);
    }

    res.json({
      organizations: result.rows,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: total,
        pages: Math.ceil(total / limit)
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

// MySQL Database Setup Endpoint (voor server-side setup)
app.post('/api/setup-mysql-database', async (req, res) => {
  try {
    const mysql = require('mysql2/promise');
    
    // Database credentials (van environment variables of request body)
    const dbConfig = {
      host: req.body.host || process.env.DB_HOST || process.env.MYSQL_HOST || 'localhost',
      port: req.body.port || process.env.DB_PORT || process.env.MYSQL_PORT || 3306,
      user: req.body.user || process.env.DB_USER || process.env.MYSQL_USER || 'db_holwert',
      password: req.body.password || process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || 'h0lwert.2026',
      database: req.body.database || process.env.DB_NAME || process.env.MYSQL_DATABASE || 'appenvlo_holwert',
      multipleStatements: true,
      charset: 'utf8mb4'
    };

    console.log('[MySQL Setup] Starting database setup...');
    console.log('[MySQL Setup] Database:', dbConfig.database);
    console.log('[MySQL Setup] Host:', `${dbConfig.host}:${dbConfig.port}`);

    const connection = await mysql.createConnection(dbConfig);
    console.log('[MySQL Setup] Connected to database');

    const results = {
      created: [],
      skipped: [],
      errors: []
    };

    // Helper functies
    const executeQuery = async (query, params = []) => {
      try {
        const [result] = await connection.execute(query, params);
        return result;
      } catch (error) {
        throw error;
      }
    };

    const tableExists = async (tableName) => {
      try {
        const [result] = await connection.execute(
          `SELECT COUNT(*) as count FROM information_schema.tables 
           WHERE table_schema = ? AND table_name = ?`,
          [dbConfig.database, tableName]
        );
        return result[0].count > 0;
      } catch (error) {
        return false;
      }
    };

    // Users tabel
    if (!(await tableExists('users'))) {
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
      results.created.push('users');
    } else {
      results.skipped.push('users');
    }

    // Organizations tabel
    if (!(await tableExists('organizations'))) {
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
      results.created.push('organizations');
    } else {
      results.skipped.push('organizations');
    }

    // News tabel
    if (!(await tableExists('news'))) {
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
      results.created.push('news');
    } else {
      results.skipped.push('news');
    }

    // Events tabel
    if (!(await tableExists('events'))) {
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
      results.created.push('events');
    } else {
      results.skipped.push('events');
    }

    // Bookmarks tabel
    if (!(await tableExists('bookmarks'))) {
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
      results.created.push('bookmarks');
    } else {
      results.skipped.push('bookmarks');
    }

    // Follows tabel
    if (!(await tableExists('follows'))) {
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
      results.created.push('follows');
    } else {
      results.skipped.push('follows');
    }

    // Push tokens tabel
    if (!(await tableExists('push_tokens'))) {
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
      results.created.push('push_tokens');
    } else {
      results.skipped.push('push_tokens');
    }

    // Notification history tabel
    if (!(await tableExists('notification_history'))) {
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
      results.created.push('notification_history');
    } else {
      results.skipped.push('notification_history');
    }

    await connection.end();
    console.log('[MySQL Setup] Database setup completed');

    res.json({
      success: true,
      message: 'Database setup completed successfully',
      results: results
    });

  } catch (error) {
    console.error('[MySQL Setup] Error:', error);
    res.status(500).json({
      success: false,
      error: 'Database setup failed',
      message: error.message,
      code: error.code
    });
  }
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// ==================== PUSH NOTIFICATION HELPER FUNCTIONS ====================

/**
 * Send push notification via Expo Push API
 * @param {Array} pushTokens - Array of Expo push tokens
 * @param {Object} notification - Notification object { title, body, data }
 * @returns {Promise<Object>} Result with success/failure info
 */
async function sendPushNotification(pushTokens, notification) {
  try {
    // Filter valid Expo push tokens
    const validTokens = pushTokens.filter(token => 
      token && token.startsWith('ExponentPushToken[')
    );
    
    if (validTokens.length === 0) {
      console.log('⚠️ No valid Expo push tokens to send to');
      return { success: false, message: 'No valid tokens' };
    }
    
    // Prepare messages for Expo Push API
    const messages = validTokens.map(token => ({
      to: token,
      sound: 'default',
      title: notification.title,
      body: notification.body,
      data: notification.data || {},
      priority: 'high',
      channelId: 'default'
    }));
    
    // Send to Expo Push API
    const response = await axios.post(
      'https://exp.host/--/api/v2/push/send',
      messages,
      {
        headers: {
          'Accept': 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json'
        }
      }
    );
    
    console.log(`✅ Sent ${validTokens.length} push notification(s)`);
    
    // Log results
    if (response.data && response.data.data) {
      const tickets = response.data.data;
      const successCount = tickets.filter(t => t.status === 'ok').length;
      const errorCount = tickets.filter(t => t.status === 'error').length;
      
      console.log(`   Success: ${successCount}, Errors: ${errorCount}`);
      
      if (errorCount > 0) {
        const errors = tickets.filter(t => t.status === 'error');
        errors.forEach(err => {
          console.error(`   Error: ${err.message || err.details?.error}`);
        });
      }
    }
    
    return {
      success: true,
      sent: validTokens.length,
      response: response.data
    };
  } catch (error) {
    console.error('❌ Push notification error:', error.message);
    if (error.response) {
      console.error('   Response:', error.response.data);
    }
    return {
      success: false,
      error: error.message
    };
  }
}

/**
 * Send notification to specific users
 * @param {Array} userIds - Array of user IDs
 * @param {Object} notification - Notification object
 * @param {String} notificationType - Type of notification (news, agenda, etc)
 */
async function sendNotificationToUsers(userIds, notification, notificationType) {
  try {
    if (!userIds || userIds.length === 0) {
      console.log('⚠️ No users to send notification to');
      return;
    }
    
    // Get active push tokens for these users with matching notification preferences
    const result = await executeQuery(
      `SELECT pt.id, pt.user_id, pt.token, pt.notification_preferences
       FROM push_tokens pt
       WHERE pt.user_id = ANY($1)
       AND pt.is_active = true
       AND (pt.notification_preferences->$2)::boolean = true`,
      [userIds, notificationType]
    );
    
    if (result.rows.length === 0) {
      console.log(`⚠️ No active tokens found for users with ${notificationType} notifications enabled`);
      return;
    }
    
    console.log(`📤 Sending ${notificationType} notification to ${result.rows.length} device(s)`);
    
    const tokens = result.rows.map(row => row.token);
    const sendResult = await sendPushNotification(tokens, notification);
    
    // Log to notification history
    if (sendResult.success) {
      for (const row of result.rows) {
        await executeQuery(
          `INSERT INTO notification_history 
           (user_id, push_token_id, notification_type, title, body, data, status)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            row.user_id,
            row.id,
            notificationType,
            notification.title,
            notification.body,
            JSON.stringify(notification.data || {}),
            'sent'
          ]
        );
      }
    }
    
    return sendResult;
  } catch (error) {
    console.error('❌ Error sending notification to users:', error.message);
    return { success: false, error: error.message };
  }
}

/**
 * Send notification to followers of an organization
 * @param {Number} organizationId - Organization ID
 * @param {Object} notification - Notification object
 * @param {String} notificationType - Type of notification
 */
async function sendNotificationToFollowers(organizationId, notification, notificationType) {
  try {
    // Get all followers of this organization
    await ensureFollowsTable();
    const followersResult = await executeQuery(
      'SELECT user_id FROM follows WHERE organization_id = $1',
      [organizationId]
    );
    
    if (followersResult.rows.length === 0) {
      console.log(`⚠️ No followers found for organization ${organizationId}`);
      return;
    }
    
    const userIds = followersResult.rows.map(row => row.user_id);
    console.log(`📢 Notifying ${userIds.length} follower(s) of organization ${organizationId}`);
    
    return await sendNotificationToUsers(userIds, notification, notificationType);
  } catch (error) {
    console.error('❌ Error sending notification to followers:', error.message);
    return { success: false, error: error.message };
  }
}

// Initialize push notifications tables
async function initializePushNotificationsTables() {
  try {
    console.log('📦 Initializing push notifications tables...');
    
    // Create push_tokens table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        token VARCHAR(255) UNIQUE NOT NULL,
        device_type VARCHAR(50),
        device_name VARCHAR(255),
        notification_preferences JSONB DEFAULT '{
          "news": true,
          "agenda": true,
          "organizations": true,
          "weather": true
        }'::jsonb,
        is_active BOOLEAN DEFAULT true,
        last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create indexes
    await executeQuery(`
      CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id);
      CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token);
      CREATE INDEX IF NOT EXISTS idx_push_tokens_active ON push_tokens(is_active);
    `);
    
    // Create notification_history table
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS notification_history (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        push_token_id INTEGER REFERENCES push_tokens(id) ON DELETE SET NULL,
        notification_type VARCHAR(50),
        title VARCHAR(255),
        body TEXT,
        data JSONB,
        status VARCHAR(50),
        error_message TEXT,
        sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        delivered_at TIMESTAMP
      )
    `);
    
    // Create indexes for notification_history
    await executeQuery(`
      CREATE INDEX IF NOT EXISTS idx_notification_history_user_id ON notification_history(user_id);
      CREATE INDEX IF NOT EXISTS idx_notification_history_type ON notification_history(notification_type);
      CREATE INDEX IF NOT EXISTS idx_notification_history_sent_at ON notification_history(sent_at);
    `);
    
    console.log('✅ Push notifications tables initialized');
  } catch (error) {
    console.error('❌ Error initializing push notifications tables:', error.message);
  }
}

// Start server
app.listen(PORT, async () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  
  // Initialize push notifications tables
  await initializePushNotificationsTables();
});

module.exports = app;
