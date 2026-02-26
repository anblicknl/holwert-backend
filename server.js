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

// ===== JWT & SECURITY CONFIG =====
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  // Fail fast if JWT_SECRET is not configured – we never want to run with een hardcoded fallback
  throw new Error('[SECURITY] JWT_SECRET environment variable is required but not set');
}

// PHP Proxy URL (fallback als direct MySQL niet werkt)
const PHP_PROXY_URL = process.env.PHP_PROXY_URL || 'https://holwert.appenvloed.com/admin/db-proxy.php';
const PHP_PROXY_API_KEY = process.env.PHP_PROXY_API_KEY;
if (!PHP_PROXY_API_KEY) console.warn('⚠️ PHP_PROXY_API_KEY niet geconfigureerd');

// ===== SIMPLE RATE LIMITING (no external deps) =====
const loginAttempts = new Map();
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minuten
const LOGIN_MAX_ATTEMPTS = 10; // max 10 pogingen per window

function getClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0].trim();
  }
  if (Array.isArray(forwarded) && forwarded.length > 0) {
    return forwarded[0].split(',')[0].trim();
  }
  return req.ip || req.connection?.remoteAddress || 'unknown';
}

function loginRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const existing = loginAttempts.get(ip) || { count: 0, first: now };

  // Reset window als het oude window voorbij is
  if (now - existing.first > LOGIN_WINDOW_MS) {
    existing.count = 0;
    existing.first = now;
  }

  existing.count += 1;
  loginAttempts.set(ip, existing);

  if (existing.count > LOGIN_MAX_ATTEMPTS) {
    return res.status(429).json({
      error: 'Te veel mislukte inlogpogingen, probeer het later opnieuw',
      retry_after_seconds: Math.ceil((LOGIN_WINDOW_MS - (now - existing.first)) / 1000)
    });
  }

  return next();
}


// Helper: haal user op met fallback als kolommen niet bestaan
async function getUserById(id) {
  try {
    const r = await executeQuery(
      'SELECT id, email, first_name, last_name, profile_image_url, profile_number, role, is_active, created_at, updated_at FROM users WHERE id = ?',
      [id]
    );
    return r.rows?.[0] ?? null;
  } catch (e) {
    const r = await executeQuery(
      'SELECT id, email, first_name, last_name, role, is_active, created_at, updated_at FROM users WHERE id = ?',
      [id]
    );
    return r.rows?.[0] ?? null;
  }
}


// Verwijder oude profielfoto van externe server
async function deleteOldProfileImage(imageUrl) {
  if (!imageUrl || typeof imageUrl !== 'string') return;
  try {
    const match = imageUrl.match(/holwert\.appenvloed\.com\/(uploads\/\d{4}\/\d{2}\/\d{2}\/[^?#]+)/);
    if (!match) return;
    const filePath = match[1];
    const form = new FormData();
    form.append('path', filePath);
    form.append('secret', process.env.DELETE_SECRET || '');
    await axios.post('https://holwert.appenvloed.com/upload/delete.php', form, {
      headers: { ...form.getHeaders() },
      timeout: 10000,
      httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false })
    });
    console.log('🗑️ Oude profielfoto verwijderd:', filePath);
  } catch (e) {
    console.warn('⚠️ Kon oude profielfoto niet verwijderen:', e.message);
  }
}

// Cleanup loginAttempts periodiek
setInterval(() => {
  const now = Date.now();
  for (const [ip, data] of loginAttempts.entries()) {
    if (now - data.first > LOGIN_WINDOW_MS) {
      loginAttempts.delete(ip);
    }
  }
}, LOGIN_WINDOW_MS);

// ===== Middleware =====
app.use(compression()); // Compress responses for faster transfer
app.use(cors({
  origin: [
    'https://holwert.appenvloed.com',
    /^https?:\/\/localhost(:\d+)?$/,
    /^exp:\/\//,
  ],
  credentials: true
}));
app.use(express.json({ limit: '50mb' })); // Verhoogd voor afbeelding uploads
app.use(express.urlencoded({ limit: '50mb', extended: true }));

// Wacht op database-migraties voor elke request (Vercel serverless cold start)
let _migrationsReady = null;
function getMigrationsReady() {
  if (!_migrationsReady) {
    _migrationsReady = (async () => {
      try {
        await ensureProfileImageUrlColumn();
        await ensureProfileNumberColumn();
        await ensureHolwertRelationshipColumn();
        await ensurePrivacyStatementColumn();
        await ensurePracticalInfoTable();
        await ensureContentPagesTable();
        await initializePushNotificationsTables();
        console.log('✅ Migraties voltooid');
      } catch (e) {
        console.error('Migraties fout:', e?.message || e);
      }
    })();
  }
  return _migrationsReady;
}
app.use(async (req, res, next) => {
  await getMigrationsReady();
  next();
});

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
  connectTimeout: 2000, // 2 seconden timeout voor connectie
  acquireTimeout: 2000, // 2 seconden timeout
  timeout: 5000 // 5 seconden timeout voor queries
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
      const affectedRows = response.data.affectedRows || 0;
      console.log(`[PHP Proxy] Insert result - insertId: ${insertId}, affectedRows: ${affectedRows}`);
      
      // insertId kan null zijn bij ON DUPLICATE KEY UPDATE (update in plaats van insert)
      // Dit is normaal en geen error
      
      return {
        rows: insertId ? [{ id: insertId }] : [],
        rowCount: affectedRows,
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
    if (error.response?.data) {
      console.error('[PHP Proxy] Response status:', error.response.status);
      console.error('[PHP Proxy] Response data:', error.response.data);
      const proxyMsg = error.response.data.message || error.response.data.error;
      if (proxyMsg) {
        const err = new Error(proxyMsg);
        err.code = error.response.data.code;
        err.originalError = error;
        throw err;
      }
    }
    throw error;
  }
}

// Flag: zodra directe MySQL faalt, alleen proxy gebruiken (voorkomt herhaalde timeouts)
let _useProxyOnly = false;

// Helper function voor query execution (MySQL compatible)
// Probeert eerst direct MySQL, fallback naar PHP proxy
async function executeQuery(query, params = []) {
  // Converteer $1, $2, $3 naar ? voor MySQL
  let mysqlQuery = query.replace(/\$(\d+)/g, '?');
  
  // Converteer ILIKE naar LIKE (case-insensitive)
  mysqlQuery = mysqlQuery.replace(/ILIKE/gi, 'LIKE');
  
  const queryUpper = mysqlQuery.trim().toUpperCase();
  let proxyAction = 'execute';
  if (queryUpper.startsWith('INSERT')) proxyAction = 'insert';
  else if (queryUpper.startsWith('UPDATE')) proxyAction = 'update';
  else if (queryUpper.startsWith('DELETE')) proxyAction = 'delete';

  if (_useProxyOnly) {
    return await executeQueryViaProxy(mysqlQuery, params, proxyAction);
  }

  try {
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
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log('[MySQL] Direct connection failed, switching to proxy-only mode');
      _useProxyOnly = true;
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
  
  if (_useProxyOnly) {
    return await executeQueryViaProxy(mysqlQuery, params, 'insert');
  }

  try {
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
    if (error.code === 'ETIMEDOUT' || error.code === 'ECONNREFUSED' || error.code === 'ENOTFOUND') {
      console.log('[MySQL] Direct connection failed, switching to proxy-only mode');
      _useProxyOnly = true;
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

// Setup admin user - SECURITY: Use environment variables only!
app.get('/api/setup-admin', async (req, res) => {
  try {
    // SECURITY: Get credentials from environment variables only
    const email = process.env.ADMIN_EMAIL;
    const password = process.env.ADMIN_PASSWORD;
    
    if (!email || !password) {
      return res.status(400).json({ 
        success: false,
        error: 'Admin credentials not configured',
        message: 'Set ADMIN_EMAIL and ADMIN_PASSWORD environment variables'
      });
    }
    
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
        { expiresIn: '24h' }
      );
      
      res.json({ 
        success: true,
        message: 'Admin user updated',
        email: email,
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
        { expiresIn: '24h' }
      );
      
      res.json({ 
        success: true,
        message: 'Admin user created',
        email: email,
        token: newToken,
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
app.get('/api/debug/columns', async (req, res) => {
  const log = [];
  try {
    // Skip migrations, test directly
    log.push('Testing basic query...');
    try {
      const basic = await executeQuery('SELECT id, email, first_name, last_name FROM users LIMIT 1');
      log.push('Basic query OK: ' + JSON.stringify(basic.rows?.[0] ?? null));
    } catch (e) { log.push('Basic query FAIL: ' + e.message); }

    log.push('Testing information_schema...');
    try {
      const cols = await executeQuery(
        "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users'"
      );
      const colNames = (cols.rows || []).map(c => c.COLUMN_NAME || c.column_name);
      log.push('Columns: ' + colNames.join(', '));

      if (!colNames.includes('profile_image_url')) {
        log.push('Attempting ALTER TABLE...');
        try {
          await executeQuery('ALTER TABLE users ADD COLUMN profile_image_url TEXT NULL');
          log.push('ALTER TABLE profile_image_url: OK');
        } catch (ae) {
          log.push('ALTER TABLE profile_image_url FAIL: ' + ae.message);
        }
      }

      if (!colNames.includes('profile_number')) {
        log.push('Attempting ALTER TABLE profile_number...');
        try {
          await executeQuery("ALTER TABLE users ADD COLUMN profile_number VARCHAR(10) NULL");
          log.push('ALTER TABLE profile_number: OK');
        } catch (ae) {
          log.push('ALTER TABLE profile_number FAIL: ' + ae.message);
        }
      }

    } catch (e) { log.push('information_schema FAIL: ' + e.message); }

    res.json({ log });
  } catch (e) {
    log.push('Fatal: ' + e.message);
    res.json({ error: e.message, log });
  }
});

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
  const allowed = ['admin', 'superadmin', 'editor'];
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
    
    // Folder: uploads/YYYY/MM/ plus organisatie-submap (01, 07, …) of 00 bij geen org
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const orgId = req.body.organizationId != null && req.body.organizationId !== ''
      ? String(parseInt(req.body.organizationId, 10)).padStart(2, '0')
      : '00';
    const folder = `uploads/${year}/${month}/${orgId}/`;
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
      const imageUrl = uploadResponse.data.url.replace('http://', 'https://');
      console.log('Image uploaded successfully:', imageUrl);
      res.json({
        message: 'Image uploaded successfully to external server',
        url: imageUrl,
        imageUrl: imageUrl,
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

// ===== FIXED IMAGE UPLOAD FOR EDITING (base64 fallback) =====
app.post('/api/upload/image', authenticateToken, async (req, res) => {
  try {
    const { imageData, filename, organizationId } = req.body;

    if (!imageData) {
      return res.status(400).json({
        error: 'No image data provided',
        message: 'Please provide imageData (base64 encoded image)'
      });
    }

    console.log('Uploading edit image to external server:', {
      filename: filename || 'unknown',
      dataLength: imageData.length,
      organizationId: organizationId ?? 'none'
    });

    const base64Data = imageData.replace(/^data:image\/[a-z]+;base64,/, '');
    const buffer = Buffer.from(base64Data, 'base64');

    const form = new FormData();
    const uniqueFilename = filename || `image-${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`;
    form.append('file', buffer, {
      filename: uniqueFilename,
      contentType: 'image/jpeg'
    });

    // uploads/YYYY/MM/ + organisatie 01, 07, … of 00
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const orgNum = organizationId != null && organizationId !== ''
      ? String(parseInt(organizationId, 10)).padStart(2, '0')
      : '00';
    const folder = `uploads/${year}/${month}/${orgNum}/`;
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

// Bootstrap: news (eerste pagina) + organizations in één request voor snelle app-opstart
app.get('/api/app/bootstrap', async (req, res) => {
  try {
    await ensureBookmarksTable();
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        userId = decoded.userId;
      } catch (e) { /* ignore */ }
    }

    const newsParams = [];
    let newsQuery = `
      SELECT n.id, n.title, '' as content,
        COALESCE(n.excerpt, LEFT(COALESCE(n.content, ''), 2000)) as excerpt,
        n.image_url, n.created_at, n.updated_at,
        COALESCE(n.published_at, n.created_at) as published_at,
        n.organization_id, o.name as organization_name, o.logo_url as organization_logo,
        o.brand_color as organization_brand_color
        ${userId ? ', CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as is_bookmarked' : ', false as is_bookmarked'}
      FROM news n
      LEFT JOIN organizations o ON n.organization_id = o.id
      ${userId ? 'LEFT JOIN bookmarks b ON b.news_id = n.id AND b.user_id = ?' : ''}
      WHERE n.is_published = true
      ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT 10 OFFSET 0`;
    if (userId) newsParams.push(userId);

    const orgFields = `id, name, description, logo_url, brand_color, category,
      CASE WHEN logo_url IS NOT NULL AND logo_url <> '' THEN true ELSE false END as has_logo`;
    const orgQuery = `SELECT ${orgFields} FROM organizations WHERE is_approved = true ORDER BY name ASC LIMIT 100`;
    const countNewsQuery = 'SELECT COUNT(*) as total FROM news n WHERE n.is_published = true';

    const [newsResult, orgResult, countResult] = await Promise.all([
      executeQuery(newsQuery, newsParams),
      executeQuery(orgQuery, []),
      executeQuery(countNewsQuery, [])
    ]);

    const stripHtml = (input) => {
      if (!input) return '';
      return String(input).replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    };
    const newsRows = (newsResult.rows || []).map((article) => {
      const cleanExcerpt = stripHtml(article.excerpt).slice(0, 120);
      return { ...article, excerpt: cleanExcerpt };
    });

    let orgRows = orgResult.rows || [];
    // Laat logo_url ongemoeid; de mobiele app normaliseert zelf base64 -> file:// via ApiService
    orgRows = orgRows.map((o) => ({
      ...o,
      description: typeof o.description === 'string' ? o.description.slice(0, 200) : o.description
    }));

    const totalNews = parseInt(countResult.rows?.[0]?.total || 0);
    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      news: newsRows,
      newsPagination: { page: 1, limit: 10, total: totalNews, pages: Math.ceil(totalNews / 10) },
      organizations: orgRows,
      organizationsPagination: { page: 1, limit: 100, total: orgRows.length, pages: 1 }
    });
  } catch (error) {
    console.error('Bootstrap error:', error);
    res.status(500).json({ error: 'Bootstrap failed', message: error.message });
  }
});

// Get all published news (public, with optional bookmark status if authenticated)
app.get('/api/news', async (req, res) => {
  try {
    await ensureBookmarksTable();
    const { organization_id, category, search, minimal = false } = req.query;
    const limit = req.query.limit ?? 20;
    const page = req.query.page ?? 1;
    
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
    
    const limitValue = Math.min(parseInt(limit) || 20, 100);
    const pageValue = Math.max(parseInt(page) || 1, 1);
    const offset = (pageValue - 1) * limitValue;
    const minimalMode = minimal === 'true';
    const params = [];
    
    let query = `
      SELECT 
        n.id, 
        n.title, 
        ${minimalMode ? `'' as content` : `COALESCE(n.content, '') as content`},
        COALESCE(n.excerpt, LEFT(COALESCE(n.content, ''), 2000)) as excerpt,
        n.image_url,
        n.created_at, 
        n.updated_at, 
        COALESCE(n.published_at, n.created_at) as published_at,
        n.organization_id,
        o.name as organization_name, 
        o.logo_url as organization_logo,
        o.brand_color as organization_brand_color
        ${userId ? ', CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as is_bookmarked' : ', false as is_bookmarked'}
      FROM news n
      LEFT JOIN organizations o ON n.organization_id = o.id
      ${userId ? `LEFT JOIN bookmarks b ON b.news_id = n.id AND b.user_id = ?` : ''}
      WHERE n.is_published = true
    `;
    
    if (userId) {
      params.push(userId);
    }
    
    // Filter by organization_id if provided
    if (organization_id) {
      query += ` AND n.organization_id = ?`;
      params.push(parseInt(organization_id));
    }

    if (category) {
      query += ` AND (n.category = ? OR n.custom_category = ?)`;
      params.push(category, category);
    }

    if (search) {
      const s = `%${String(search)}%`;
      query += ` AND (n.title LIKE ? OR n.excerpt LIKE ? OR n.content LIKE ?)`;
      params.push(s, s, s);
    }
    
    // Sorteer op published_at (publicatiedatum), fallback naar created_at als published_at NULL is
    query += ` ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT ? OFFSET ?`;
    params.push(limitValue, offset);

    // Count query (voor pagination)
    const countParams = [];
    let countQuery = `SELECT COUNT(*) as total FROM news n WHERE n.is_published = true`;
    if (organization_id) {
      countQuery += ` AND n.organization_id = ?`;
      countParams.push(parseInt(organization_id));
    }
    if (category) {
      countQuery += ` AND (n.category = ? OR n.custom_category = ?)`;
      countParams.push(category, category);
    }
    if (search) {
      const s = `%${String(search)}%`;
      countQuery += ` AND (n.title LIKE ? OR n.excerpt LIKE ? OR n.content LIKE ?)`;
      countParams.push(s, s, s);
    }

    const [result, countResult] = await Promise.all([
      executeQuery(query, params),
      executeQuery(countQuery, countParams)
    ]);
    const total = parseInt(countResult.rows?.[0]?.total || 0);

    const stripHtml = (input) => {
      if (!input) return '';
      return String(input)
        .replace(/<[^>]*>/g, ' ')
        // Remove any dangling "<tag" fragments without closing ">"
        .replace(/<[^>]*$/g, ' ')
        .replace(/&nbsp;/gi, ' ')
        .replace(/&amp;/gi, '&')
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/\s+/g, ' ')
        .trim();
    };

    // Lijst licht houden: bij minimal geen image_variants (app gebruikt image_url)
    const processedNews = result.rows.map(article => {
      const cleanExcerpt = minimalMode ? stripHtml(article.excerpt).slice(0, 120) : article.excerpt;
      const item = { ...article, excerpt: cleanExcerpt };
      if (!minimalMode) {
        item.image_variants = {
          original: article.image_url,
          full: article.image_url,
          large: article.image_url,
          medium: article.image_url,
          thumbnail: article.image_url
        };
      }
      return item;
    });

    res.set('Cache-Control', 'public, max-age=30');
    res.json({
      news: processedNews,
      pagination: {
        page: pageValue,
        limit: limitValue,
        total: total,
        pages: Math.ceil(total / limitValue)
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
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.image_url,
             n.created_at, 
             COALESCE(n.published_at, n.created_at) as published_at,
             u.first_name, u.last_name,
             o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
      FROM news n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.is_published = true AND n.organization_id = ?`;
    if (exclude) {
      params.push(parseInt(exclude));
      query += ` AND n.id <> ?`;
    }
    params.push(parseInt(limit));
    // Sorteer op published_at (publicatiedatum), fallback naar created_at
    query += ` ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT ?`;

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

// Fast bookmark count for profile stats
app.get('/api/app/bookmarks/count', authenticateToken, async (req, res) => {
  try {
    await ensureBookmarksTable();
    const userId = req.user.userId;
    const result = await executeQuery('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?', [userId]);
    res.json({ count: result.rows?.[0]?.count ?? 0 });
  } catch (error) {
    res.json({ count: 0 });
  }
});

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
        WHERE b.user_id = ?
        ORDER BY b.created_at DESC
        LIMIT 100
      `, [userId]);
      return res.json({ bookmarks: result.rows || [] });
    } else {
      const result = await executeQuery(`
        SELECT news_id, created_at FROM bookmarks WHERE user_id = ? ORDER BY created_at DESC LIMIT 500
      `, [userId]);
      return res.json({ bookmarks: result.rows || [] });
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
    const result = await executeQuery(`SELECT 1 FROM bookmarks WHERE user_id = ? AND news_id = ?`, [userId, newsId]);
    res.json({ bookmarked: result.length > 0 });
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
      INSERT INTO bookmarks (user_id, news_id) VALUES (?, ?)
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
    const result = await executeQuery(`DELETE FROM bookmarks WHERE user_id = ? AND news_id = ?`, [userId, newsId]);
    res.json({ success: true, removed: result.affectedRows > 0 });
  } catch (error) {
    console.error('Remove bookmark error:', error);
    res.status(500).json({ error: 'Failed to remove bookmark', message: error.message });
  }
});

// ===== APP FOLLOWS (organizations) =====
async function ensureFollowsTable() {
  try {
    // Check of tabel bestaat via proxy (CREATE TABLE wordt geblokkeerd door proxy)
    try {
      await executeQueryViaProxy(`SELECT 1 FROM follows LIMIT 1`, [], 'execute');
      // Tabel bestaat al
      return;
    } catch (checkError) {
      // Tabel bestaat niet - probeer aan te maken via proxy
      // Maar CREATE TABLE wordt geblokkeerd, dus we kunnen alleen checken
      console.log('[ensureFollowsTable] Table check failed, but CREATE TABLE is blocked by proxy');
      // Tabel moet handmatig aangemaakt worden of via een andere methode
    }
  } catch (e) {
    console.error('[ensureFollowsTable] Error details:', {
      message: e.message,
      code: e.code,
      errno: e.errno,
      sqlState: e.sqlState,
      stack: e.stack
    });
    // Don't throw - table might already exist
  }
}

// List following orgs
app.get('/api/app/following', authenticateToken, async (req, res) => {
  try {
    await ensureFollowsTable();
    const userId = req.user.userId;
    // Gebruik altijd proxy voor follow queries (Vercel serverless heeft geen directe MySQL)
    const result = await executeQueryViaProxy(
      `SELECT organization_id, created_at FROM follows WHERE user_id = ? ORDER BY created_at DESC`,
      [userId],
      'execute'
    );
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
    // Gebruik altijd proxy voor follow queries (Vercel serverless heeft geen directe MySQL)
    const result = await executeQueryViaProxy(
      `SELECT 1 FROM follows WHERE user_id = ? AND organization_id = ?`,
      [userId, orgId],
      'execute'
    );
    res.json({ following: result.rows.length > 0 });
  } catch (error) {
    console.error('Check following error:', error);
    res.status(500).json({ error: 'Failed to check following', message: error.message });
  }
});

// Follow org
app.post('/api/app/follow', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { organization_id } = req.body;
    if (!organization_id) return res.status(400).json({ error: 'organization_id is required' });
    
    console.log(`[Follow] User ${userId} following org ${organization_id}`);
    
    // Eerst checken of tabel bestaat
    try {
      await executeQueryViaProxy(`SELECT 1 FROM follows LIMIT 1`, [], 'execute');
    } catch (tableError) {
      console.error('[Follow] Table check failed:', tableError.message);
      // Tabel bestaat mogelijk niet, maar we proberen toch de insert
    }
    
    // Gebruik altijd proxy voor follow queries (Vercel serverless heeft geen directe MySQL)
    // ON DUPLICATE KEY UPDATE zorgt ervoor dat dubbele entries worden geupdate in plaats van error
    const result = await executeQueryViaProxy(
      `INSERT INTO follows (user_id, organization_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE user_id = user_id`,
      [userId, organization_id],
      'insert'
    );
    console.log(`[Follow] Success - affectedRows: ${result.rowCount}, insertId: ${result.insertId}`);
    res.status(201).json({ success: true });
  } catch (error) {
    console.error('[Follow] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      response: error.response?.data,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers
    });
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    res.status(500).json({ error: 'Failed to follow', message: errorMessage });
  }
});

// Unfollow org
app.delete('/api/app/follow/:organization_id', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const orgId = parseInt(req.params.organization_id);
    
    console.log(`[Unfollow] User ${userId} unfollowing org ${orgId}`);
    // Gebruik altijd proxy voor follow queries (Vercel serverless heeft geen directe MySQL)
    const result = await executeQueryViaProxy(
      `DELETE FROM follows WHERE user_id = ? AND organization_id = ?`,
      [userId, orgId],
      'delete'
    );
    console.log(`[Unfollow] Success - affectedRows: ${result.rowCount}`);
    res.json({ success: true, removed: result.rowCount > 0 });
  } catch (error) {
    console.error('[Unfollow] Error details:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      response: error.response?.data,
      responseStatus: error.response?.status,
      responseHeaders: error.response?.headers
    });
    const errorMessage = error.response?.data?.message || error.message || 'Unknown error';
    res.status(500).json({ error: 'Failed to unfollow', message: errorMessage });
  }
});

// Followers count for a given organization (public)
app.get('/api/organizations/:id/followers/count', async (req, res) => {
  try {
    await ensureFollowsTable();
    const orgId = parseInt(req.params.id);
    // Gebruik altijd proxy voor follow queries (Vercel serverless heeft geen directe MySQL)
    const result = await executeQueryViaProxy(
      `SELECT COUNT(*) AS count FROM follows WHERE organization_id = ?`,
      [orgId],
      'execute'
    );
    const count = (result.rows?.[0]?.count) || 0;
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
      'SELECT id FROM push_tokens WHERE token = ?',
      [token]
    );
    
    if (existingToken.rows.length > 0) {
      // Update existing token
      await executeQuery(
        `UPDATE push_tokens 
         SET user_id = ?, 
             device_type = ?, 
             device_name = ?,
             notification_preferences = COALESCE(?, notification_preferences),
             is_active = true,
             last_used_at = CURRENT_TIMESTAMP,
             updated_at = CURRENT_TIMESTAMP
         WHERE token = ?`,
        [userId, device_type, device_name, notification_preferences ? JSON.stringify(notification_preferences) : null, token]
      );
      
      console.log(`✅ Updated push token for user ${userId}`);
      res.json({ success: true, message: 'Push token updated' });
    } else {
      // Insert new token
      await executeQuery(
        `INSERT INTO push_tokens (user_id, token, device_type, device_name, notification_preferences)
         VALUES (?, ?, ?, ?, ?)`,
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
       SET notification_preferences = ?, updated_at = CURRENT_TIMESTAMP
       WHERE user_id = ?`,
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
      'DELETE FROM push_tokens WHERE token = ? AND user_id = ?',
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
      'UPDATE push_tokens SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?',
      [userId]
    );
    
    console.log(`✅ Deactivated all push tokens for user ${userId}`);
    res.json({ success: true, message: 'All push tokens deactivated' });
  } catch (error) {
    console.error('Deactivate push tokens error:', error);
    res.status(500).json({ error: 'Failed to deactivate push tokens', message: error.message });
  }
});

// Mute push notifications for one organization (per user)
app.post('/api/push/mute-organization', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { organization_id } = req.body;
    if (!organization_id) {
      return res.status(400).json({ error: 'organization_id is required' });
    }
    await executeQuery(
      'INSERT IGNORE INTO push_notification_mutes (user_id, organization_id) VALUES (?, ?)',
      [userId, organization_id]
    );
    res.json({ success: true, muted: true });
  } catch (error) {
    console.error('Mute organization error:', error);
    res.status(500).json({ error: 'Failed to mute organization', message: error.message });
  }
});

// Unmute push notifications for one organization
app.delete('/api/push/mute-organization/:organizationId', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const organizationId = req.params.organizationId;
    await executeQuery(
      'DELETE FROM push_notification_mutes WHERE user_id = ? AND organization_id = ?',
      [userId, organizationId]
    );
    res.json({ success: true, muted: false });
  } catch (error) {
    console.error('Unmute organization error:', error);
    res.status(500).json({ error: 'Failed to unmute organization', message: error.message });
  }
});

// List organizations this user has muted (for UI)
app.get('/api/push/muted-organizations', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const result = await executeQuery(
      'SELECT organization_id FROM push_notification_mutes WHERE user_id = ?',
      [userId]
    );
    const ids = (result.rows || []).map(r => r.organization_id);
    res.json({ muted_organization_ids: ids });
  } catch (error) {
    console.error('Get muted organizations error:', error);
    res.status(500).json({ error: 'Failed to get muted organizations', message: error.message });
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
       WHERE user_id = ?
       ORDER BY last_used_at DESC`,
      [userId]
    );
    
    res.json({ tokens: result.rows });
  } catch (error) {
    console.error('Get push tokens error:', error);
    res.status(500).json({ error: 'Failed to get push tokens', message: error.message });
  }
});

// Get news count (public)
app.get('/api/news/count', async (req, res) => {
  try {
    const { organization_id } = req.query;
    
    let query = 'SELECT COUNT(*) as total FROM news WHERE is_published = true';
    const params = [];
    
    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(parseInt(organization_id));
    }
    
    const result = await executeQuery(query, params);
    const total = result.rows[0]?.total || 0;
    
    res.json({ total: parseInt(total) });
  } catch (error) {
    console.error('Get news count error:', error);
    res.status(500).json({ error: 'Failed to get news count', message: error.message });
  }
});

// Light "head" voor eerste paint – MOET vóór /api/news/:id staan zodat "head" niet als id wordt gezien
app.get('/api/news/head', async (req, res) => {
  try {
    await ensureBookmarksTable();
    const limit = Math.min(parseInt(req.query.limit, 10) || 7, 20);
    let userId = null;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      try {
        const decoded = jwt.verify(authHeader.substring(7), JWT_SECRET);
        userId = decoded.userId;
      } catch (e) { /* ignore */ }
    }
    const newsParams = [];
    const newsQuery = `
      SELECT n.id, n.title,
        COALESCE(n.excerpt, LEFT(COALESCE(n.content, ''), 500)) as excerpt,
        n.image_url, n.created_at, n.updated_at,
        COALESCE(n.published_at, n.created_at) as published_at,
        n.organization_id, o.name as organization_name, o.logo_url as organization_logo,
        o.brand_color as organization_brand_color
        ${userId ? ', CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as is_bookmarked' : ', false as is_bookmarked'}
      FROM news n
      LEFT JOIN organizations o ON n.organization_id = o.id
      ${userId ? 'LEFT JOIN bookmarks b ON b.news_id = n.id AND b.user_id = ?' : ''}
      WHERE n.is_published = true
      ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT ?`;
    if (userId) newsParams.push(userId);
    newsParams.push(limit);

    const newsResult = await executeQuery(newsQuery, newsParams);
    const stripHtml = (input) => {
      if (!input) return '';
      return String(input).replace(/<[^>]*>/g, ' ').replace(/<[^>]*$/g, ' ').replace(/&nbsp;/gi, ' ').replace(/\s+/g, ' ').trim();
    };
    const newsRows = (newsResult.rows || []).map((article) => {
      const cleanExcerpt = stripHtml(article.excerpt).slice(0, 120);
      return { ...article, excerpt: cleanExcerpt };
    });

    res.set('Cache-Control', 'public, max-age=30');
    res.json({ news: newsRows });
  } catch (error) {
    console.error('News head error:', error);
    res.status(500).json({ error: 'News head failed', message: error.message });
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
    
    // Check if published_at column exists, if not use created_at
    const result = await executeQuery(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url,
             n.created_at, n.updated_at, 
             COALESCE(n.published_at, n.created_at) as published_at,
             n.category, n.custom_category, n.is_published,
             u.first_name, u.last_name,
             o.id as organization_id, o.name as organization_name, o.logo_url as organization_logo, o.brand_color as organization_brand_color
             ${userId ? ', CASE WHEN b.user_id IS NOT NULL THEN true ELSE false END as is_bookmarked' : ', false as is_bookmarked'}
      FROM news n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      ${userId ? `LEFT JOIN bookmarks b ON b.news_id = n.id AND b.user_id = ${userId}` : ''}
      WHERE n.id = ? AND n.is_published = true
      LIMIT 1
    `, [id]);

    if (!result.rows || result.rows.length === 0) {
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
    const { title, content, excerpt, category, custom_category, organization_id, image_url, published_at } = req.body;
    let authorId = req.user?.userId || null;

    // Validation
    if (!title || !content) {
      return res.status(400).json({
        error: 'Title and content are required'
      });
    }

    // Determine publication status
    let isPublished = false;

    // Admin mag direct publiceren op basis van aangevinkte optie
    if (req.user?.role === 'admin') {
      isPublished = req.body.is_published === true;
    } else if (organization_id) {
      // Niet-admin: publiceer alleen meteen als organisatie goedgekeurd is
      const orgResult = await executeQuery(
        'SELECT is_approved FROM organizations WHERE id = ?',
        [organization_id]
      );
      
      if (orgResult.rows.length > 0 && orgResult.rows[0].is_approved) {
        isPublished = true;
      }
    }

    // Handle category logic
    let finalCategory = category || 'dorpsnieuws';
    let finalCustomCategory = null;
    
    if (category === 'overig' && custom_category) {
      finalCustomCategory = custom_category;
    }

    // Validate author exists; if niet gevonden, zet op null om FK-fouten te voorkomen
    if (authorId) {
      try {
        const authorCheck = await executeQuery('SELECT id FROM users WHERE id = ? LIMIT 1', [authorId]);
        if (!authorCheck.rows.length) {
          console.warn('Author not found, storing news without author_id');
          authorId = null;
        }
      } catch (e) {
        console.warn('Author check failed, fallback to null author_id:', e.message);
        authorId = null;
      }
    }

    // Insert into news table (MySQL: geen RETURNING; gebruik executeInsert)
    // Gebruik published_at uit request, of zet automatisch bij publicatie
    let publishedAtValue = null;
    if (published_at) {
      // Gebruik opgegeven publicatiedatum
      publishedAtValue = published_at;
    } else if (isPublished) {
      // Als artikel wordt gepubliceerd maar geen datum is opgegeven, gebruik NOW()
      publishedAtValue = 'NOW()';
    }
    
    // Probeer eerst met published_at, fallback naar zonder als kolom niet bestaat
    let insertResult;
    try {
      if (publishedAtValue) {
        // Probeer met published_at kolom
        // Gebruik STR_TO_DATE voor published_at om zeker te zijn van correcte parsing
        const publishedAtSQL = publishedAtValue === 'NOW()' 
          ? 'NOW()' 
          : `STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')`;
        const insertParams = publishedAtValue === 'NOW()' 
          ? [title, content, excerpt || null, authorId, organization_id || null, image_url || null, finalCategory, finalCustomCategory, isPublished]
          : [title, content, excerpt || null, authorId, organization_id || null, image_url || null, finalCategory, finalCustomCategory, isPublished, publishedAtValue];
        
        insertResult = await executeInsert(
          `INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, category, custom_category, is_published, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ${publishedAtSQL}, NOW(), NOW())`,
          insertParams
        );
      } else {
        // Geen published_at (artikel niet gepubliceerd)
        insertResult = await executeInsert(
          'INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, category, custom_category, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
          [title, content, excerpt || null, authorId, organization_id || null, image_url || null, finalCategory, finalCustomCategory, isPublished]
        );
      }
    } catch (insertError) {
      // Als published_at kolom niet bestaat, probeer zonder
      if (insertError.message && insertError.message.includes('published_at')) {
        console.log('⚠️ published_at kolom bestaat nog niet, gebruik fallback zonder published_at');
        insertResult = await executeInsert(
          'INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, category, custom_category, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
          [title, content, excerpt || null, authorId, organization_id || null, image_url || null, finalCategory, finalCustomCategory, isPublished]
        );
      } else {
        throw insertError; // Re-throw als het een andere error is
      }
    }

    if (!insertResult.insertId) {
      throw new Error('Failed to insert news (no insertId returned)');
    }

    const fetchResult = await executeQuery(
      'SELECT id, title, COALESCE(content, \'\') AS content, excerpt, category, custom_category, image_url, is_published, COALESCE(published_at, created_at) as published_at, author_id, organization_id, created_at, updated_at FROM news WHERE id = ? LIMIT 1',
      [insertResult.insertId]
    );

    if (!fetchResult.rows.length) {
      throw new Error(`Inserted news not found with id ${insertResult.insertId}`);
    }

    const newArticle = fetchResult.rows[0];
    
    // Send push notification if published and has organization
    if (isPublished && organization_id) {
      try {
        // Get organization name
        const orgResult = await executeQuery(
          'SELECT name FROM organizations WHERE id = ?',
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

    // Invalidate cache for news endpoints
    invalidateCache('/api/news');
    invalidateCache('/api/featured');
    invalidateCache('/api/admin/news');
    invalidateCache('/api/admin/dashboard');

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
    const { title, content, excerpt, category, custom_category, organization_id, image_url } = req.body;
    const userId = req.user.userId;

    // Check if article exists and user has permission
    const existingArticle = await executeQuery(
      'SELECT id, author_id, is_published FROM news WHERE id = ?',
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
    await executeQuery(
      'UPDATE news SET title = ?, content = ?, excerpt = ?, organization_id = ?, image_url = ?, category = ?, custom_category = ?, updated_at = NOW() WHERE id = ?',
      [title, content, excerpt || null, organization_id || null, image_url || null, finalCategory, finalCustomCategory, id]
    );

    const fetchResult = await executeQuery(
      'SELECT id, title, COALESCE(content, \'\') as content, excerpt, category, custom_category, image_url, is_published, COALESCE(published_at, created_at) as published_at, author_id, organization_id, created_at, updated_at FROM news WHERE id = ? LIMIT 1',
      [id]
    );

    // Invalidate cache for news endpoints
    invalidateCache('/api/news');
    invalidateCache(`/api/news/${id}`);
    invalidateCache('/api/featured');
    invalidateCache('/api/admin/news');
    invalidateCache('/api/admin/dashboard');

    res.json({
      message: 'Article updated successfully',
      article: fetchResult.rows[0]
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
app.post('/api/auth/login', loginRateLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    
    if (!email || !password) {
      return res.status(400).json({
        error: 'Email and password are required',
        field: 'general'
      });
    }

    // Find user by email (zonder profile_image_url i.v.m. oude DB zonder deze kolom)
    let userResult;
    try {
      userResult = await executeQuery(
        'SELECT id, email, password_hash, first_name, last_name, profile_image_url, profile_number, role, is_active FROM users WHERE email = ?',
        [email]
      );
    } catch (colErr) {
      userResult = await executeQuery(
        'SELECT id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE email = ?',
        [email]
      );
    }

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
    const isValidPassword = await bcrypt.compare(password, user.password_hash);
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

    // Return success response (profile_picture null zolang kolom niet bestaat)
    res.json({
      message: 'Login successful',
      token: token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_picture: user.profile_image_url ?? null,
        profile_image_url: user.profile_image_url ?? null,
        profile_number: user.profile_number ?? null,
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

// Register handler (gebruikt voor beide route-varianten i.v.m. Vercel path-handling)
const handleRegister = async (req, res) => {
  try {
    const { email, password, first_name, last_name, phone, relationship_with_holwert } = req.body;

    if (!email || !password || !first_name || !last_name) {
      return res.status(400).json({
        error: 'Email, wachtwoord, voornaam en achternaam zijn verplicht',
        field: 'general'
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        error: 'Wachtwoord moet minimaal 6 tekens zijn',
        field: 'password'
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: 'Ongeldig e-mailadres',
        field: 'email'
      });
    }

    const existing = await executeQuery('SELECT id FROM users WHERE email = ?', [email]);
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Dit e-mailadres is al geregistreerd',
        field: 'email'
      });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const insertResult = await executeInsert(
      `INSERT INTO users (email, password_hash, first_name, last_name, role, is_active, relationship_with_holwert)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [email.trim(), hashedPassword, first_name.trim(), last_name.trim(), 'user', true, relationship_with_holwert || null]
    );

    const userId = insertResult.insertId || insertResult.rows?.[0]?.id;
    if (!userId) {
      return res.status(500).json({ error: 'Registratie mislukt', message: 'Kon gebruiker niet aanmaken' });
    }

    // Genereer profielnummer
    const profileNumber = String(userId).padStart(4, '0');
    try {
      await executeQuery('UPDATE users SET profile_number = ? WHERE id = ?', [profileNumber, userId]);
    } catch (pnErr) {
      console.warn('profile_number update failed (column may not exist):', pnErr.message);
    }

    let userResult;
    try {
      userResult = await executeQuery(
        'SELECT id, email, first_name, last_name, profile_image_url, profile_number, relationship_with_holwert, created_at, updated_at, role FROM users WHERE id = ?',
        [userId]
      );
    } catch (colErr) {
      userResult = await executeQuery(
        'SELECT id, email, first_name, last_name, role FROM users WHERE id = ?',
        [userId]
      );
    }
    const user = userResult.rows[0];

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.status(201).json({
      message: 'Account aangemaakt',
      token,
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_picture: user.profile_image_url || null,
        profile_image_url: user.profile_image_url || null,
        profile_number: user.profile_number ?? null,
        relationship_with_holwert: user.relationship_with_holwert ?? null,
        created_at: user.created_at ?? null,
        updated_at: user.updated_at ?? null,
        role: user.role
      }
    });
  } catch (error) {
    const isDuplicateEmail = error.code === '23505' || error.code === 'ER_DUP_ENTRY' || error.errno === 1062 ||
      error.code === '23000' || error.code === 23000 ||
      (error.message && (error.message.includes('Duplicate entry') || error.message.includes('1062')));
    if (isDuplicateEmail) {
      return res.status(409).json({ error: 'Dit e-mailadres is al geregistreerd', field: 'email' });
    }
    console.error('Register error:', error);
    res.status(500).json({
      error: 'Registratie mislukt',
      message: error.message
    });
  }
};

app.post('/api/auth/register', loginRateLimiter, handleRegister);
app.post('/auth/register', loginRateLimiter, handleRegister);

// Verify token and return current user info (for debugging roles)
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({
    valid: true,
    user: req.user,
    role: req.user && req.user.role ? req.user.role : null,
    issuedAt: new Date().toISOString()
  });
});

// Get current user profile (authenticated, zonder profile_image_url in SELECT i.v.m. oude DB)
app.get('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let result;
    try {
      result = await executeQuery(
        'SELECT id, email, first_name, last_name, profile_image_url, profile_number, role, relationship_with_holwert, created_at, updated_at FROM users WHERE id = ?',
        [userId]
      );
    } catch (colErr) {
      result = await executeQuery(
        'SELECT id, email, first_name, last_name, role, created_at, updated_at FROM users WHERE id = ?',
        [userId]
      );
    }
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = result.rows[0];
    res.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_picture: user.profile_image_url ?? null,
        profile_image_url: user.profile_image_url ?? null,
        profile_number: user.profile_number ?? null,
        relationship_with_holwert: user.relationship_with_holwert ?? null,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get profile', message: error.message });
  }
});

// Update current user profile (authenticated, own profile only)
app.put('/api/auth/profile', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    let raw = req.body;
    if (typeof raw === 'string') { try { raw = JSON.parse(raw); } catch(e) { raw = {}; } }
    raw = raw || {};
    const first_name = raw.first_name;
    const last_name = raw.last_name;
    const profile_image_url = raw.profile_image_url ?? raw.profileImageUrl ?? raw.imageUrl ?? raw.url;
    const profile_picture = raw.profile_picture ?? raw.profilePicture ?? profile_image_url;

    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return '?'; };

    if (first_name !== undefined) { sets.push(`first_name = ${push(first_name)}`); }
    if (last_name !== undefined) { sets.push(`last_name = ${push(last_name)}`); }
    const imageUrl = profile_image_url ?? profile_picture;
    const hasImageUpdate = imageUrl !== undefined;
    let oldImageUrl = null;
    if (hasImageUpdate) {
      sets.push(`profile_image_url = ${push(imageUrl)}`);
      try {
        const oldResult = await executeQuery('SELECT profile_image_url FROM users WHERE id = ?', [userId]);
        oldImageUrl = oldResult.rows?.[0]?.profile_image_url ?? null;
      } catch (e) { /* kolom bestaat mogelijk niet */ }
    }

    if (!sets.length) {
      // Geen velden om te updaten: gewoon huidige user teruggeven (geen 400)
      let currentResult;
      try {
        currentResult = await executeQuery(
          'SELECT id, email, first_name, last_name, profile_image_url, profile_number, role, created_at, updated_at FROM users WHERE id = ?',
          [userId]
        );
      } catch (colErr) {
        currentResult = await executeQuery(
          'SELECT id, email, first_name, last_name, role, created_at, updated_at FROM users WHERE id = ?',
          [userId]
        );
      }
      const cu = currentResult.rows?.[0];
      if (!cu) return res.status(404).json({ error: 'User not found' });
      return res.json({
        user: {
          id: cu.id, email: cu.email, first_name: cu.first_name, last_name: cu.last_name,
          profile_picture: cu.profile_image_url ?? null, profile_image_url: cu.profile_image_url ?? null,
          profile_number: cu.profile_number ?? null, role: cu.role,
          created_at: cu.created_at, updated_at: cu.updated_at
        }
      });
    }

    params.push(userId);
    try {
      await executeQuery(
        `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
        params
      );
    } catch (updateErr) {
      // Kolom profile_image_url bestaat nog niet in oude DB: opnieuw proberen zonder dat veld
      const msg = updateErr.message || '';
      if (hasImageUpdate && (msg.includes('profile_image_url') || msg.includes('1054') || msg.includes('Unknown column'))) {
        const setsFallback = [];
        const paramsFallback = [];
        const pushF = (v) => { paramsFallback.push(v); return '?'; };
        if (first_name !== undefined) { setsFallback.push(`first_name = ${pushF(first_name)}`); }
        if (last_name !== undefined) { setsFallback.push(`last_name = ${pushF(last_name)}`); }
        if (!setsFallback.length) {
          return res.status(400).json({ error: 'No fields to update' });
        }
        paramsFallback.push(userId);
        await executeQuery(
          `UPDATE users SET ${setsFallback.join(', ')}, updated_at = NOW() WHERE id = ?`,
          paramsFallback
        );
        // Foto niet in DB opgeslagen, maar we geven de URL wel terug zodat de app hem kan tonen
      } else {
        throw updateErr;
      }
    }

    const fetchResult = await executeQuery(
      'SELECT id, email, first_name, last_name, profile_image_url, profile_number, role, created_at, updated_at FROM users WHERE id = ?',
      [userId]
    );
    if (!fetchResult.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = fetchResult.rows[0];
    const profilePic = user.profile_image_url ?? imageUrl ?? null;

    if (hasImageUpdate && oldImageUrl && oldImageUrl !== profilePic) {
      deleteOldProfileImage(oldImageUrl).catch(() => {});
    }

    res.json({
      user: {
        id: user.id,
        email: user.email,
        first_name: user.first_name,
        last_name: user.last_name,
        profile_picture: profilePic,
        profile_image_url: profilePic,
        profile_number: user.profile_number ?? null,
        role: user.role,
        created_at: user.created_at,
        updated_at: user.updated_at
      }
    });
  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile', message: error.message });
  }
});

// ===== ADMIN ENDPOINTS =====

// Get admin dashboard in one request (stats + moderation counts) - fastest admin load
app.get('/api/admin/dashboard', authenticateToken, async (req, res) => {
  try {
    const cacheKey = getCacheKey('/api/admin/dashboard');
    const cached = getCached(cacheKey);
    if (cached) {
      console.log('[Dashboard] Returning cached data');
      return res.json(cached);
    }
    console.log('[Dashboard] Fetching fresh data from database');
    const result = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM users) as users_count,
        (SELECT COUNT(*) FROM organizations) as organizations_count,
        (SELECT COUNT(*) FROM news) as news_count,
        (SELECT COUNT(*) FROM events) as events_count,
        (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as pending_orgs,
        (SELECT COUNT(*) FROM news WHERE is_published = false) as pending_news,
        (SELECT COUNT(*) FROM events WHERE is_published = false) as pending_events
    `);
    const row = result.rows[0] || {};
    const pendingOrgs = parseInt(row.pending_orgs) || 0;
    const pendingNews = parseInt(row.pending_news) || 0;
    const pendingEvents = parseInt(row.pending_events) || 0;
    const payload = {
      stats: {
        users: parseInt(row.users_count) || 0,
        organizations: parseInt(row.organizations_count) || 0,
        news: parseInt(row.news_count) || 0,
        events: parseInt(row.events_count) || 0
      },
      moderation: {
        count: pendingOrgs + pendingNews + pendingEvents,
        organizations: pendingOrgs,
        news: pendingNews,
        events: pendingEvents
      }
    };
    setCache(cacheKey, payload, CACHE_TTL.stats);
    res.json(payload);
  } catch (error) {
    try {
      const result = await executeQuery(`
        SELECT 
          (SELECT COUNT(*) FROM users) as users_count,
          (SELECT COUNT(*) FROM organizations) as organizations_count,
          (SELECT COUNT(*) FROM news) as news_count,
          (SELECT COUNT(*) FROM events) as events_count,
          (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as pending_orgs,
          (SELECT COUNT(*) FROM news WHERE is_published = false) as pending_news
      `);
      const row = result.rows[0] || {};
      const pendingOrgs = parseInt(row.pending_orgs) || 0;
      const pendingNews = parseInt(row.pending_news) || 0;
      const payload = {
        stats: {
          users: parseInt(row.users_count) || 0,
          organizations: parseInt(row.organizations_count) || 0,
          news: parseInt(row.news_count) || 0,
          events: parseInt(row.events_count) || 0
        },
        moderation: {
          count: pendingOrgs + pendingNews,
          organizations: pendingOrgs,
          news: pendingNews,
          events: 0
        }
      };
      setCache(getCacheKey('/api/admin/dashboard'), payload, CACHE_TTL.stats);
      return res.json(payload);
    } catch (e) {
      console.error('Get admin dashboard error:', error);
      res.status(500).json({ error: 'Failed to get dashboard', message: error.message });
    }
  }
});

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
    const orgs = parseInt(row.orgs_count) || 0;
    const news = parseInt(row.news_count) || 0;
    const events = parseInt(row.events_count) || 0;
    const response = { count: orgs + news + events, organizations: orgs, news, events };
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
      const orgs = parseInt(row.orgs_count) || 0;
      const news = parseInt(row.news_count) || 0;
      const response = { count: orgs + news, organizations: orgs, news, events: 0 };
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
    const { page = 1, limit = 20, status, category, minimal } = req.query;
    const offset = (page - 1) * limit;
    const isMinimal = minimal === '1' || minimal === 'true';

    const contentField = isMinimal ? 'NULL as content' : 'n.content';
    const imageField = isMinimal ? 'n.image_url' : 'n.image_url';
    let query = `
      SELECT n.id, n.title, ${contentField}, n.excerpt, n.category, n.custom_category, ${imageField}, 
             n.is_published, n.author_id, n.organization_id, n.created_at, n.updated_at,
             COALESCE(n.published_at, n.created_at) as published_at,
             u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM news n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (status) {
      params.push(status);
      query += ` AND n.status = ?`;
    }

    if (category) {
      params.push(category);
      query += ` AND n.category = ?`;
    }

    // Sorteer op published_at (publicatiedatum), fallback naar created_at
    query += ` ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit));
    params.push(parseInt(offset));

    const result = await executeQuery(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM news n WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND n.status = ?`;
    }
    
    if (category) {
      countParams.push(category);
      countQuery += ` AND n.category = ?`;
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
             n.created_at, n.updated_at, 
             COALESCE(n.published_at, n.created_at) as published_at,
             n.category, n.custom_category, n.is_published,
             u.first_name, u.last_name, o.name as organization_name, o.logo_url as organization_logo
      FROM news n
      LEFT JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.id = ?
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
    const { title, content, excerpt, category, custom_category, organization_id, image_url, image_data, is_published, published_at } = req.body;

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

    // Build update query dynamically to handle optional fields (MySQL syntax)
    let updateFields = [];
    let values = [];

    updateFields.push(`title = ?`);
    values.push(title);

    updateFields.push(`content = ?`);
    values.push(content);

    updateFields.push(`excerpt = ?`);
    values.push(excerpt || null);

    updateFields.push(`category = ?`);
    values.push(finalCategory);

    updateFields.push(`custom_category = ?`);
    values.push(finalCustomCategory);

    updateFields.push(`organization_id = ?`);
    values.push(organization_id || null);

    if (image_url !== undefined) {
      updateFields.push(`image_url = ?`);
      values.push(image_url || null);
    }

    if (image_data !== undefined) {
      updateFields.push(`image_data = ?`);
      values.push(image_data || null);
    }

    if (is_published !== undefined) {
      updateFields.push(`is_published = ?`);
      values.push(is_published);
    }
    
    // Handle published_at: gebruik waarde uit request, of zet automatisch bij publicatie
    if (published_at !== undefined && published_at !== null && published_at !== '') {
      // Gebruik de opgegeven publicatiedatum (formaat: YYYY-MM-DD HH:MM:SS)
      // MySQL accepteert dit formaat direct, maar we gebruiken STR_TO_DATE voor zekerheid
      updateFields.push(`published_at = STR_TO_DATE(?, '%Y-%m-%d %H:%i:%s')`);
      values.push(published_at);
    } else if (is_published === true) {
      // Als artikel wordt gepubliceerd maar geen datum is opgegeven, gebruik NOW()
      // Alleen als published_at nog NULL is (nieuwe publicatie)
      updateFields.push(`published_at = COALESCE(published_at, NOW())`);
    } else if (is_published === false) {
      // Optioneel: zet published_at op NULL wanneer artikel wordt gedepubliceerd
      // Laat dit uit voor nu, zodat historische data behouden blijft
    }

    updateFields.push('updated_at = NOW()');

    values.push(id);
    
    // MySQL: geen RETURNING, gebruik separate SELECT
    try {
      await executeQuery(`UPDATE news SET ${updateFields.join(', ')} WHERE id = ?`, values);
    } catch (updateError) {
      // Als published_at kolom niet bestaat, verwijder die uit updateFields en probeer opnieuw
      if (updateError.message && updateError.message.includes('published_at')) {
        console.log('⚠️ published_at kolom bestaat nog niet, update zonder published_at');
        const fieldsWithoutPublishedAt = updateFields.filter(f => !f.includes('published_at'));
        await executeQuery(`UPDATE news SET ${fieldsWithoutPublishedAt.join(', ')} WHERE id = ?`, values.filter((v, i) => !updateFields[i].includes('published_at')));
      } else {
        throw updateError;
      }
    }
    
    const result = await executeQuery(
      'SELECT id, title, COALESCE(content, \'\') as content, excerpt, category, custom_category, organization_id, image_url, is_published, COALESCE(published_at, created_at) as published_at, author_id, created_at, updated_at FROM news WHERE id = ? LIMIT 1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Invalidate cache for news endpoints
    invalidateCache('/api/news');
    invalidateCache(`/api/news/${id}`);
    invalidateCache('/api/featured');
    invalidateCache('/api/admin/news');
    invalidateCache('/api/admin/dashboard');

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
    const result = await executeQuery('DELETE FROM news WHERE id = ?', [id]);
    if (!result.rowCount) {
      return res.status(404).json({ error: 'Article not found' });
    }
    
    // Invalidate cache for news endpoints
    invalidateCache('/api/news');
    invalidateCache(`/api/news/${id}`);
    invalidateCache('/api/featured');
    invalidateCache('/api/admin/news');
    invalidateCache('/api/admin/dashboard');
    
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
    const allowed = ['admin', 'superadmin', 'editor'];
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
    invalidateCache('/api/admin/dashboard');
    
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
            facebook, instagram, twitter, linkedin, brand_color, logo_url, privacy_statement } = req.body;
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
    if (privacy_statement !== undefined) sets.push(`privacy_statement = ${push(privacy_statement)}`);
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
    invalidateCache('/api/admin/dashboard');
    
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
    invalidateCache('/api/admin/dashboard');
    
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
    invalidateCache('/api/admin/dashboard');
    
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
    invalidateCache('/api/admin/dashboard');
    
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
    // Check if events table exists (MySQL)
    const tableCheck = await executeQuery(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables 
        WHERE table_schema = DATABASE() 
          AND table_name = 'events'
      ) AS exists;
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

    const { page = 1, limit = 20, organization_id, status } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.status = 'scheduled'
    `;
    
    const params = [];
    
    let paramCount = 0;
    if (organization_id) {
      const orgId = parseInt(organization_id);
      if (isNaN(orgId)) return res.status(400).json({ error: 'Invalid organization_id' });
      paramCount++;
      query += ` AND e.organization_id = $${paramCount}`;
      params.push(orgId);
    }
    if (status) {
      paramCount++;
      query += ` AND e.status = $${paramCount}`;
      params.push(status);
    }
    
    query += ` ORDER BY e.event_date ASC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await executeQuery(query, params);

    // Get total count
    let countQuery = `SELECT COUNT(*) as total FROM events e WHERE e.status = 'scheduled'`;
    const countParams = [];
    
    if (organization_id) {
      const orgId = parseInt(organization_id);
      if (!isNaN(orgId)) {
        countParams.push(orgId);
        countQuery += ` AND e.organization_id = $${countParams.length}`;
      }
    }
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

// Get events count (public)
app.get('/api/events/count', async (req, res) => {
  try {
    const { organization_id } = req.query;
    
    // Use same logic as /api/events endpoint - check if events table exists
    let query = 'SELECT COUNT(*) as total FROM events WHERE COALESCE(event_end_date, event_date) >= CURDATE()';
    const params = [];
    
    // Filter by organization_id if provided
    if (organization_id) {
      query += ' AND organization_id = ?';
      params.push(parseInt(organization_id));
    }
    
    const result = await executeQuery(query, params);
    const total = result.rows[0]?.total || 0;
    
    res.json({ total: parseInt(total) });
  } catch (error) {
    console.error('Get events count error:', error);
    // Return 0 instead of error to prevent breaking the app
    res.json({ total: 0 });
  }
});

// Alias route for mobile app expecting /api/events
app.get('/api/events', async (req, res) => {
  try {
    // Check if events table exists (MySQL)
    const { page = 1, limit = 20, organization_id, status } = req.query;
    const offset = (page - 1) * limit;
    const showOnlyUpcoming = req.query.upcoming !== 'false';

    // Haal events direct via de PHP-proxy (zeker de juiste MySQL-DB)
    const proxyBody = {
      action: 'execute',
      query: `
        SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
        FROM events e
        LEFT JOIN organizations o ON e.organization_id = o.id
        WHERE 1=1
        ${showOnlyUpcoming ? ' AND COALESCE(e.event_end_date, e.event_date) >= CURDATE()' : ''}
        ${organization_id ? ' AND e.organization_id = ?' : ''}
        ${status ? ' AND e.status = ?' : ''}
        ORDER BY e.event_date ASC
        LIMIT ? OFFSET ?
      `,
      params: [
        ...(organization_id ? [parseInt(organization_id)] : []),
        ...(status ? [status] : []),
        parseInt(limit),
        parseInt(offset)
      ]
    };

    const proxyCountBody = {
      action: 'execute',
      query: `
        SELECT COUNT(*) as total
        FROM events e
        WHERE 1=1
        ${showOnlyUpcoming ? ' AND COALESCE(e.event_end_date, e.event_date) >= CURDATE()' : ''}
        ${organization_id ? ' AND e.organization_id = ?' : ''}
        ${status ? ' AND e.status = ?' : ''}
      `,
      params: [
        ...(organization_id ? [parseInt(organization_id)] : []),
        ...(status ? [status] : [])
      ]
    };

    const proxyRes = await axios.post(PHP_PROXY_URL, proxyBody, {
      headers: { 'X-API-Key': PHP_PROXY_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000
    });
    const proxyCountRes = await axios.post(PHP_PROXY_URL, proxyCountBody, {
      headers: { 'X-API-Key': PHP_PROXY_API_KEY, 'Content-Type': 'application/json' },
      timeout: 10000
    });

    const events = proxyRes.data.rows || [];
    const total = proxyCountRes.data.rows?.[0]?.total || 0;

    res.json({
      events,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: parseInt(total),
        pages: Math.ceil(total / limit)
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

    if (status) {
      params.push(status);
      query += ` AND e.status = ?`;
    }

    query += ` ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const result = await executeQuery(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM events e WHERE 1=1';
    const countParams = [];
    
    if (status) {
      countParams.push(status);
      countQuery += ` AND e.status = ?`;
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
    const { title, description, event_date, end_date, event_end_date, location, organization_id, status = 'scheduled', price, image_url } = req.body;
    if (!title || !event_date) return res.status(400).json({ error: 'title and event_date are required' });

    // Organizer mag ontbreken; als user niet bestaat, zet organizer_id op null
    let organizerId = req.user?.userId || null;
    if (organizerId) {
      try {
        const orgCheck = await executeQuery('SELECT id FROM users WHERE id = ?', [organizerId]);
        if (!orgCheck.rows.length) organizerId = null;
      } catch (e) {
        organizerId = null;
      }
    }

    const insertResult = await executeInsert(
      `INSERT INTO events (title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [title, description || null, event_date, event_end_date || end_date || null, location || null, organization_id || null, status, organizerId, price || null, image_url || null]
    );

    if (!insertResult.insertId) {
      throw new Error('Failed to insert event (no insertId)');
    }

    const fetchResult = await executeQuery(
      `SELECT id, title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, created_at, updated_at
       FROM events WHERE id = ? LIMIT 1`,
      [insertResult.insertId]
    );

    const newEvent = fetchResult.rows[0];
    
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
    const { title, description, event_date, end_date, event_end_date, location, organization_id, status, price, image_url } = req.body;
    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return `?`; };
    if (title !== undefined) sets.push(`title = ${push(title)}`);
    if (description !== undefined) sets.push(`description = ${push(description)}`);
    if (event_date !== undefined) sets.push(`event_date = ${push(event_date)}`);
    if (end_date !== undefined || event_end_date !== undefined) sets.push(`event_end_date = ${push(event_end_date !== undefined ? event_end_date : end_date)}`);
    if (location !== undefined) sets.push(`location = ${push(location)}`);
    if (organization_id !== undefined) sets.push(`organization_id = ${push(organization_id)}`);
    if (status !== undefined) sets.push(`status = ${push(status)}`);
    if (price !== undefined) sets.push(`price = ${push(price)}`);
    if (image_url !== undefined) sets.push(`image_url = ${push(image_url)}`);
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    await executeQuery(
      `UPDATE events SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    const fetchResult = await executeQuery(
      `SELECT id, title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, created_at, updated_at
       FROM events WHERE id = ? LIMIT 1`,
      [id]
    );
    if (!fetchResult.rows.length) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: fetchResult.rows[0] });
  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Failed to update event', message: error.message });
  }
});

// Delete event
app.delete('/api/admin/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery('DELETE FROM events WHERE id = ?', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (error) {
    if (error.code === '23503') return res.status(409).json({ error: 'Cannot delete event in use' });
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event', message: error.message });
  }
});

// ===== ADMIN FOUND-LOST MODERATION =====
// ===== ADMIN PRACTICAL INFO ENDPOINTS =====
app.get('/api/admin/practical-info', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await executeQuery('SELECT * FROM practical_info ORDER BY sort_order ASC, id ASC');
    res.json({ items: result.rows || [] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get practical info', message: error.message });
  }
});

app.post('/api/admin/practical-info', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, subtitle, icon, content, type, url, sort_order, is_active } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const result = await executeInsert(
      'INSERT INTO practical_info (title, subtitle, icon, content, type, url, sort_order, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, subtitle || null, icon || 'information-circle-outline', content || null, type || 'info', url || null, sort_order || 0, is_active !== false ? 1 : 0]
    );
    res.status(201).json({ success: true, id: result.insertId });
  } catch (error) {
    res.status(500).json({ error: 'Failed to create practical info', message: error.message });
  }
});

app.put('/api/admin/practical-info/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, subtitle, icon, content, type, url, sort_order, is_active } = req.body;
    await executeQuery(
      'UPDATE practical_info SET title = ?, subtitle = ?, icon = ?, content = ?, type = ?, url = ?, sort_order = ?, is_active = ? WHERE id = ?',
      [title, subtitle || null, icon || 'information-circle-outline', content || null, type || 'info', url || null, sort_order || 0, is_active !== false ? 1 : 0, id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update practical info', message: error.message });
  }
});

app.delete('/api/admin/practical-info/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    await executeQuery('DELETE FROM practical_info WHERE id = ?', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete practical info', message: error.message });
  }
});

// ── Content Pages (admin) ────────────────────────────────────
app.get('/api/admin/content-pages', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await executeQuery('SELECT * FROM content_pages ORDER BY slug ASC');
    let pages = result.rows || [];

    // Als er nog geen pagina's zijn, toon in ieder geval de twee standaard-pagina's
    if (!pages || pages.length === 0) {
      pages = [
        {
          slug: 'privacy',
          title: 'Privacybeleid (app)',
          content: '',
          updated_at: null,
        },
        {
          slug: 'terms',
          title: 'Gebruiksvoorwaarden (app)',
          content: '',
          updated_at: null,
        },
      ];
    }

    res.json({ pages });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get content pages', message: error.message });
  }
});

app.put('/api/admin/content-pages/:slug', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { slug } = req.params;
    const { title, content } = req.body;
    if (!title) return res.status(400).json({ error: 'Title is required' });
    const existing = await executeQuery('SELECT id FROM content_pages WHERE slug = ?', [slug]);
    if (existing.rows && existing.rows.length > 0) {
      await executeQuery(
        'UPDATE content_pages SET title = ?, content = ? WHERE slug = ?',
        [title, content || '', slug]
      );
    } else {
      await executeInsert(
        'INSERT INTO content_pages (slug, title, content) VALUES (?, ?, ?)',
        [slug, title, content || '']
      );
    }
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to update content page', message: error.message });
  }
});

// ── Content Pages (public) ───────────────────────────────────
app.get('/api/app/content-pages/:slug', async (req, res) => {
  try {
    const { slug } = req.params;
    const result = await executeQuery('SELECT slug, title, content, updated_at FROM content_pages WHERE slug = ?', [slug]);
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).json({ error: 'Page not found' });
    }
    res.json({ page: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Failed to get content page', message: error.message });
  }
});

// Public HTML pages for store links (Privacy Policy / Terms) – content from backend
function contentPageHtml(slug, title, content) {
  const safeTitle = String(title || slug).replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const body = content || '<p>Geen inhoud.</p>';
  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${safeTitle} – Dorpsapp Holwert</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 0 auto; padding: 24px; line-height: 1.6; color: #1f2937; }
    h1, h2 { color: #1e3a8a; }
    a { color: #1e3a8a; }
  </style>
</head>
<body>
  ${body}
</body>
</html>`;
}
async function serveContentPageHtml(req, res, slug, defaultTitle, errorTitle) {
  try {
    const result = await executeQuery('SELECT slug, title, content FROM content_pages WHERE slug = ?', [slug]);
    if (!result.rows || result.rows.length === 0) {
      res.status(404).set('Content-Type', 'text/html; charset=utf-8').send(contentPageHtml(slug, defaultTitle, '<p>Pagina niet gevonden.</p>'));
      return;
    }
    const { title, content } = result.rows[0];
    res.set('Content-Type', 'text/html; charset=utf-8').send(contentPageHtml(slug, title, content));
  } catch (e) {
    res.status(500).set('Content-Type', 'text/html; charset=utf-8').send(contentPageHtml(slug, errorTitle, '<p>Kon pagina niet laden.</p>'));
  }
}
app.get('/privacy', (req, res) => serveContentPageHtml(req, res, 'privacy', 'Privacybeleid', 'Fout'));
app.get('/terms', (req, res) => serveContentPageHtml(req, res, 'terms', 'Gebruiksvoorwaarden', 'Fout'));
app.get('/api/privacy', (req, res) => serveContentPageHtml(req, res, 'privacy', 'Privacybeleid', 'Fout'));
app.get('/api/terms', (req, res) => serveContentPageHtml(req, res, 'terms', 'Gebruiksvoorwaarden', 'Fout'));

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
    
    // MySQL: gebruik password_hash + insertId i.p.v. RETURNING
    const insertResult = await executeInsert(
      `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [first_name, last_name, email, hashed, role, is_active]
    );
    
    const userId = insertResult.insertId || insertResult.rows?.[0]?.id;
    if (!userId) {
      return res.status(500).json({ error: 'Failed to create user', message: 'No insertId returned' });
    }
    
    const fetchResult = await executeQuery(
      'SELECT id, first_name, last_name, email, role, is_active, created_at, updated_at FROM users WHERE id = $1',
      [userId]
    );
    
    res.status(201).json({ user: fetchResult.rows[0] });
  } catch (error) {
    if (error.code === '23505' || error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user', message: error.message });
  }
});

// Update user (admin)
app.put('/api/admin/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { first_name, last_name, email, password, role, is_active, profile_image_url, relationship_with_holwert, profile_number } = req.body;
    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return `$${params.length}`; };
    if (first_name !== undefined) sets.push(`first_name = ${push(first_name)}`);
    if (last_name !== undefined) sets.push(`last_name = ${push(last_name)}`);
    if (email !== undefined) sets.push(`email = ${push(email)}`);
    if (role !== undefined) sets.push(`role = ${push(role)}`);
    if (is_active !== undefined) sets.push(`is_active = ${push(is_active)}`);
    if (profile_image_url !== undefined) sets.push(`profile_image_url = ${push(profile_image_url)}`);
    if (relationship_with_holwert !== undefined) sets.push(`relationship_with_holwert = ${push(relationship_with_holwert)}`);
    if (profile_number !== undefined) sets.push(`profile_number = ${push(profile_number)}`);
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      sets.push(`password_hash = ${push(hashed)}`);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);
    
    // MySQL: geen RETURNING, dus update + fetch
    await executeQuery(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = $${params.length}`,
      params
    );
    
    const fetchResult = await executeQuery(
      'SELECT id, first_name, last_name, email, profile_image_url, profile_number, relationship_with_holwert, role, is_active, created_at, updated_at FROM users WHERE id = $1',
      [id]
    );
    if (!fetchResult.rows.length) return res.status(404).json({ error: 'User not found' });
    const user = fetchResult.rows[0];
    res.json({
      user: {
        ...user,
        profile_picture: user.profile_image_url || null
      }
    });
  } catch (error) {
    if (error.code === '23505' || error.code === 'ER_DUP_ENTRY' || error.errno === 1062) {
      return res.status(409).json({ error: 'Email already exists' });
    }
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

// Privacy statement per organisatie
app.get('/api/organizations/:id/privacy', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery(
      'SELECT id, name, privacy_statement FROM organizations WHERE id = ? AND is_approved = true', [id]
    );
    if (!result.rows?.length) return res.status(404).json({ error: 'Organisatie niet gevonden' });
    res.json({ organization: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: 'Kon privacybeleid niet ophalen' });
  }
});

// Praktische info (publiek)
app.get('/api/app/practical-info', async (req, res) => {
  try {
    const result = await executeQuery(
      'SELECT id, title, subtitle, icon, content, type, url, sort_order FROM practical_info WHERE is_active = true ORDER BY sort_order ASC, id ASC'
    );
    res.set('Cache-Control', 'public, max-age=60');
    res.json({ items: result.rows || [] });
  } catch (error) {
    res.status(500).json({ error: 'Kon praktische info niet ophalen', items: [] });
  }
});

// Delete own account (AVG/GDPR)
app.delete('/api/auth/account', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.userId;
    const { password } = req.body || {};
    if (!password) {
      return res.status(400).json({ error: 'Wachtwoord is verplicht om je account te verwijderen' });
    }

    const userResult = await executeQuery('SELECT id, password_hash, profile_image_url FROM users WHERE id = ?', [userId]);
    const user = userResult.rows?.[0];
    if (!user) return res.status(404).json({ error: 'Account niet gevonden' });

    const bcrypt = require('bcryptjs');
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Onjuist wachtwoord' });
    }

    // Verwijder alle gerelateerde data
    await executeQuery('DELETE FROM bookmarks WHERE user_id = ?', [userId]).catch(() => {});
    await executeQuery('DELETE FROM follows WHERE user_id = ?', [userId]).catch(() => {});
    await executeQuery('DELETE FROM push_tokens WHERE user_id = ?', [userId]).catch(() => {});
    await executeQuery('DELETE FROM notification_history WHERE user_id = ?', [userId]).catch(() => {});

    // Verwijder profielfoto van server
    if (user.profile_image_url) {
      deleteOldProfileImage(user.profile_image_url).catch(() => {});
    }

    // Verwijder het account
    await executeQuery('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ success: true, message: 'Account succesvol verwijderd' });
  } catch (error) {
    console.error('Delete account error:', error);
    res.status(500).json({ error: 'Kon account niet verwijderen', message: error.message });
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
      category,
      CASE WHEN logo_url IS NOT NULL AND logo_url <> '' THEN true ELSE false END as has_logo
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
    let rows = result.rows || [];

    // Bij minimal: alleen description inkorten; logo_url behouden voor weergave in app
    if (minimal === 'true') {
      rows = rows.map((o) => ({
        ...o,
        description: typeof o.description === 'string' ? o.description.slice(0, 200) : o.description
      }));
    }

    // Get total count (only if not minimal, to save time)
    let total = rows.length;
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

    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      organizations: rows,
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
      password: req.body.password || process.env.DB_PASSWORD || process.env.MYSQL_PASSWORD || '',
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
    // MySQL: Use IN clause instead of ANY, and JSON_EXTRACT for JSON fields
    const placeholders = userIds.map(() => '?').join(',');
    const result = await executeQuery(
      `SELECT pt.id, pt.user_id, pt.token, pt.notification_preferences
       FROM push_tokens pt
       WHERE pt.user_id IN (${placeholders})
       AND pt.is_active = true
       AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(pt.notification_preferences, CONCAT('$.', ?))), 'true') = 'true'`,
      [...userIds, notificationType]
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
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
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
    await ensureFollowsTable();
    const followersResult = await executeQuery(
      'SELECT user_id FROM follows WHERE organization_id = ?',
      [organizationId]
    );
    
    if (followersResult.rows.length === 0) {
      console.log(`⚠️ No followers found for organization ${organizationId}`);
      return;
    }
    
    let userIds = followersResult.rows.map(row => row.user_id);
    const placeholdersMute = userIds.map(() => '?').join(',');
    const mutedResult = await executeQuery(
      `SELECT user_id FROM push_notification_mutes WHERE organization_id = ? AND user_id IN (${placeholdersMute})`,
      [organizationId, ...userIds]
    );
    const mutedSet = new Set((mutedResult.rows || []).map(r => r.user_id));
    userIds = userIds.filter(id => !mutedSet.has(id));
    if (mutedSet.size) {
      console.log(`📢 Excluding ${mutedSet.size} user(s) who muted org ${organizationId}`);
    }
    if (userIds.length === 0) {
      console.log(`⚠️ No users to notify after applying mutes for organization ${organizationId}`);
      return;
    }
    console.log(`📢 Notifying ${userIds.length} follower(s) of organization ${organizationId}`);
    return await sendNotificationToUsers(userIds, notification, notificationType);
  } catch (error) {
    console.error('❌ Error sending notification to followers:', error.message);
    return { success: false, error: error.message };
  }
}

// Ensure profile_image_url column exists in users table
async function ensurePrivacyStatementColumn() {
  try {
    const result = await executeQuery(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'organizations' AND COLUMN_NAME = 'privacy_statement'"
    );
    if (result.rows && result.rows.length > 0) return;
    await executeQuery('ALTER TABLE organizations ADD COLUMN privacy_statement TEXT NULL');
    console.log('privacy_statement kolom toegevoegd aan organizations');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || (e.message && e.message.includes('Duplicate'))) return;
    console.error('ensurePrivacyStatementColumn error:', e.message);
  }
}

async function ensurePracticalInfoTable() {
  try {
    await executeQuery(`CREATE TABLE IF NOT EXISTS practical_info (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(255) NOT NULL,
      subtitle VARCHAR(255),
      icon VARCHAR(50) DEFAULT 'information-circle-outline',
      content TEXT,
      type ENUM('info','schedule','link','phone') DEFAULT 'info',
      url VARCHAR(500),
      sort_order INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    console.error('ensurePracticalInfoTable error:', e.message);
  }
}

async function ensureContentPagesTable() {
  try {
    await executeQuery(`CREATE TABLE IF NOT EXISTS content_pages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      slug VARCHAR(100) NOT NULL UNIQUE,
      title VARCHAR(255) NOT NULL,
      content LONGTEXT,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    // Seed default pages if they don't exist
    const existing = await executeQuery('SELECT slug FROM content_pages');
    const slugs = (existing.rows || []).map(r => r.slug);
    if (!slugs.includes('privacy')) {
      await executeInsert(
        "INSERT INTO content_pages (slug, title, content) VALUES (?, ?, ?)",
        ['privacy', 'Privacybeleid', '<h2>Privacybeleid Dorpsbelang Holwert</h2><p>Dit privacybeleid wordt binnenkort aangevuld.</p>']
      );
    }
    if (!slugs.includes('terms')) {
      await executeInsert(
        "INSERT INTO content_pages (slug, title, content) VALUES (?, ?, ?)",
        ['terms', 'Gebruiksvoorwaarden', '<h2>Gebruiksvoorwaarden Dorpsapp Holwert</h2><p>Deze voorwaarden worden binnenkort aangevuld.</p>']
      );
    }
  } catch (e) {
    console.error('ensureContentPagesTable error:', e.message);
  }
}

async function ensureProfileImageUrlColumn() {
  try {
    const result = await executeQuery(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_image_url'"
    );
    if (result.rows && result.rows.length > 0) {
      return;
    }
    await executeQuery('ALTER TABLE users ADD COLUMN profile_image_url TEXT NULL AFTER last_name');
    console.log('✅ profile_image_url kolom toegevoegd aan users');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || (e.message && e.message.includes('Duplicate'))) return;
    console.error('ensureProfileImageUrlColumn error:', e.message);
  }
}

async function ensureProfileNumberColumn() {
  try {
    const result = await executeQuery(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'profile_number'"
    );
    if (result.rows && result.rows.length > 0) {
      return;
    }
    await executeQuery('ALTER TABLE users ADD COLUMN profile_number VARCHAR(10) NULL AFTER profile_image_url');
    await executeQuery("UPDATE users SET profile_number = LPAD(id, 4, '0') WHERE profile_number IS NULL");
    console.log('✅ profile_number kolom toegevoegd en backfill voltooid');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || (e.message && e.message.includes('Duplicate'))) return;
    console.error('ensureProfileNumberColumn error:', e.message);
  }
}

async function ensureHolwertRelationshipColumn() {
  try {
    const result = await executeQuery(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'relationship_with_holwert'"
    );
    if (result.rows && result.rows.length > 0) {
      return;
    }
    await executeQuery("ALTER TABLE users ADD COLUMN relationship_with_holwert VARCHAR(50) NULL");
    console.log('✅ relationship_with_holwert kolom toegevoegd aan users');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || (e.message && e.message.includes('Duplicate'))) return;
    console.error('ensureHolwertRelationshipColumn error:', e.message);
  }
}

// Initialize push notifications tables
async function initializePushNotificationsTables() {
  try {
    console.log('📦 Initializing push notifications tables...');
    
    // Create push_tokens table (MySQL syntax)
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS push_tokens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT,
        token VARCHAR(255) UNIQUE NOT NULL,
        device_type VARCHAR(50),
        device_name VARCHAR(255),
        notification_preferences JSON DEFAULT ('{
          "news": true,
          "agenda": true,
          "organizations": true,
          "weather": true
        }'),
        is_active BOOLEAN DEFAULT true,
        last_used_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_push_tokens_user_id (user_id),
        INDEX idx_push_tokens_token (token),
        INDEX idx_push_tokens_active (is_active)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    // Create notification_history table (MySQL syntax)
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS notification_history (
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
        delivered_at TIMESTAMP NULL,
        INDEX idx_notification_history_user_id (user_id),
        INDEX idx_notification_history_type (notification_type),
        INDEX idx_notification_history_sent_at (sent_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS push_notification_mutes (
        user_id INT NOT NULL,
        organization_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, organization_id),
        INDEX idx_mutes_org (organization_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    
    console.log('✅ Push notifications tables initialized');
  } catch (error) {
    console.error('❌ Error initializing push notifications tables:', error.message);
  }
}





// Lokale dev: listen
if (process.env.NODE_ENV !== 'production' || !process.env.VERCEL) {
  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

module.exports = app;
