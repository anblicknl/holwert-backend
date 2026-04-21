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
const crypto = require('crypto');
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

/** Optioneel: Personal Access Token van expo.dev/settings/access-tokens als Bearer op de push-API. Vereist als enhanced push security aan staat. */
const EXPO_PUSH_ACCESS_TOKEN = (process.env.EXPO_PUSH_ACCESS_TOKEN || '').trim();

// PHP Proxy URL (fallback als direct MySQL niet werkt)
const PHP_PROXY_URL = process.env.PHP_PROXY_URL || 'https://holwert.appenvloed.com/admin/db-proxy.php';
const PHP_PROXY_API_KEY = process.env.PHP_PROXY_API_KEY || 'holwert-db-proxy-2026-secure-key-change-in-production';

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

// Rate limiter voor publieke organisatie-registratie (max 5 per 15 min per IP)
const orgRegisterAttempts = new Map();
const ORG_REGISTER_WINDOW_MS = 15 * 60 * 1000;
const ORG_REGISTER_MAX = 5;
function orgRegisterRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const existing = orgRegisterAttempts.get(ip) || { count: 0, first: now };
  if (now - existing.first > ORG_REGISTER_WINDOW_MS) {
    existing.count = 0;
    existing.first = now;
  }
  existing.count += 1;
  orgRegisterAttempts.set(ip, existing);
  if (existing.count > ORG_REGISTER_MAX) {
    return res.status(429).json({
      error: 'Te veel registraties. Probeer het later opnieuw.',
      retry_after_seconds: Math.ceil((ORG_REGISTER_WINDOW_MS - (now - existing.first)) / 1000)
    });
  }
  return next();
}

// Rate limiter: logo-upload bij publieke org-aanmelding (los van registratie-teller)
const orgRegLogoAttempts = new Map();
const ORG_REG_LOGO_WINDOW_MS = 15 * 60 * 1000;
const ORG_REG_LOGO_MAX = 25;
function orgRegisterLogoRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const existing = orgRegLogoAttempts.get(ip) || { count: 0, first: now };
  if (now - existing.first > ORG_REG_LOGO_WINDOW_MS) {
    existing.count = 0;
    existing.first = now;
  }
  existing.count += 1;
  orgRegLogoAttempts.set(ip, existing);
  if (existing.count > ORG_REG_LOGO_MAX) {
    return res.status(429).json({
      error: 'Te veel uploads. Probeer het later opnieuw.',
      retry_after_seconds: Math.ceil((ORG_REG_LOGO_WINDOW_MS - (now - existing.first)) / 1000),
    });
  }
  return next();
}

// Wachtwoord vergeten (organisatie-dashboard)
const orgForgotPasswordAttempts = new Map();
const ORG_FORGOT_WINDOW_MS = 15 * 60 * 1000;
const ORG_FORGOT_MAX = 8;
function orgForgotPasswordRateLimiter(req, res, next) {
  const ip = getClientIp(req);
  const now = Date.now();
  const existing = orgForgotPasswordAttempts.get(ip) || { count: 0, first: now };
  if (now - existing.first > ORG_FORGOT_WINDOW_MS) {
    existing.count = 0;
    existing.first = now;
  }
  existing.count += 1;
  orgForgotPasswordAttempts.set(ip, existing);
  if (existing.count > ORG_FORGOT_MAX) {
    return res.status(429).json({
      error: 'Te veel aanvragen. Probeer het later opnieuw.',
      retry_after_seconds: Math.ceil((ORG_FORGOT_WINDOW_MS - (now - existing.first)) / 1000),
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
  for (const [ip, data] of orgForgotPasswordAttempts.entries()) {
    if (now - data.first > ORG_FORGOT_WINDOW_MS) {
      orgForgotPasswordAttempts.delete(ip);
    }
  }
}, LOGIN_WINDOW_MS);

// ===== Middleware =====
app.use(compression()); // Compress responses for faster transfer
app.use(cors({
  origin: [
    'https://holwert.appenvloed.com',
    'https://holwert-backend.vercel.app',
    /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/,
    /^https:\/\/holwert-backend-[a-z0-9-]+\.vercel\.app$/,
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
        await ensureUsersPhoneColumn();
        await ensurePrivacyStatementColumn();
        await ensurePracticalInfoTable();
        await ensureContentPagesTable();
        await ensureAfvalkalenderTable();
        await initializePushNotificationsTables();
        await ensureOrgPasswordResetsTable();
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
    if (error.response) {
      const status = error.response.status;
      const data = error.response.data;
      console.error('[PHP Proxy] Response status:', status);
      console.error('[PHP Proxy] Response data:', typeof data === 'string' ? data.substring(0, 500) : JSON.stringify(data));
      const proxyMsg = (data && typeof data === 'object')
        ? (data.message || data.error)
        : (typeof data === 'string' ? data.substring(0, 300) : null);
      const msgStr = proxyMsg || `HTTP ${status} van db-proxy.php`;
      const err = new Error(msgStr);
      if (data && typeof data === 'object') err.code = data.code;
      err.originalError = error;
      throw err;
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

/**
 * Browser datetime-local en ISO-strings naar MySQL DATETIME ('YYYY-MM-DD HH:MM:SS').
 * Zonder dit geeft o.a. `2026-04-12T20:00` vaak ER_WRONG_VALUE / Incorrect datetime value.
 */
function toMysqlDateTime(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const d = value;
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  const s0 = String(value).trim();
  const s = s0.replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return `${s}:00`;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return `${s} 00:00:00`;
  const t = Date.parse(s0);
  if (!Number.isNaN(t)) {
    const d = new Date(t);
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
  return null;
}

function normalizeEventPrice(value) {
  if (value === undefined || value === null || value === '') return null;
  const n = typeof value === 'number' ? value : parseFloat(String(value).replace(',', '.'));
  if (Number.isNaN(n)) return null;
  return n;
}

/** MySQL TEXT ≈ 64KB; te lange image_url (vaak base64) geeft ER_DATA_TOO_LONG → 500 bij opslaan. */
function sanitizeEventImageUrlForDb(url) {
  if (url == null || url === '') return null;
  const s = String(url).trim();
  if (s.length === 0) return null;
  const bytes = Buffer.byteLength(s, 'utf8');
  if (bytes > 65000) {
    console.warn('[events] image_url te groot voor TEXT-kolom (bytes=' + bytes + '), wordt genegeerd');
    return null;
  }
  return s;
}

function isMysqlMissingColumnError(err) {
  if (!err) return false;
  if (err.code === 'ER_BAD_FIELD_ERROR' || err.errno === 1054) return true;
  const m = err.message || err.sqlMessage || '';
  return typeof m === 'string' && m.includes('Unknown column');
}

function isMysqlDataTooLongError(err) {
  if (!err) return false;
  if (err.code === 'ER_DATA_TOO_LONG' || err.errno === 1406) return true;
  const m = err.message || err.sqlMessage || '';
  return typeof m === 'string' && (m.includes('Data too long') || m.includes('too long for column'));
}

/**
 * Extra WHERE voor publieke event-routes. Leeg bewust: goedkeuring van organisaties geldt voor
 * de organisatielijst in de app, niet voor agenda-items — anders verdwijnen alle events van een
 * nog-niet-goedgekeurde org (bv. "The Sound") terwijl ze wél in het org-dashboard staan.
 */
function sqlPublicEventVisibility(_eAlias = 'e', _oAlias = 'o') {
  return '';
}

/**
 * Komende / nog lopende evenementen (serverdatum).
 * Niet: COALESCE(eind, start) — als eind vóór start staat of fout in het verleden zit,
 * verdween het hele item uit de app terwijl het wél in het org-dashboard stond.
 * GREATEST(start, COALESCE(eind, start)) gebruikt effectief het laatst relevante moment.
 */
function sqlEventUpcomingCutoff(eAlias = 'e') {
  return ` AND GREATEST(${eAlias}.event_date, COALESCE(${eAlias}.event_end_date, ${eAlias}.event_date)) >= CURDATE()`;
}

/** Lijst-response klein houden: base64 in logo/image maakt JSON megabytes → app timeout (30s). Detailroute levert volledige velden. */
function stripHeavyMediaFromEventRow(row) {
  if (!row || typeof row !== 'object') return row;
  const out = { ...row };
  if (typeof out.organization_logo === 'string') {
    if (out.organization_logo.startsWith('data:image/') || out.organization_logo.length > 2048) {
      out.organization_logo = null;
    }
  }
  if (typeof out.image_url === 'string' && out.image_url.startsWith('data:image/')) {
    out.image_url = null;
  }
  if (typeof out.description === 'string' && out.description.length > 6000) {
    out.description = `${out.description.slice(0, 6000)}…`;
  }
  return out;
}

/** Zorg dat de app altijd `event_end_date` krijgt (proxy/legacy-sleutels). */
function normalizePublicEventRow(row) {
  if (!row || typeof row !== 'object') return row;
  const e = stripHeavyMediaFromEventRow(row);
  const end =
    e.event_end_date ??
    e.end_date ??
    e.EVENT_END_DATE ??
    e.eventEndDate;
  if (end != null && String(end).trim() !== '') {
    e.event_end_date = String(end).trim();
  }
  return e;
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
        { expiresIn: '30d' }
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
        { expiresIn: '30d' }
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

// ===== WEATHER PROXY (OpenWeather achter backend; API-key niet in app) =====
const HOLWERT_LAT = 53.368;
const HOLWERT_LON = 5.968;
const WEATHER_CACHE_TTL = 10 * 60 * 1000; // 10 min
let weatherCache = { current: null, forecast: null, expires: 0 };

app.get('/api/weather/current', async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Weer niet beschikbaar', message: 'OpenWeather API key niet geconfigureerd' });
    }
    const cacheKey = 'weather:current';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const url = `https://api.openweathermap.org/data/2.5/weather?lat=${HOLWERT_LAT}&lon=${HOLWERT_LON}&units=metric&lang=nl&appid=${apiKey}`;
    const response = await axios.get(url, { timeout: 10000 });
    const d = response.data;
    const data = {
      temperature: d.main?.temp ?? 0,
      feels_like: d.main?.feels_like ?? d.main?.temp ?? 0,
      description: d.weather?.[0]?.description ?? 'Onbekend',
      icon: d.weather?.[0]?.icon ?? '01d',
      humidity: d.main?.humidity ?? 0,
      wind_speed: ((d.wind?.speed ?? 0) * 3.6),
      sunrise: d.sys?.sunrise ?? null,
      sunset: d.sys?.sunset ?? null,
    };
    setCache(cacheKey, data, WEATHER_CACHE_TTL);
    res.json(data);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || 'Weer kon niet worden geladen';
    const status = error.response?.status === 401 ? 502 : 502;
    res.status(status).json({ error: 'Weer niet beschikbaar', message: msg });
  }
});

app.get('/api/weather/forecast', async (req, res) => {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) {
      return res.status(503).json({ error: 'Weer niet beschikbaar', message: 'OpenWeather API key niet geconfigureerd' });
    }
    const cacheKey = 'weather:forecast';
    const cached = getCached(cacheKey);
    if (cached) return res.json(cached);

    const [currentRes, forecastRes] = await Promise.all([
      axios.get(`https://api.openweathermap.org/data/2.5/weather?lat=${HOLWERT_LAT}&lon=${HOLWERT_LON}&units=metric&lang=nl&appid=${apiKey}`, { timeout: 10000 }),
      axios.get(`https://api.openweathermap.org/data/2.5/forecast?lat=${HOLWERT_LAT}&lon=${HOLWERT_LON}&units=metric&lang=nl&appid=${apiKey}`, { timeout: 10000 }),
    ]);
    const currentData = currentRes.data;
    const forecastData = forecastRes.data;

    const current = {
      temperature: currentData.main?.temp ?? 0,
      feels_like: currentData.main?.feels_like ?? currentData.main?.temp ?? 0,
      description: currentData.weather?.[0]?.description ?? 'Onbekend',
      icon: currentData.weather?.[0]?.icon ?? '01d',
      humidity: currentData.main?.humidity ?? 0,
      wind_speed: ((currentData.wind?.speed ?? 0) * 3.6),
      sunrise: currentData.sys?.sunrise ?? null,
      sunset: currentData.sys?.sunset ?? null,
    };

    const list = forecastData.list || [];
    const hourly = list.slice(0, 8).map((h) => ({
      dt: h.dt,
      temperature: h.main?.temp ?? 0,
      icon: h.weather?.[0]?.icon ?? '01d',
      description: h.weather?.[0]?.description ?? '',
      pop: h.pop != null ? Math.round(h.pop * 100) : null,
    }));

    const dailyMap = new Map();
    list.forEach((item) => {
      const dateKey = new Date(item.dt * 1000).toISOString().split('T')[0];
      if (!dailyMap.has(dateKey)) dailyMap.set(dateKey, []);
      dailyMap.get(dateKey).push(item);
    });
    const daily = Array.from(dailyMap.entries()).slice(0, 7).map(([dateKey, items]) => {
      const temps = items.map((i) => i.main?.temp ?? 0);
      const pops = items.map((i) => i.pop != null ? i.pop * 100 : 0);
      const avgPop = pops.length ? Math.round(pops.reduce((a, b) => a + b, 0) / pops.length) : null;
      const iconCounts = new Map();
      items.forEach((i) => {
        const icon = i.weather?.[0]?.icon ?? '01d';
        iconCounts.set(icon, (iconCounts.get(icon) || 0) + 1);
      });
      const mostCommon = Array.from(iconCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '01d';
      const mid = items[Math.floor(items.length / 2)];
      return {
        dt: new Date(dateKey).getTime() / 1000,
        temp_min: Math.min(...temps),
        temp_max: Math.max(...temps),
        icon: mostCommon,
        description: mid?.weather?.[0]?.description ?? '',
        pop: avgPop,
      };
    });

    const data = { current, hourly, daily, sunrise: current.sunrise, sunset: current.sunset };
    setCache(cacheKey, data, WEATHER_CACHE_TTL);
    res.json(data);
  } catch (error) {
    const msg = error.response?.data?.message || error.message || 'Weer kon niet worden geladen';
    res.status(502).json({ error: 'Weer niet beschikbaar', message: msg });
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

// Admin-rollen (JWT kan ontbreken of afwijken van DB na handmatige fixes)
const ELEVATED_ADMIN_ROLES = new Set(['admin', 'superadmin', 'editor']);

function normalizeAdminRole(roleRaw) {
  if (roleRaw == null) return '';
  const s = String(roleRaw).trim().toLowerCase();
  if (!s || s === 'null' || s === 'undefined') return '';
  return s;
}

/** Async: valideert JWT-rol, zo niet aanwezig of geweigerd dan rol uit database (zelfde userId). */
const requireAdmin = async (req, res, next) => {
  try {
    const jwtRole = normalizeAdminRole(req.user && req.user.role);
    if (jwtRole && ELEVATED_ADMIN_ROLES.has(jwtRole)) {
      return next();
    }
    const userId = req.user && req.user.userId;
    if (userId == null) {
      return res.status(403).json({
        error: 'Admin privileges required',
        message: 'Token mist gebruikers-id. Log opnieuw in.'
      });
    }
    const r = await executeQuery('SELECT role FROM users WHERE id = ?', [userId]);
    const dbRole = normalizeAdminRole(r.rows?.[0]?.role);
    if (dbRole && ELEVATED_ADMIN_ROLES.has(dbRole)) {
      return next();
    }
    return res.status(403).json({
      error: 'Admin privileges required',
      message:
        'Geen beheerdersrechten (admin, superadmin of editor). Controleer in de database het veld `role` voor jouw account, of log uit en opnieuw in.',
      jwtRole: req.user && req.user.role != null ? req.user.role : null,
      dbRole: r.rows?.[0]?.role != null ? r.rows[0].role : null
    });
  } catch (err) {
    console.error('requireAdmin:', err);
    return res.status(500).json({ error: 'Auth check failed', message: err.message });
  }
};

// Organisatie-portal: JWT moet organizationId hebben. Zonder org-koppeling: beheerders naar /admin sturen.
// Met organizationId: altijd toestaan (ook editor) – veel org-accounts hebben rol "editor".
const requireOrgPortal = (req, res, next) => {
  const orgId = req.user && (req.user.organizationId ?? req.user.organization_id);
  const jwtRole = normalizeAdminRole(req.user && req.user.role);

  if (!orgId) {
    if (jwtRole && ELEVATED_ADMIN_ROLES.has(jwtRole)) {
      return res.status(403).json({
        error: 'Verkeerd portaal',
        message:
          'Log in op het beheerderspaneel (/admin). Dit portaal is alleen voor accounts die aan één organisatie zijn gekoppeld.',
      });
    }
    return res.status(403).json({
      error: 'Geen organisatie gekoppeld aan dit account. Neem contact op met de beheerder.',
    });
  }

  req.organizationId = parseInt(orgId, 10);
  if (isNaN(req.organizationId)) return res.status(403).json({ error: 'Ongeldige organisatie' });
  next();
};

/**
 * CDN-uploadmap: dashboard-gebruiker (JWT.organizationId) → altijd die org, `organizationId` uit body wordt genegeerd.
 * Admin zonder org in JWT mag body.organizationId meegeven; anders 00.
 */
function resolveUploadOrganizationIdForRequest(req, clientOrganizationId) {
  const jwtRaw = req.user && (req.user.organizationId ?? req.user.organization_id);
  if (jwtRaw != null && jwtRaw !== '') {
    const n = parseInt(jwtRaw, 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  if (clientOrganizationId != null && clientOrganizationId !== '') {
    const c = parseInt(clientOrganizationId, 10);
    if (!Number.isNaN(c) && c > 0) return c;
  }
  return null;
}

function folderSegmentForOrgUpload(orgIdNum) {
  if (orgIdNum == null || !Number.isFinite(orgIdNum) || orgIdNum < 1) return '00';
  return String(Math.floor(orgIdNum)).padStart(2, '0');
}

/** Upload afbeelding naar holwert.appenvloed.com/upload (org-submap: twee cijfers, bv. 07 of 00). */
async function uploadImageBufferToSharedHosting(buffer, originalname, mimetype, orgFolderTwoDigits) {
  const form = new FormData();
  form.append('file', buffer, {
    filename: originalname || 'image.jpg',
    contentType: mimetype || 'image/jpeg',
  });
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const seg = typeof orgFolderTwoDigits === 'string' && /^[0-9]{2}$/.test(orgFolderTwoDigits)
    ? orgFolderTwoDigits
    : '00';
  form.append('folder', `uploads/${year}/${month}/${seg}/`);

  let uploadResponse;
  try {
    uploadResponse = await axios.post('https://holwert.appenvloed.com/upload/upload.php', form, {
      headers: {
        ...form.getHeaders(),
        'User-Agent': 'HolwertBackend/1.0',
        'Origin': 'https://holwert.appenvloed.com',
        'Referer': 'https://holwert.appenvloed.com/',
      },
      timeout: 30000,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      httpsAgent: new https.Agent({ rejectUnauthorized: false }),
    });
  } catch (axErr) {
    const status = axErr.response?.status ?? 'geen status';
    const body = axErr.response?.data;
    const bodyStr = typeof body === 'string' ? body.substring(0, 500) : JSON.stringify(body ?? '');
    console.error('[upload.php] HTTP-fout:', status, bodyStr);
    throw new Error(`upload.php gaf HTTP ${status} terug: ${bodyStr}`);
  }

  if (!uploadResponse.data || !uploadResponse.data.success) {
    const msg = (uploadResponse.data && uploadResponse.data.message) || JSON.stringify(uploadResponse.data);
    console.error('[upload.php] success=false:', msg);
    throw new Error(`Upload mislukt: ${msg}`);
  }
  const rawUrl = uploadResponse.data.url;
  if (!rawUrl || typeof rawUrl !== 'string') {
    throw new Error('Geen URL van upload-server');
  }
  return rawUrl.replace('http://', 'https://');
}

// Publieke logo-upload voor organisatie-aanmelding (geen account); bestanden in map 00 tot org bestaat.
app.post(
  '/api/organizations/register-logo',
  orgRegisterLogoRateLimiter,
  (req, res, next) => {
    upload.single('image')(req, res, (err) => {
      if (err) {
        if (err.code === 'LIMIT_FILE_SIZE') {
          return res.status(400).json({ error: 'Bestand te groot', message: 'Maximaal 10 MB.' });
        }
        return res.status(400).json({
          error: 'Ongeldig bestand',
          message: err.message || String(err),
        });
      }
      next();
    });
  },
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({
          error: 'Geen afbeelding',
          message: 'Stuur een bestand met veldnaam "image" (multipart/form-data).',
        });
      }
      const imageUrl = await uploadImageBufferToSharedHosting(
        req.file.buffer,
        req.file.originalname,
        req.file.mimetype,
        '00',
      );
      console.log('[POST /api/organizations/register-logo] OK:', imageUrl);
      res.json({
        success: true,
        url: imageUrl,
        imageUrl: imageUrl,
        message: 'Logo geüpload.',
      });
    } catch (error) {
      console.error('[POST /api/organizations/register-logo]', error);
      res.status(500).json({
        error: 'Upload mislukt',
        message: error.message,
      });
    }
  },
);

// ===== FIXED IMAGE UPLOAD TO EXTERNAL SERVER =====
app.post('/api/upload', authenticateToken, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image provided' });
    }

    console.log('Uploading to external server:', {
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
    });

    const resolvedOrg = resolveUploadOrganizationIdForRequest(req, req.body && req.body.organizationId);
    const orgFolder = folderSegmentForOrgUpload(resolvedOrg);
    const imageUrl = await uploadImageBufferToSharedHosting(
      req.file.buffer,
      req.file.originalname,
      req.file.mimetype,
      orgFolder,
    );
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
        thumbnail: { url: imageUrl },
      }),
      sizes: {
        original: { url: imageUrl },
        full: { url: imageUrl },
        large: { url: imageUrl },
        medium_large: { url: imageUrl },
        medium: { url: imageUrl },
        thumbnail: { url: imageUrl },
      },
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({
      error: 'Failed to upload image',
      message: error.message,
      details: error.response?.data || error.toString(),
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
    if (base64Data.length > 14 * 1024 * 1024) {
      return res.status(400).json({ error: 'Afbeelding te groot', message: 'Maximaal ongeveer 10 MB na base64.' });
    }
    let buffer;
    try {
      buffer = Buffer.from(base64Data, 'base64');
    } catch (e) {
      return res.status(400).json({ error: 'Ongeldige afbeeldingsdata' });
    }
    if (!buffer.length || buffer.length > 12 * 1024 * 1024) {
      return res.status(400).json({ error: 'Afbeelding te groot of leeg' });
    }

    const uniqueFilename = filename || `image-${Date.now()}-${Math.round(Math.random() * 1E9)}.jpg`;
    const resolvedOrg = resolveUploadOrganizationIdForRequest(req, organizationId);
    const orgFolder = folderSegmentForOrgUpload(resolvedOrg);
    const imageUrl = await uploadImageBufferToSharedHosting(
      buffer,
      uniqueFilename,
      'image/jpeg',
      orgFolder,
    );

    res.json({
      message: 'Image uploaded successfully to external server (for editing)',
      imageUrl: imageUrl,
      filename: uniqueFilename,
      note: 'Uploaded to external server - high quality maintained',
    });

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
        n.image_url, n.youtube_url, n.source_name, n.source_url, n.created_at, n.updated_at,
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

// ── Lazy migratie voor extra news-kolommen ──────────────────────────────────
// Draait één keer per server-instantie. Vangt foutcode 1060 (kolom bestaat al)
// af zodat het veilig is om bij elke cold start opnieuw te draaien.
let _newsColsMigrated = false;
async function ensureNewsColumns() {
  if (_newsColsMigrated) return;
  const cols = [
    ['youtube_url', 'VARCHAR(500)'],
    ['source_name', 'VARCHAR(255)'],
    ['source_url',  'VARCHAR(500)'],
  ];
  for (const [col, def] of cols) {
    try {
      await executeQuery(`ALTER TABLE news ADD COLUMN ${col} ${def}`);
      console.log(`[ensureNewsColumns] news.${col} toegevoegd`);
    } catch (e) {
      if (!String(e.message).includes('Duplicate column') && !String(e.message).includes('1060')) {
        console.warn(`[ensureNewsColumns] news.${col}:`, e.message);
      }
    }
  }
  _newsColsMigrated = true;
}

let _orgColsMigrated = false;
async function ensureOrgColumns() {
  if (_orgColsMigrated) return;
  try {
    await executeQuery(`ALTER TABLE organizations ADD COLUMN show_email BOOLEAN DEFAULT true`);
    console.log('[ensureOrgColumns] organizations.show_email toegevoegd');
  } catch (e) {
    if (!String(e.message).includes('Duplicate column') && !String(e.message).includes('1060')) {
      console.warn('[ensureOrgColumns] show_email:', e.message);
    }
  }
  _orgColsMigrated = true;
}
// ─────────────────────────────────────────────────────────────────────────────

// Get all published news (public, with optional bookmark status if authenticated)
app.get('/api/news', async (req, res) => {
  try {
    await ensureNewsColumns();
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
        n.image_url, n.youtube_url, n.source_name, n.source_url,
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
      query += ` AND (n.title LIKE ? OR n.excerpt LIKE ? OR n.content LIKE ? OR o.name LIKE ?)`;
      params.push(s, s, s, s);
    }
    
    // Sorteer op published_at (publicatiedatum), fallback naar created_at als published_at NULL is
    query += ` ORDER BY COALESCE(n.published_at, n.created_at) DESC LIMIT ? OFFSET ?`;
    params.push(limitValue, offset);

    // Count query (voor pagination)
    const countParams = [];
    let countQuery = `SELECT COUNT(*) as total FROM news n LEFT JOIN organizations o ON n.organization_id = o.id WHERE n.is_published = true`;
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
      countQuery += ` AND (n.title LIKE ? OR n.excerpt LIKE ? OR n.content LIKE ? OR o.name LIKE ?)`;
      countParams.push(s, s, s, s);
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
        user_id INT NOT NULL,
        news_id INT NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id, news_id),
        INDEX idx_bookmarks_user (user_id),
        INDEX idx_bookmarks_news (news_id)
      )
    `);
  } catch (e) {
    console.error('ensureBookmarksTable error:', e);
  }
}

// Alleen de expliciete proxy-weigering (niet elke fout waarin "bookmarks" voorkomt, bv. "table doesn't exist")
function isBookmarksTableDisallowed(error) {
  const msg = (error?.message || '') + (error?.response?.data?.message || '');
  return /disallowed table/i.test(msg);
}

// Fast bookmark count for profile stats
app.get('/api/app/bookmarks/count', authenticateToken, async (req, res) => {
  try {
    await ensureBookmarksTable();
    const userId = req.user.userId;
    const result = await executeQuery('SELECT COUNT(*) as count FROM bookmarks WHERE user_id = ?', [userId]);
    res.json({ count: result.rows?.[0]?.count ?? 0 });
  } catch (error) {
    if (isBookmarksTableDisallowed(error)) {
      console.warn('Bookmarks: tabel niet toegestaan in proxy – voeg bookmarks toe aan whitelist (zie docs/DB_PROXY_PUSH_MUTES.md)');
    }
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
    if (isBookmarksTableDisallowed(error)) {
      console.warn('Bookmarks: tabel niet toegestaan in proxy');
      return res.status(503).json({
        error: 'Bookmarks temporarily unavailable',
        message: 'Database-configuratie: voeg tabel "bookmarks" toe aan de proxy-whitelist. Zie docs/DB_PROXY_PUSH_MUTES.md'
      });
    }
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
    res.json({ bookmarked: (result.rows && result.rows.length > 0) });
  } catch (error) {
    if (isBookmarksTableDisallowed(error)) {
      return res.json({ bookmarked: false });
    }
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
    if (isBookmarksTableDisallowed(error)) {
      console.warn('Bookmarks: tabel niet toegestaan in proxy – voeg bookmarks toe aan whitelist');
      return res.status(503).json({
        error: 'Bookmarks temporarily unavailable',
        message: 'Opslaan werkt nog niet: tabel "bookmarks" moet in de database-proxy whitelist. Zie docs/DB_PROXY_PUSH_MUTES.md'
      });
    }
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
    if (isBookmarksTableDisallowed(error)) {
      console.warn('Bookmarks: tabel niet toegestaan in proxy');
      return res.status(503).json({
        error: 'Bookmarks temporarily unavailable',
        message: 'Database-configuratie: voeg tabel "bookmarks" toe aan de proxy-whitelist.'
      });
    }
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

// Followers count for a given organization (public) – telt unieke gebruikers (geen dubbele rijen)
app.get('/api/organizations/:id/followers/count', async (req, res) => {
  try {
    await ensureFollowsTable();
    const orgId = parseInt(req.params.id);
    const result = await executeQueryViaProxy(
      `SELECT COUNT(DISTINCT user_id) AS count FROM follows WHERE organization_id = ?`,
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

// Helper: of de fout komt doordat de proxy tabel push_notification_mutes niet toestaat
function isPushMutesTableDisallowed(error) {
  const msg = (error?.message || '') + (error?.response?.data?.message || '');
  return /disallowed table|push_notification_mutes/i.test(msg);
}

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
    if (isPushMutesTableDisallowed(error)) {
      console.warn('Push mute: tabel push_notification_mutes niet toegestaan in proxy – voeg toe aan whitelist (zie docs/DB_PROXY_PUSH_MUTES.md)');
      return res.json({ success: true, muted: true }); // voorkom 500 in app
    }
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
    if (isPushMutesTableDisallowed(error)) {
      console.warn('Push unmute: tabel push_notification_mutes niet toegestaan in proxy');
      return res.json({ success: true, muted: false });
    }
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
    if (isPushMutesTableDisallowed(error)) {
      console.warn('Push muted-organizations: tabel push_notification_mutes niet toegestaan in proxy – voeg toe aan whitelist (zie docs/DB_PROXY_PUSH_MUTES.md)');
    } else {
      console.warn('Get muted organizations error (returning empty list):', error?.message || error);
    }
    // Altijd 200 + lege lijst bij fout, zodat organisatiepagina gewoon werkt
    return res.json({ muted_organization_ids: [] });
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
    await ensureNewsColumns();
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
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt,
             n.image_url, n.youtube_url, n.source_name, n.source_url,
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

// Public share page for a single news article with Open Graph meta tags
app.get('/news/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery(
      `SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url,
              COALESCE(n.published_at, n.created_at) as published_at
       FROM news n
       WHERE n.id = ? AND n.is_published = true
       LIMIT 1`,
      [id]
    );
    if (!result.rows || result.rows.length === 0) {
      return res.status(404).set('Content-Type', 'text/html; charset=utf-8').send('<!doctype html><html><head><meta charset="utf-8"><title>Bericht niet gevonden</title></head><body><h1>Bericht niet gevonden</h1><p>Dit nieuwsbericht bestaat niet (meer).</p></body></html>');
    }
    const article = result.rows[0];
    const title = article.title || 'Nieuws uit Holwert';
    const description =
      article.excerpt ||
      (article.content ? String(article.content).replace(/<[^>]+>/g, '').slice(0, 200) : 'Nieuws uit Holwert.');
    const image = article.image_url || '';
    const url = `${req.protocol}://${req.get('host')}${req.originalUrl}`;

    const iosStoreUrl = 'https://apps.apple.com/nl/app/idXXXXXXXXX'; // TODO: vervang door echte App Store-link
    const androidStoreUrl = 'https://play.google.com/store/apps/details?id=com.holwert.dorpsapp';
    const appDeepLink = `holwert://news/${id}`;

    const html = `<!doctype html>
<html lang="nl">
  <head>
    <meta charset="utf-8" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <meta property="og:type" content="article" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    ${image ? `<meta property="og:image" content="${image}" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    ${image ? `<meta name="twitter:image" content="${image}" />` : ''}
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      body { font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; margin: 0; padding: 24px; background: #f5f5f5; color: #222; }
      .card { max-width: 720px; margin: 0 auto; background: #fff; border-radius: 16px; padding: 24px; box-shadow: 0 10px 30px rgba(0,0,0,0.08); }
      h1 { font-size: 26px; margin-bottom: 12px; }
      .meta { font-size: 14px; color: #666; margin-bottom: 16px; }
      img { max-width: 100%; border-radius: 12px; margin-bottom: 16px; }
      .content { font-size: 16px; line-height: 1.6; }
      .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #2563EB; color: #fff; font-size: 12px; margin-bottom: 12px; }
      .store-hint { margin-top: 24px; font-size: 14px; color: #555; }
      .store-buttons { margin-top: 12px; display: flex; flex-wrap: wrap; gap: 8px; }
      .btn { display: inline-flex; align-items: center; justify-content: center; padding: 10px 16px; border-radius: 999px; font-size: 14px; text-decoration: none; border: none; cursor: pointer; }
      .btn-primary { background: #2563EB; color: #fff; }
      .btn-outline { background: #fff; color: #2563EB; border: 1px solid #2563EB; }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="badge">Holwert Dorpsapp</div>
      <h1>${title}</h1>
      ${
        article.published_at
          ? `<div class="meta">${new Date(article.published_at).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</div>`
          : ''
      }
      ${image ? `<img src="${image}" alt="${title}" />` : ''}
      <div class="content">
        ${article.content || ''}
      </div>
      <div class="store-hint">
        <p>Dit bericht staat in de Holwert Dorpsapp.</p>
        <div class="store-buttons">
          <a class="btn btn-primary" href="${appDeepLink}">Open in de app</a>
          <a class="btn btn-outline" href="${androidStoreUrl}" target="_blank" rel="noopener">Open in Google Play</a>
          <a class="btn btn-outline" href="${iosStoreUrl}" target="_blank" rel="noopener">Binnenkort in de App Store</a>
        </div>
      </div>
    </main>
  </body>
</html>`;
    res.status(200).set('Content-Type', 'text/html; charset=utf-8').send(html);
  } catch (error) {
    console.error('Share news page error:', error);
    res
      .status(500)
      .set('Content-Type', 'text/html; charset=utf-8')
      .send('<!doctype html><html><head><meta charset="utf-8"><title>Fout</title></head><body><h1>Er ging iets mis</h1><p>Het nieuwsbericht kon niet geladen worden.</p></body></html>');
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

    // Find user by email (inclusief organization_id indien kolom bestaat)
    let userResult;
    try {
      userResult = await executeQuery(
        'SELECT id, email, password_hash, first_name, last_name, profile_image_url, profile_number, role, is_active, organization_id FROM users WHERE email = ?',
        [email]
      );
    } catch (colErr) {
      try {
        userResult = await executeQuery(
          'SELECT id, email, password_hash, first_name, last_name, profile_image_url, profile_number, role, is_active FROM users WHERE email = ?',
          [email]
        );
      } catch (e2) {
        userResult = await executeQuery(
          'SELECT id, email, password_hash, first_name, last_name, role, is_active FROM users WHERE email = ?',
          [email]
        );
      }
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

    const organizationId = user.organization_id != null ? parseInt(user.organization_id, 10) : null;

    // Generate JWT token (organization_id voor dashboard /api/org/*)
    const token = jwt.sign(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        ...(organizationId != null && !isNaN(organizationId) ? { organizationId } : {})
      },
      JWT_SECRET,
      { expiresIn: '30d' }
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
        profile_picture: user.profile_image_url ?? null,
        profile_image_url: user.profile_image_url ?? null,
        profile_number: user.profile_number ?? null,
        role: user.role,
        ...(organizationId != null && !isNaN(organizationId) ? { organization_id: organizationId } : {})
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

const ORG_DASHBOARD_ELEVATED_ROLES = new Set(['admin', 'superadmin', 'editor']);

function hashOrgPasswordResetToken(rawToken) {
  return crypto.createHash('sha256').update(String(rawToken), 'utf8').digest('hex');
}

function getOrgDashboardPublicBaseUrl() {
  let base = (process.env.ORG_DASHBOARD_URL || '').trim();
  if (!base) {
    base = 'https://holwert.appenvloed.com/dashboard/';
  }
  return base.replace(/\/?$/, '/');
}

async function findUserRowForOrgPasswordReset(emailNormalized) {
  let userResult;
  try {
    userResult = await executeQuery(
      'SELECT id, email, role, is_active, organization_id FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [emailNormalized],
    );
  } catch (colErr) {
    userResult = await executeQuery(
      'SELECT id, email, role, is_active FROM users WHERE LOWER(TRIM(email)) = ? LIMIT 1',
      [emailNormalized],
    );
  }
  return userResult.rows?.[0] ?? null;
}

function isOrgDashboardPasswordResetEligible(u) {
  if (!u || !u.is_active) return false;
  const role = String(u.role || '').toLowerCase();
  if (ORG_DASHBOARD_ELEVATED_ROLES.has(role)) return false;
  const oid = u.organization_id != null ? parseInt(u.organization_id, 10) : NaN;
  return !Number.isNaN(oid) && oid > 0;
}

async function sendOrgPasswordResetEmailResend({ toEmail, resetUrl }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Holwert <onboarding@resend.dev>';
  if (!key) {
    return { ok: false, reason: 'no_key' };
  }
  const esc = (s) =>
    String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from,
      to: [toEmail],
      subject: 'Holwert – wachtwoord vernieuwen (organisatie-dashboard)',
      html: `<p>Je hebt een nieuw wachtwoord aangevraagd voor het <strong>Holwert organisatie-dashboard</strong>.</p>
<p><a href="${esc(resetUrl)}">Klik hier om een nieuw wachtwoord in te stellen</a></p>
<p>Of kopieer deze link in je browser:<br><span style="word-break:break-all">${esc(resetUrl)}</span></p>
<p>Deze link is <strong>1 uur</strong> geldig. Als je dit niet zelf hebt aangevraagd, kun je deze e-mail negeren.</p>`,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('[Resend org forgot]', res.status, t);
    return { ok: false, reason: 'api_error' };
  }
  return { ok: true };
}

// Wachtwoord vergeten (alleen accounts met organisatie, geen beheerdersrollen)
// Dubbele pad-variant i.v.m. hosting die /api wel of niet doorgeeft (zelfde patroon als /auth/register).
async function handleOrgForgotPasswordRequest(req, res) {
  const generic = {
    message:
      'Als dit e-mailadres bij ons bekend is voor het organisatie-dashboard, ontvang je zo meteen een e-mail met een link om je wachtwoord te vernieuwen.',
  };
  try {
    const emailRaw =
      req.body?.email != null ? String(req.body.email).trim().toLowerCase() : '';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw)) {
      return res.status(200).json(generic);
    }
    const user = await findUserRowForOrgPasswordReset(emailRaw);
    if (!user || !isOrgDashboardPasswordResetEligible(user)) {
      return res.status(200).json(generic);
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const tokenHash = hashOrgPasswordResetToken(rawToken);
    await executeQuery('DELETE FROM org_password_resets WHERE user_id = ?', [user.id]);
    await executeInsert(
      'INSERT INTO org_password_resets (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL 1 HOUR))',
      [user.id, tokenHash],
    );
    const resetUrl = `${getOrgDashboardPublicBaseUrl()}?reset=${encodeURIComponent(rawToken)}`;
    const sent = await sendOrgPasswordResetEmailResend({ toEmail: user.email, resetUrl });
    if (!sent.ok) {
      await executeQuery('DELETE FROM org_password_resets WHERE user_id = ?', [user.id]);
      console.warn('[org-forgot-password] geen e-mail verstuurd:', sent.reason);
    }
    return res.status(200).json(generic);
  } catch (error) {
    console.error('org-forgot-password error:', error);
    return res.status(500).json({
      error: 'Er ging iets mis. Probeer het later opnieuw.',
      message: error.message,
    });
  }
}

app.post('/api/auth/org-forgot-password', orgForgotPasswordRateLimiter, handleOrgForgotPasswordRequest);
app.post('/auth/org-forgot-password', orgForgotPasswordRateLimiter, handleOrgForgotPasswordRequest);

async function handleOrgResetPasswordRequest(req, res) {
  try {
    const token = req.body?.token != null ? String(req.body.token).trim() : '';
    const password = req.body?.password != null ? String(req.body.password) : '';
    if (!/^[a-f0-9]{64}$/i.test(token)) {
      return res.status(400).json({ error: 'Ongeldige of verlopen link.' });
    }
    if (password.length < 6) {
      return res.status(400).json({ error: 'Het wachtwoord moet minimaal 6 tekens zijn.' });
    }
    const tokenHash = hashOrgPasswordResetToken(token);
    const row = await executeQuery(
      'SELECT user_id FROM org_password_resets WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
      [tokenHash],
    );
    if (!row.rows.length) {
      return res.status(400).json({ error: 'Ongeldige of verlopen link. Vraag een nieuwe aan via «Wachtwoord vergeten».' });
    }
    const userId = row.rows[0].user_id;
    const hashed = await bcrypt.hash(password, 10);
    await executeQuery('UPDATE users SET password_hash = ? WHERE id = ?', [hashed, userId]);
    await executeQuery('DELETE FROM org_password_resets WHERE user_id = ?', [userId]);
    return res.json({ message: 'Je wachtwoord is bijgewerkt. Je kunt nu inloggen.' });
  } catch (error) {
    console.error('org-reset-password error:', error);
    return res.status(500).json({
      error: 'Er ging iets mis. Probeer het later opnieuw.',
      message: error.message,
    });
  }
}

app.post('/api/auth/org-reset-password', orgForgotPasswordRateLimiter, handleOrgResetPasswordRequest);
app.post('/auth/org-reset-password', orgForgotPasswordRateLimiter, handleOrgResetPasswordRequest);

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
      { expiresIn: '30d' }
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
        'SELECT id, email, first_name, last_name, profile_image_url, profile_number, role, relationship_with_holwert, organization_id, created_at, updated_at FROM users WHERE id = ?',
        [userId]
      );
    } catch (colErr) {
      try {
        result = await executeQuery(
          'SELECT id, email, first_name, last_name, profile_image_url, profile_number, role, relationship_with_holwert, created_at, updated_at FROM users WHERE id = ?',
          [userId]
        );
      } catch (colErr2) {
        result = await executeQuery(
          'SELECT id, email, first_name, last_name, role, created_at, updated_at FROM users WHERE id = ?',
          [userId]
        );
      }
    }
    if (!result.rows.length) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = result.rows[0];
    const organizationId = user.organization_id != null ? parseInt(user.organization_id, 10) : null;
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
        ...(organizationId != null && !isNaN(organizationId) ? { organization_id: organizationId } : {}),
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
        (SELECT COUNT(*) FROM events WHERE is_published = false) as pending_events
    `);
    const row = result.rows[0] || {};
    const pendingOrgs = parseInt(row.pending_orgs) || 0;
    const pendingEvents = parseInt(row.pending_events) || 0;
    const payload = {
      stats: {
        users: parseInt(row.users_count) || 0,
        organizations: parseInt(row.organizations_count) || 0,
        news: parseInt(row.news_count) || 0,
        events: parseInt(row.events_count) || 0
      },
      moderation: {
        count: pendingOrgs + pendingEvents,
        organizations: pendingOrgs,
        news: 0,
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
          (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as pending_orgs
      `);
      const row = result.rows[0] || {};
      const pendingOrgs = parseInt(row.pending_orgs) || 0;
      const payload = {
        stats: {
          users: parseInt(row.users_count) || 0,
          organizations: parseInt(row.organizations_count) || 0,
          news: parseInt(row.news_count) || 0,
          events: parseInt(row.events_count) || 0
        },
        moderation: {
          count: pendingOrgs,
          organizations: pendingOrgs,
          news: 0,
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
      res.setHeader('Cache-Control', 'private, no-store');
      return res.json(cached);
    }
    
    console.log('[Moderation Count] Fetching fresh data from database');
    // Single query to get all pending counts at once
    const result = await executeQuery(`
      SELECT 
        (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as orgs_count,
        (SELECT COUNT(*) FROM events WHERE is_published = false) as events_count
    `);
    
    const row = result.rows[0] || {};
    const orgs = parseInt(row.orgs_count) || 0;
    const events = parseInt(row.events_count) || 0;
    const response = { count: orgs + events, organizations: orgs, news: 0, events };
    setCache(cacheKey, response, CACHE_TTL.moderation);
    res.setHeader('Cache-Control', 'private, no-store');
    res.json(response);
  } catch (error) {
    // If events table doesn't exist, try without it
    try {
      const result = await executeQuery(`
        SELECT 
          (SELECT COUNT(*) FROM organizations WHERE is_approved = false) as orgs_count
      `);
      const row = result.rows[0] || {};
      const orgs = parseInt(row.orgs_count) || 0;
      const response = { count: orgs, organizations: orgs, news: 0, events: 0 };
      setCache(getCacheKey('/api/admin/moderation/count'), response, CACHE_TTL.moderation);
      res.setHeader('Cache-Control', 'private, no-store');
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
      news: [],
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
    await ensureNewsColumns();
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
    await ensureNewsColumns();
    const { id } = req.params;

    const result = await executeQuery(`
      SELECT n.id, n.title, COALESCE(n.content, '') as content, n.excerpt, n.image_url, n.youtube_url, n.source_name, n.source_url, n.organization_id,
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
    await ensureNewsColumns();
    const { id } = req.params;
    const { title, content, excerpt, category, custom_category, organization_id, image_url, youtube_url, source_name, source_url, image_data, is_published, published_at } = req.body;

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

    if (youtube_url !== undefined) {
      updateFields.push(`youtube_url = ?`);
      values.push(youtube_url || null);
    }

    if (source_name !== undefined) {
      updateFields.push(`source_name = ?`);
      values.push(source_name || null);
    }

    if (source_url !== undefined) {
      updateFields.push(`source_url = ?`);
      values.push(source_url || null);
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

// Publiceren vanuit moderatie (alleen is_published + published_at)
app.post('/api/admin/news/:id/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    let upd;
    try {
      upd = await executeQuery(
        `UPDATE news SET is_published = true, published_at = COALESCE(published_at, NOW()), updated_at = NOW() WHERE id = ?`,
        [id],
      );
    } catch (e) {
      if (e.message && String(e.message).includes('published_at')) {
        upd = await executeQuery(
          `UPDATE news SET is_published = true, updated_at = NOW() WHERE id = ?`,
          [id],
        );
      } else {
        throw e;
      }
    }
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Artikel niet gevonden' });
    }
    invalidateCache('/api/news');
    invalidateCache(`/api/news/${id}`);
    invalidateCache('/api/featured');
    invalidateCache('/api/admin/news');
    invalidateCache('/api/admin/moderation/count');
    invalidateCache('/api/admin/dashboard');
    invalidateCache('/api/admin/pending');
    res.json({ message: 'Nieuws gepubliceerd' });
  } catch (error) {
    console.error('Publish news error:', error);
    res.status(500).json({ error: 'Publiceren mislukt', message: error.message });
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
    invalidateCache('/api/admin/moderation/count');
    invalidateCache('/api/admin/pending');

    res.json({ success: true });
  } catch (error) {
    console.error('Delete news error:', error);
    res.status(500).json({ error: 'Failed to delete article', message: error.message });
  }
});

// Get single organization (admin) - MUST BE BEFORE /api/admin/organizations (without :id)
app.get('/api/admin/organizations/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`[GET /api/admin/organizations/:id] Request for organization ID: ${id}, user:`, req.user);
    
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }
    
    const result = await executeQuery(
      `SELECT id, name, category, description, bio, is_approved, website, email, show_email, phone, whatsapp, address, 
              facebook, instagram, twitter, linkedin, brand_color, logo_url, privacy_statement, created_at, updated_at
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
app.get('/api/admin/organizations', authenticateToken, requireAdmin, async (req, res) => {
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
        o.created_at,
        o.logo_url
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
    const { name, category, description, bio, is_approved, website, email, show_email, phone, whatsapp, address, 
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
    if (show_email !== undefined) sets.push(`show_email = ${push(!!show_email)}`);
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

// Approve organization (admin) — goedkeuren + optioneel automatisch dashboard-gebruiker (zelfde contact-e-mail)
app.post('/api/admin/organizations/:id/approve', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const orgId = parseInt(req.params.id, 10);
    if (Number.isNaN(orgId) || orgId < 1) {
      return res.status(400).json({ error: 'Ongeldig organisatie-ID' });
    }

    const upd = await executeQuery('UPDATE organizations SET is_approved = true WHERE id = ?', [orgId]);
    if (!upd.rowCount) return res.status(404).json({ error: 'Organization not found' });

    const orgResult = await executeQuery(
      'SELECT id, name, email FROM organizations WHERE id = ? LIMIT 1',
      [orgId],
    );
    const org = orgResult.rows[0] || {};
    let user_created = false;
    let dashboard_login_email = null;
    let temporary_password = null;
    let user_notice = null;

    const linkedUsers = await executeQuery(
      'SELECT id FROM users WHERE organization_id = ? LIMIT 1',
      [orgId],
    );
    if (linkedUsers.rows.length > 0) {
      user_notice =
        'Er was al minstens één account gekoppeld aan deze organisatie; er is geen nieuw dashboard-account aangemaakt.';
    } else {
      const emailRaw = org.email != null ? String(org.email).trim() : '';
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(emailRaw)) {
        user_notice =
          'Geen geldig contact-e-mailadres bij deze organisatie. Voeg bij Organisaties een e-mail toe en maak zo nodig handmatig een gebruiker aan.';
      } else {
        const dup = await executeQuery(
          'SELECT id, organization_id FROM users WHERE email = ? LIMIT 1',
          [emailRaw],
        );
        if (dup.rows.length > 0) {
          const oi = dup.rows[0].organization_id;
          if (oi != null && Number(oi) === orgId) {
            user_notice = 'Er bestond al een gebruiker met dit e-mailadres voor deze organisatie.';
          } else {
            user_notice =
              'Dit e-mailadres is al in gebruik door een ander account. Los dit op onder Gebruikers (ander e-mailadres bij de organisatie of bestaand account koppelen).';
          }
        } else {
          const plain = crypto.randomBytes(18).toString('base64url').slice(0, 24);
          const hashed = await bcrypt.hash(plain, 10);
          const nameTrim = (org.name && String(org.name).trim()) ? String(org.name).trim().slice(0, 80) : 'Organisatie';
          const firstName = nameTrim;
          const lastName = '';
          try {
            await executeInsert(
              `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, organization_id)
               VALUES (?, ?, ?, ?, 'user', true, ?)`,
              [firstName, lastName, emailRaw, hashed, orgId],
            );
            user_created = true;
            dashboard_login_email = emailRaw;
            temporary_password = plain;
            user_notice =
              'Er is automatisch een dashboard-account aangemaakt voor het web-dashboard. Geef het tijdelijke wachtwoord veilig door aan de organisatie (of wijzig het onder Gebruikers).';
          } catch (insErr) {
            if (insErr.code === 'ER_DUP_ENTRY' || insErr.errno === 1062) {
              user_notice =
                'Kon geen account aanmaken: dit e-mailadres bestaat al. Pas het contactadres van de organisatie aan of koppel een bestaand account.';
            } else {
              console.error('[POST approve organization] user insert:', insErr);
              user_notice =
                'Organisatie is goedgekeurd, maar aanmaken van het dashboard-account mislukte. Maak handmatig een gebruiker aan onder Gebruikers.';
            }
          }
        }
      }
    }

    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    invalidateCache('/api/admin/dashboard');
    invalidateCache('/api/admin/pending');

    res.json({
      message: 'Organisatie goedgekeurd',
      user_created,
      ...(dashboard_login_email ? { dashboard_login_email } : {}),
      ...(temporary_password ? { temporary_password } : {}),
      ...(user_notice ? { user_notice } : {}),
    });
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
    invalidateCache('/api/admin/pending');

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
    invalidateCache('/api/admin/pending');

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
    query += sqlPublicEventVisibility('e', 'o');

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
    let countQuery = `SELECT COUNT(*) as total FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.status = 'scheduled'`;
    countQuery += sqlPublicEventVisibility('e', 'o');
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
      events: (result.rows || []).map(stripHeavyMediaFromEventRow),
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
      ${sqlPublicEventVisibility('e', 'o')}
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
    const { organization_id, status } = req.query;
    const hasOrgScope = organization_id != null && String(organization_id).trim() !== '';
    const showOnlyUpcoming = hasOrgScope
      ? req.query.upcoming === 'true'
      : req.query.upcoming !== 'false';

    let query = `
      SELECT COUNT(*) as total
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];
    if (showOnlyUpcoming) {
      query += sqlEventUpcomingCutoff('e');
    }
    query += sqlPublicEventVisibility('e', 'o');
    if (organization_id) {
      query += ` AND e.organization_id = ?`;
      params.push(parseInt(organization_id, 10));
    }
    if (status) {
      query += ` AND e.status = ?`;
      params.push(status);
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
// Zelfde database-pad als org-CRUD (executeQuery): anders schrijft org naar directe MySQL
// terwijl deze route alleen via de PHP-proxy las → events wel in dashboard, niet in app.
app.get('/api/events', async (req, res) => {
  try {
    const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
    const rawLimit = parseInt(req.query.limit, 10);
    const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, 500) : 20;
    const { organization_id, status } = req.query;
    const offset = (page - 1) * limit;
    const hasOrgScope = organization_id != null && String(organization_id).trim() !== '';
    // Org-detail: standaard óók verleden (tenzij upcoming=true). Algemene agenda: alleen komend
    // tenzij de app upcoming=false meestuurt (zelfde beeld als org-pagina).
    const showOnlyUpcoming = hasOrgScope
      ? req.query.upcoming === 'true'
      : req.query.upcoming !== 'false';

    let query = `
      SELECT e.*, o.name as organization_name, o.brand_color as organization_brand_color, o.logo_url as organization_logo
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];
    if (showOnlyUpcoming) {
      query += sqlEventUpcomingCutoff('e');
    }
    if (organization_id) {
      query += ` AND e.organization_id = ?`;
      params.push(parseInt(organization_id, 10));
    }
    if (status) {
      query += ` AND e.status = ?`;
      params.push(status);
    }
    query += sqlPublicEventVisibility('e', 'o');
    // Sortering: org-detail = meest recent eerst. Algemene lijst upcoming=false: eerst komende (oplopend),
    // daarna verleden met nieuwste eerst — anders vulden oude jan.-items de LIMIT vóór recent verleden.
    let orderClause = 'ORDER BY e.event_date ASC';
    if (hasOrgScope && !showOnlyUpcoming) {
      orderClause = 'ORDER BY e.event_date DESC';
    } else if (!hasOrgScope && !showOnlyUpcoming) {
      orderClause = `ORDER BY (
          GREATEST(e.event_date, COALESCE(e.event_end_date, e.event_date)) < CURDATE()
        ) ASC,
        CASE WHEN GREATEST(e.event_date, COALESCE(e.event_end_date, e.event_date)) >= CURDATE()
          THEN e.event_date END ASC,
        CASE WHEN GREATEST(e.event_date, COALESCE(e.event_end_date, e.event_date)) < CURDATE()
          THEN e.event_date END DESC,
        e.id DESC`;
    }
    query += ` ${orderClause} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit, 10), parseInt(offset, 10));

    let countSql = `
      SELECT COUNT(*) as total
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE 1=1
    `;
    const countParams = [];
    if (showOnlyUpcoming) {
      countSql += sqlEventUpcomingCutoff('e');
    }
    if (organization_id) {
      countSql += ` AND e.organization_id = ?`;
      countParams.push(parseInt(organization_id, 10));
    }
    if (status) {
      countSql += ` AND e.status = ?`;
      countParams.push(status);
    }
    countSql += sqlPublicEventVisibility('e', 'o');

    const [result, countResult] = await Promise.all([
      executeQuery(query, params),
      executeQuery(countSql, countParams)
    ]);

    const events = (result.rows || []).map(normalizePublicEventRow);
    const total = parseInt(countResult.rows?.[0]?.total ?? 0, 10) || 0;

    res.json({
      events,
      pagination: {
        page: parseInt(page, 10),
        limit: parseInt(limit, 10),
        total,
        pages: Math.ceil(total / parseInt(limit, 10))
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
      ${sqlPublicEventVisibility('e', 'o')}
      LIMIT 1
    `, [parseInt(id)]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ event: normalizePublicEventRow(result.rows[0]) });
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
    const eventDateSql = toMysqlDateTime(event_date);
    if (!eventDateSql) return res.status(400).json({ error: 'Invalid event_date', message: 'Use a valid date/time (YYYY-MM-DD or datetime-local).' });
    const endRaw = event_end_date || end_date || null;
    const endSql = endRaw ? toMysqlDateTime(endRaw) : null;
    if (endRaw && !endSql) return res.status(400).json({ error: 'Invalid event end date' });
    const priceVal = normalizeEventPrice(price);

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
      [title, description || null, eventDateSql, endSql, location || null, organization_id || null, status, organizerId, priceVal, image_url || null]
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
    if (event_date !== undefined) sets.push(`event_date = ${push(toMysqlDateTime(event_date))}`);
    if (end_date !== undefined || event_end_date !== undefined) sets.push(`event_end_date = ${push(toMysqlDateTime(event_end_date !== undefined ? event_end_date : end_date))}`);
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

// Evenement publiceren (moderatie)
app.post('/api/admin/events/:id/publish', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const upd = await executeQuery(
      'UPDATE events SET is_published = true, updated_at = NOW() WHERE id = ?',
      [id],
    );
    if (!upd.rowCount) {
      return res.status(404).json({ error: 'Evenement niet gevonden' });
    }
    invalidateCache('/api/admin/moderation/count');
    invalidateCache('/api/admin/dashboard');
    invalidateCache('/api/admin/pending');
    res.json({ message: 'Evenement gepubliceerd' });
  } catch (error) {
    console.error('Publish event error:', error);
    res.status(500).json({ error: 'Publiceren mislukt', message: error.message });
  }
});

// Delete event
app.delete('/api/admin/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await executeQuery('DELETE FROM events WHERE id = ?', [id]);
    if (!result.rowCount) return res.status(404).json({ error: 'Event not found' });
    invalidateCache('/api/admin/moderation/count');
    invalidateCache('/api/admin/pending');
    invalidateCache('/api/admin/dashboard');
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
    invalidateCache('/api/app/content-pages');
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
    // Juridische teksten wijzigen soms; geen CDN/app-cache op oude terms/privacy
    res.set('Cache-Control', 'private, no-store, max-age=0');
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
app.get('/api/admin/users', authenticateToken, requireAdmin, async (req, res) => {
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
    const {
      first_name,
      last_name,
      email,
      password,
      role = 'user',
      is_active = true,
      organization_id,
      phone,
      relationship_with_holwert,
    } = req.body;
    const hashed = await bcrypt.hash(password, 10);
    const orgId =
      organization_id != null && organization_id !== ''
        ? parseInt(organization_id, 10)
        : null;
    const orgIdValid = orgId != null && !Number.isNaN(orgId) && orgId > 0;

    let fn = first_name != null ? String(first_name).trim() : '';
    let ln = last_name != null ? String(last_name).trim() : '';

    if (!email || !password) {
      return res.status(400).json({ error: 'E-mail en wachtwoord zijn verplicht.' });
    }

    const emailTrim = String(email).trim();
    const phoneTrim = phone != null && String(phone).trim() !== '' ? String(phone).trim().slice(0, 20) : null;
    const relRaw = relationship_with_holwert != null ? String(relationship_with_holwert).trim() : '';
    const allowedRel = new Set(['resident', 'former_resident', 'vacation_home', 'interested', 'tourist']);
    const relVal = allowedRel.has(relRaw) ? relRaw : null;

    if (orgIdValid) {
      if (!fn) {
        const orgR = await executeQuery('SELECT name FROM organizations WHERE id = ? LIMIT 1', [orgId]);
        if (!orgR.rows?.length) {
          return res.status(404).json({ error: 'Organisatie niet gevonden' });
        }
        const orgName = String(orgR.rows[0].name || 'Organisatie').trim() || 'Organisatie';
        fn = orgName.slice(0, 80);
      }
      ln = ln || '';
    } else if (!fn || !ln) {
      return res.status(400).json({
        error: 'Voornaam en achternaam zijn verplicht voor een dorpsbewoner (app) zonder organisatie-dashboard.',
      });
    } else if (!relVal) {
      return res.status(400).json({
        error: 'Kies een relatie met Holwert (verplicht voor een dorpsbewoner-account).',
      });
    }

    let insertResult;
    if (orgIdValid) {
      insertResult = await executeInsert(
        `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, organization_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [fn, ln, emailTrim, hashed, role, is_active, orgId],
      );
    } else {
      insertResult = await executeInsert(
        `INSERT INTO users (first_name, last_name, email, password_hash, role, is_active, organization_id, relationship_with_holwert, phone)
         VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
        [fn, ln, emailTrim, hashed, role, is_active, relVal, phoneTrim],
      );
    }

    const userId = insertResult.insertId || insertResult.rows?.[0]?.id;
    if (!userId) {
      return res.status(500).json({ error: 'Failed to create user', message: 'No insertId returned' });
    }

    const fetchResult = await executeQuery(
      'SELECT id, first_name, last_name, email, phone, profile_image_url, profile_number, relationship_with_holwert, role, is_active, organization_id, created_at, updated_at FROM users WHERE id = ?',
      [userId],
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
    const { first_name, last_name, email, password, role, is_active, profile_image_url, relationship_with_holwert, profile_number, organization_id, phone } = req.body;
    const sets = [];
    const params = [];
    const push = (v) => { params.push(v); return '?'; };
    if (first_name !== undefined) { sets.push('first_name = ?'); params.push(first_name); }
    if (last_name !== undefined) { sets.push('last_name = ?'); params.push(last_name); }
    if (email !== undefined) { sets.push('email = ?'); params.push(email); }
    if (phone !== undefined) { sets.push('phone = ?'); params.push(phone === '' || phone == null ? null : String(phone).trim().slice(0, 20)); }
    if (role !== undefined) { sets.push('role = ?'); params.push(role); }
    if (is_active !== undefined) { sets.push('is_active = ?'); params.push(is_active); }
    if (profile_image_url !== undefined) { sets.push('profile_image_url = ?'); params.push(profile_image_url); }
    if (relationship_with_holwert !== undefined) { sets.push('relationship_with_holwert = ?'); params.push(relationship_with_holwert); }
    if (profile_number !== undefined) { sets.push('profile_number = ?'); params.push(profile_number); }
    if (organization_id !== undefined) { sets.push('organization_id = ?'); params.push(organization_id === '' || organization_id == null ? null : parseInt(organization_id, 10)); }
    if (password) {
      const hashed = await bcrypt.hash(password, 10);
      sets.push('password_hash = ?');
      params.push(hashed);
    }
    if (!sets.length) return res.status(400).json({ error: 'No fields to update' });
    params.push(id);

    await executeQuery(
      `UPDATE users SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`,
      params
    );

    const fetchResult = await executeQuery(
      'SELECT id, first_name, last_name, email, phone, profile_image_url, profile_number, relationship_with_holwert, role, is_active, organization_id, created_at, updated_at FROM users WHERE id = ?',
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

// ===== ORGANISATIE-PORTAL (uitgeklede admin voor één organisatie) =====
// Vereist: user met organization_id in JWT (super-admin koppelt user aan org in admin).

app.get('/api/org/me', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    let orgResult;
    try {
      orgResult = await executeQuery(
        `SELECT id, name, category, description, bio, is_approved, website, email, phone, whatsapp, address,
         facebook, instagram, twitter, linkedin, brand_color, logo_url, privacy_statement, created_at, updated_at
         FROM organizations WHERE id = ?`,
        [orgId]
      );
    } catch (colErr) {
      orgResult = await executeQuery(
        `SELECT id, name, category, description, bio, is_approved, website, email, phone, whatsapp, address,
         facebook, instagram, twitter, linkedin, brand_color, logo_url, created_at, updated_at
         FROM organizations WHERE id = ?`,
        [orgId]
      );
    }
    if (!orgResult.rows?.length) {
      return res.status(404).json({
        error: 'Organisatie niet gevonden',
        message:
          'Je account verwijst naar een organisatie die niet (meer) bestaat. Controleer organization_id in de database of neem contact op met de beheerder.',
      });
    }
    res.json({
      user: { id: req.user.userId, email: req.user.email, role: req.user.role, organization_id: orgId },
      organization: orgResult.rows[0]
    });
  } catch (error) {
    console.error('GET /api/org/me error:', error);
    res.status(500).json({ error: 'Failed to load', message: error.message });
  }
});

app.get('/api/org/profile', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const result = await executeQuery(
      `SELECT id, name, category, description, bio, website, email, show_email, phone, whatsapp, address,
       facebook, instagram, twitter, linkedin, brand_color, logo_url, privacy_statement, is_approved, created_at, updated_at
       FROM organizations WHERE id = ?`,
      [orgId]
    );
    if (!result.rows?.length) return res.status(404).json({ error: 'Organisatie niet gevonden' });
    res.json({ organization: result.rows[0] });
  } catch (error) {
    console.error('GET /api/org/profile error:', error);
    res.status(500).json({ error: 'Failed to load profile', message: error.message });
  }
});

app.put('/api/org/profile', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const raw = req.body || {};
    /** Zelfde inhoudelijke velden als superadmin (`PUT /admin/organizations/:id`), behalve `is_approved` (alleen beheerder). */
    const allowed = [
      'name',
      'category',
      'description',
      'bio',
      'website',
      'email',
      'show_email',
      'phone',
      'whatsapp',
      'address',
      'facebook',
      'instagram',
      'twitter',
      'linkedin',
      'brand_color',
      'logo_url',
      'privacy_statement',
    ];
    if (raw.name !== undefined) {
      const nm = raw.name != null ? String(raw.name).trim() : '';
      if (!nm) {
        return res.status(400).json({ error: 'Naam mag niet leeg zijn' });
      }
    }
    const sets = [];
    const values = [];
    allowed.forEach((key) => {
      if (raw[key] !== undefined) {
        let v = raw[key];
        if (key === 'name') v = String(v).trim();
        if (key === 'show_email') v = !!v; // zorg dat het altijd een boolean is
        sets.push(`${key} = ?`);
        values.push(v);
      }
    });
    if (sets.length === 0) return res.status(400).json({ error: 'Geen velden om bij te werken' });
    values.push(orgId);
    await executeQuery(`UPDATE organizations SET ${sets.join(', ')}, updated_at = NOW() WHERE id = ?`, values);
    const updated = await executeQuery(
      `SELECT id, name, category, description, bio, website, email, phone, whatsapp, address,
       facebook, instagram, twitter, linkedin, brand_color, logo_url, privacy_statement, is_approved, updated_at
       FROM organizations WHERE id = ?`,
      [orgId]
    );
    res.json({ organization: updated.rows[0] });
  } catch (error) {
    console.error('PUT /api/org/profile error:', error);
    res.status(500).json({ error: 'Failed to update profile', message: error.message });
  }
});

// Eigen inlogwachtwoord wijzigen (organisatie-dashboard, niet het org.-contact e-mailveld)
app.put('/api/org/me/password', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const userId = req.user && req.user.userId;
    if (userId == null) {
      return res.status(400).json({ error: 'Ongeldige sessie. Log opnieuw in.' });
    }
    const cur =
      req.body?.current_password != null ? String(req.body.current_password) : '';
    const neu = req.body?.new_password != null ? String(req.body.new_password) : '';
    if (!cur) {
      return res.status(400).json({ error: 'Vul je huidige wachtwoord in.' });
    }
    if (neu.length < 6) {
      return res.status(400).json({ error: 'Nieuw wachtwoord moet minimaal 6 tekens zijn.' });
    }
    const row = await executeQuery(
      'SELECT id, password_hash FROM users WHERE id = ? LIMIT 1',
      [userId],
    );
    if (!row.rows?.length) {
      return res.status(404).json({ error: 'Gebruiker niet gevonden' });
    }
    const hash = row.rows[0].password_hash;
    const ok = hash ? await bcrypt.compare(cur, hash) : false;
    if (!ok) {
      return res.status(401).json({ error: 'Huidig wachtwoord is onjuist.' });
    }
    const hashed = await bcrypt.hash(neu, 10);
    await executeQuery('UPDATE users SET password_hash = ?, updated_at = NOW() WHERE id = ?', [
      hashed,
      userId,
    ]);
    try {
      await executeQuery('DELETE FROM org_password_resets WHERE user_id = ?', [userId]);
    } catch (e) {
      /* org_password_resets kan ontbreken op oudere omgevingen */
    }
    return res.json({
      message: 'Je wachtwoord is bijgewerkt. Gebruik bij de volgende keer inloggen je nieuwe wachtwoord.',
    });
  } catch (error) {
    console.error('PUT /api/org/me/password error:', error);
    res.status(500).json({ error: 'Wachtwoord wijzigen mislukt', message: error.message });
  }
});

// Nieuws voor eigen organisatie
app.get('/api/org/news', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    await ensureNewsColumns();
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const orgId = req.organizationId;
    let query = `SELECT n.id, n.title, n.excerpt, n.category, n.custom_category, n.image_url, n.is_published, COALESCE(n.published_at, n.created_at) as published_at, n.organization_id, n.created_at, n.updated_at
      FROM news n WHERE n.organization_id = ?`;
    const params = [orgId];
    if (status === 'published') { query += ` AND n.is_published = true`; }
    else if (status === 'pending') { query += ` AND n.is_published = false`; }
    query += ` ORDER BY n.created_at DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await executeQuery(query, params);
    const countResult = await executeQuery(
      `SELECT COUNT(*) as total FROM news n WHERE n.organization_id = ?${status === 'published' ? ' AND n.is_published = true' : ''}${status === 'pending' ? ' AND n.is_published = false' : ''}`,
      [orgId]
    );
    res.json({
      news: result.rows,
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].total), pages: Math.ceil(countResult.rows[0].total / limit) }
    });
  } catch (error) {
    console.error('GET /api/org/news error:', error);
    res.status(500).json({ error: 'Failed to load news', message: error.message });
  }
});

app.get('/api/org/news/:id', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    await ensureNewsColumns();
    const orgId = req.organizationId;
    const result = await executeQuery(
      'SELECT id, title, content, excerpt, category, custom_category, image_url, youtube_url, source_name, source_url, is_published, COALESCE(published_at, created_at) as published_at, organization_id, author_id, created_at, updated_at FROM news WHERE id = ? AND organization_id = ?',
      [req.params.id, orgId]
    );
    if (!result.rows?.length) return res.status(404).json({ error: 'Artikel niet gevonden' });
    res.json({ article: result.rows[0] });
  } catch (error) {
    console.error('GET /api/org/news/:id error:', error);
    res.status(500).json({ error: 'Failed to load article', message: error.message });
  }
});

app.post('/api/org/news', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    await ensureNewsColumns();
    const orgId = req.organizationId;
    const userId = req.user.userId;
    const { title, content, excerpt, category, custom_category, image_url, youtube_url, source_name, source_url, is_published } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    const result = await executeInsert(
      'INSERT INTO news (title, content, excerpt, author_id, organization_id, image_url, youtube_url, source_name, source_url, category, custom_category, is_published, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())',
      [title || '', content || '', excerpt || null, userId, orgId, image_url || null, youtube_url || null, source_name || null, source_url || null, category || null, custom_category || null, is_published === true]
    );
    const id = result.insertId || (result.rows && result.rows[0] && result.rows[0].id);
    const row = await executeQuery('SELECT id, title, excerpt, is_published, organization_id, created_at FROM news WHERE id = ?', [id]);
    res.status(201).json({ article: row.rows[0] });
  } catch (error) {
    console.error('POST /api/org/news error:', error);
    res.status(500).json({ error: 'Failed to create article', message: error.message });
  }
});

app.put('/api/org/news/:id', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    await ensureNewsColumns();
    const orgId = req.organizationId;
    const id = parseInt(req.params.id);
    const { title, content, excerpt, category, custom_category, image_url, youtube_url, source_name, source_url, is_published, published_at } = req.body || {};
    const existing = await executeQuery('SELECT id FROM news WHERE id = ? AND organization_id = ?', [id, orgId]);
    if (!existing.rows?.length) return res.status(404).json({ error: 'Artikel niet gevonden' });
    const publishedAtSql = published_at ? toMysqlDateTime(published_at) : null;
    const publishedAtVal = publishedAtSql || null;
    await executeQuery(
      'UPDATE news SET title = ?, content = ?, excerpt = ?, category = ?, custom_category = ?, image_url = ?, youtube_url = ?, source_name = ?, source_url = ?, is_published = ?, published_at = COALESCE(?, published_at), updated_at = NOW() WHERE id = ?',
      [title ?? '', content ?? '', excerpt ?? null, category ?? null, custom_category ?? null, image_url ?? null, youtube_url ?? null, source_name ?? null, source_url ?? null, is_published === true, publishedAtVal, id]
    );
    const row = await executeQuery('SELECT id, title, excerpt, is_published, COALESCE(published_at, created_at) as published_at, updated_at FROM news WHERE id = ?', [id]);
    res.json({ article: row.rows[0] });
  } catch (error) {
    console.error('PUT /api/org/news/:id error:', error);
    res.status(500).json({ error: 'Failed to update article', message: error.message });
  }
});

app.delete('/api/org/news/:id', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Ongeldig id' });
    const del = await executeQuery('DELETE FROM news WHERE id = ? AND organization_id = ?', [id, orgId]);
    const n = del.rowCount ?? del.rows?.length ?? 0;
    if (!n) return res.status(404).json({ error: 'Artikel niet gevonden' });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/org/news/:id error:', error);
    res.status(500).json({ error: 'Verwijderen mislukt', message: error.message });
  }
});

// Agenda (events) voor eigen organisatie
app.get('/api/org/events', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const orgId = req.organizationId;
    let query = `SELECT e.id, e.title, e.description, e.event_date, e.event_end_date, e.location, e.status, e.price, e.image_url, e.organization_id, e.created_at, e.updated_at
      FROM events e WHERE e.organization_id = ?`;
    const params = [orgId];
    if (status === 'scheduled') { query += ` AND (e.status = 'scheduled' OR e.status IS NULL)`; }
    if (status === 'cancelled') { query += ` AND e.status = 'cancelled'`; }
    query += ` ORDER BY e.event_date DESC LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));
    const result = await executeQuery(query, params);
    const countResult = await executeQuery(
      `SELECT COUNT(*) as total FROM events e WHERE e.organization_id = ?${status === 'scheduled' ? " AND (e.status = 'scheduled' OR e.status IS NULL)" : ''}${status === 'cancelled' ? " AND e.status = 'cancelled'" : ''}`,
      [orgId]
    );
    res.json({
      events: (result.rows || []).map(normalizePublicEventRow),
      pagination: { page: parseInt(page), limit: parseInt(limit), total: parseInt(countResult.rows[0].total), pages: Math.ceil(countResult.rows[0].total / limit) }
    });
  } catch (error) {
    console.error('GET /api/org/events error:', error);
    res.status(500).json({ error: 'Failed to load events', message: error.message });
  }
});

app.get('/api/org/events/:id', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const result = await executeQuery(
      'SELECT id, title, description, event_date, event_end_date, location, status, price, image_url, organization_id, created_at, updated_at FROM events WHERE id = ? AND organization_id = ?',
      [req.params.id, orgId]
    );
    if (!result.rows?.length) return res.status(404).json({ error: 'Evenement niet gevonden' });
    res.json({ event: normalizePublicEventRow(result.rows[0]) });
  } catch (error) {
    console.error('GET /api/org/events/:id error:', error);
    res.status(500).json({ error: 'Failed to load event', message: error.message });
  }
});

app.post('/api/org/events', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const organizerId = req.user?.userId != null ? parseInt(req.user.userId, 10) : null;
    if (!organizerId || Number.isNaN(organizerId)) {
      return res.status(400).json({ error: 'Gebruiker ontbreekt in token', message: 'Log opnieuw in.' });
    }
    const { title, description, event_date, end_date, event_end_date, location, status, price, image_url } = req.body || {};
    if (!title) return res.status(400).json({ error: 'title is required' });
    if (!event_date) return res.status(400).json({ error: 'event_date is required' });
    const eventDateSql = toMysqlDateTime(event_date);
    if (!eventDateSql) {
      return res.status(400).json({
        error: 'Ongeldige datum/tijd',
        message: 'Kies een geldige datum en tijd (het formulier stuurt soms een formaat dat de database niet direct accepteert).',
      });
    }
    const endRaw =
      event_end_date != null && String(event_end_date).trim() !== ''
        ? event_end_date
        : end_date != null && String(end_date).trim() !== ''
          ? end_date
          : null;
    const endDt = endRaw != null ? toMysqlDateTime(endRaw) : null;
    const priceVal = normalizeEventPrice(price);
    const imageUrlSafe = sanitizeEventImageUrlForDb(image_url);
    const orgCheck = await executeQuery('SELECT is_approved FROM organizations WHERE id = ?', [orgId]);
    const approved =
      orgCheck.rows?.[0] &&
      (orgCheck.rows[0].is_approved === 1 ||
        orgCheck.rows[0].is_approved === true);
    const publishFlag = approved ? 1 : 0;

    const insertParams = [
      title || '',
      description || null,
      eventDateSql,
      endDt,
      location || null,
      orgId,
      status || 'scheduled',
      organizerId,
      priceVal,
      imageUrlSafe,
    ];
    let result;
    try {
      result = await executeInsert(
        `INSERT INTO events (title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, is_published, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
        [...insertParams, publishFlag]
      );
    } catch (insErr) {
      if (isMysqlMissingColumnError(insErr)) {
        result = await executeInsert(
          `INSERT INTO events (title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          insertParams
        );
      } else if (isMysqlDataTooLongError(insErr)) {
        const insertNoImg = [...insertParams];
        insertNoImg[9] = null;
        try {
          result = await executeInsert(
            `INSERT INTO events (title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, is_published, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [...insertNoImg, publishFlag]
          );
        } catch (e2) {
          if (isMysqlMissingColumnError(e2)) {
            result = await executeInsert(
              `INSERT INTO events (title, description, event_date, event_end_date, location, organization_id, status, organizer_id, price, image_url, created_at, updated_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
              insertNoImg
            );
          } else {
            throw e2;
          }
        }
      } else {
        throw insErr;
      }
    }
    const id = result.insertId || (result.rows && result.rows[0] && result.rows[0].id);
    const row = await executeQuery('SELECT id, title, event_date, organization_id, created_at FROM events WHERE id = ?', [id]);
    res.status(201).json({ event: row.rows[0] });
  } catch (error) {
    console.error('POST /api/org/events error:', error);
    res.status(500).json({ error: 'Failed to create event', message: error.message });
  }
});

app.put('/api/org/events/:id', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const id = parseInt(req.params.id);
    const { title, description, event_date, end_date, event_end_date, location, status, price, image_url } = req.body || {};
    const prev = await executeQuery(
      'SELECT id, event_date, event_end_date FROM events WHERE id = ? AND organization_id = ?',
      [id, orgId]
    );
    if (!prev.rows?.length) return res.status(404).json({ error: 'Evenement niet gevonden' });
    const p = prev.rows[0];

    let eventDateSql;
    if (event_date !== undefined) {
      if (event_date === null || String(event_date).trim() === '') {
        return res.status(400).json({ error: 'Datum/tijd is verplicht' });
      }
      eventDateSql = toMysqlDateTime(event_date);
      if (!eventDateSql) {
        return res.status(400).json({ error: 'Ongeldige datum/tijd', message: 'Controleer datum en tijd van het evenement.' });
      }
    } else {
      eventDateSql = toMysqlDateTime(p.event_date) ?? p.event_date;
    }

    let endDt;
    if (event_end_date !== undefined || end_date !== undefined) {
      const raw = event_end_date !== undefined ? event_end_date : end_date;
      if (raw == null || String(raw).trim() === '') {
        endDt = null;
      } else {
        endDt = toMysqlDateTime(raw);
        if (!endDt) return res.status(400).json({ error: 'Ongeldige einddatum/tijd' });
      }
    } else {
      endDt = p.event_end_date == null ? null : toMysqlDateTime(p.event_end_date) ?? p.event_end_date;
    }

    const priceVal = normalizeEventPrice(price);
    const imageUrlSafe = sanitizeEventImageUrlForDb(image_url ?? null);
    const orgAppr = await executeQuery('SELECT is_approved FROM organizations WHERE id = ?', [orgId]);
    const orgApproved =
      orgAppr.rows?.[0] &&
      (orgAppr.rows[0].is_approved === 1 || orgAppr.rows[0].is_approved === true);
    const publishVal = orgApproved ? 1 : 0;
    const updateParamsWithPub = [
      title ?? '',
      description ?? null,
      eventDateSql,
      endDt,
      location ?? null,
      status ?? 'scheduled',
      priceVal,
      imageUrlSafe,
      publishVal,
      id,
      orgId,
    ];
    const updateParamsNoPub = [
      title ?? '',
      description ?? null,
      eventDateSql,
      endDt,
      location ?? null,
      status ?? 'scheduled',
      priceVal,
      imageUrlSafe,
      id,
      orgId,
    ];
    try {
      await executeQuery(
        'UPDATE events SET title = ?, description = ?, event_date = ?, event_end_date = ?, location = ?, status = ?, price = ?, image_url = ?, is_published = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
        updateParamsWithPub
      );
    } catch (updErr) {
      if (isMysqlMissingColumnError(updErr)) {
        await executeQuery(
          'UPDATE events SET title = ?, description = ?, event_date = ?, event_end_date = ?, location = ?, status = ?, price = ?, image_url = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
          updateParamsNoPub
        );
      } else if (isMysqlDataTooLongError(updErr)) {
        const noImgPub = [...updateParamsWithPub];
        noImgPub[7] = null;
        const noImg = [...updateParamsNoPub];
        noImg[7] = null;
        try {
          await executeQuery(
            'UPDATE events SET title = ?, description = ?, event_date = ?, event_end_date = ?, location = ?, status = ?, price = ?, image_url = ?, is_published = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
            noImgPub
          );
        } catch (e2) {
          if (isMysqlMissingColumnError(e2)) {
            await executeQuery(
              'UPDATE events SET title = ?, description = ?, event_date = ?, event_end_date = ?, location = ?, status = ?, price = ?, image_url = ?, updated_at = NOW() WHERE id = ? AND organization_id = ?',
              noImg
            );
          } else {
            throw e2;
          }
        }
      } else {
        throw updErr;
      }
    }
    const row = await executeQuery('SELECT id, title, event_date, status, updated_at FROM events WHERE id = ?', [id]);
    res.json({ event: row.rows[0] });
  } catch (error) {
    console.error('PUT /api/org/events/:id error:', error);
    res.status(500).json({ error: 'Failed to update event', message: error.message });
  }
});

app.delete('/api/org/events/:id', authenticateToken, requireOrgPortal, async (req, res) => {
  try {
    const orgId = req.organizationId;
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'Ongeldig id' });
    const del = await executeQuery('DELETE FROM events WHERE id = ? AND organization_id = ?', [id, orgId]);
    const n = del.rowCount ?? del.rows?.length ?? 0;
    if (!n) return res.status(404).json({ error: 'Evenement niet gevonden' });
    res.json({ success: true });
  } catch (error) {
    console.error('DELETE /api/org/events/:id error:', error);
    res.status(500).json({ error: 'Verwijderen mislukt', message: error.message });
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

// ----- Afvalkalender (aanpasbare datums: oud papier, containers + extra) -----
function getDefaultAfvalkalenderConfig() {
  const firstTuesday = new Date();
  firstTuesday.setDate(1);
  while (firstTuesday.getDay() !== 2) firstTuesday.setDate(firstTuesday.getDate() + 1);
  return {
    oudPapier: { type: 'recurring', weekday: 2, interval_weeks: 6, first_date: firstTuesday.toISOString().slice(0, 10) },
    // containers: standaard vrijdag, groen in even weken, grijs in oneven weken
    containers: { weekday: 5, extra_dates: [], even_label: 'groen', odd_label: 'grijs' },
  };
}

function addDays(d, n) {
  const out = new Date(d);
  out.setDate(out.getDate() + n);
  return out;
}

function toDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function computeNextOudPapierDates(config, count = 8) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out = [];
  if (!config || !config.oudPapier) return out;
  const c = config.oudPapier;
  if (c.type === 'dates' && Array.isArray(c.dates)) {
    const sorted = c.dates.map((x) => ({ d: new Date(x), s: x })).filter((x) => !isNaN(x.d.getTime()) && x.d >= today);
    sorted.sort((a, b) => a.d - b.d);
    sorted.slice(0, count).forEach((x) => out.push({ date: x.s, dateStr: x.d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) }));
    return out;
  }
  if (c.type === 'recurring' && c.first_date && c.interval_weeks) {
    let d = new Date(c.first_date);
    d.setHours(0, 0, 0, 0);
    const intervalDays = (c.interval_weeks || 6) * 7;
    while (d < today) d = addDays(d, intervalDays);
    for (let i = 0; i < count; i++) {
      out.push({ date: toDateStr(d), dateStr: d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }) });
      d = addDays(d, intervalDays);
    }
    return out;
  }
  return out;
}

function getWeekNumber(d) {
  const onejan = new Date(d.getFullYear(), 0, 1);
  return Math.ceil(((d - onejan) / 86400000 + onejan.getDay() + 1) / 7);
}

function computeNextContainerDates(config, count = 8) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const weekday = (config && config.containers && config.containers.weekday) ?? 5;
  const extra = (config && config.containers && config.containers.extra_dates) || [];
  const evenLabel = (config && config.containers && config.containers.even_label) === 'grijs' ? 'grijs' : 'groen';
  const oddLabel = (config && config.containers && config.containers.odd_label) === 'groen'
    ? 'groen'
    : (evenLabel === 'groen' ? 'grijs' : 'groen');
  const fridays = [];
  let d = new Date(today);
  for (let i = 0; i < 60; i++) {
    if (d.getDay() === weekday) {
      const weekNum = getWeekNumber(d);
      const label = weekNum % 2 === 0 ? evenLabel : oddLabel;
      fridays.push({ date: toDateStr(d), dateStr: d.toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }), label });
    }
    if (fridays.length >= count) break;
    d.setDate(d.getDate() + 1);
  }
  const extraList = extra
    .filter((x) => x && !isNaN(new Date(x).getTime()))
    .map((x) => ({ date: x, dateStr: new Date(x).toLocaleDateString('nl-NL', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' }), label: 'extra' }));
  const combined = [...fridays, ...extraList]
    .filter((x) => new Date(x.date) >= today)
    .sort((a, b) => new Date(a.date) - new Date(b.date))
    .slice(0, count);
  return combined;
}

function isTodayOudPapier(config) {
  const today = toDateStr(new Date());
  const next = computeNextOudPapierDates(config, 1);
  if (next.length === 0) return false;
  return next[0].date === today;
}

function isTodayContainer(config) {
  const today = toDateStr(new Date());
  const next = computeNextContainerDates(config, 2);
  return next.some((x) => x.date === today);
}

app.get('/api/app/afvalkalender', async (req, res) => {
  try {
    const row = await executeQuery('SELECT config_json FROM afvalkalender_config WHERE id = 1 LIMIT 1').then((r) => r.rows && r.rows[0]);
    let config = row && row.config_json;
    if (typeof config === 'string') try { config = JSON.parse(config); } catch (e) { config = null; }
    if (!config) config = getDefaultAfvalkalenderConfig();
    const oudPapierDates = computeNextOudPapierDates(config, 8);
    const containerDates = computeNextContainerDates(config, 8);
    res.set('Cache-Control', 'public, max-age=300');
    res.json({
      config: { oudPapier: config.oudPapier, containers: config.containers },
      oudPapierDates,
      containerDates,
      isTodayOudPapier: isTodayOudPapier(config),
      isTodayContainer: isTodayContainer(config),
    });
  } catch (error) {
    const def = getDefaultAfvalkalenderConfig();
    res.set('Cache-Control', 'public, max-age=60');
    res.json({
      config: def,
      oudPapierDates: computeNextOudPapierDates(def, 8),
      containerDates: computeNextContainerDates(def, 8),
      isTodayOudPapier: isTodayOudPapier(def),
      isTodayContainer: isTodayContainer(def),
    });
  }
});

app.get('/api/admin/afvalkalender', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const row = await executeQuery('SELECT config_json FROM afvalkalender_config WHERE id = 1 LIMIT 1').then((r) => r.rows && r.rows[0]);
    let config = row && row.config_json;
    if (typeof config === 'string') try { config = JSON.parse(config); } catch (e) { config = null; }
    if (!config) config = getDefaultAfvalkalenderConfig();
    res.json({ config });
  } catch (error) {
    res.json({ config: getDefaultAfvalkalenderConfig() });
  }
});

app.put('/api/admin/afvalkalender', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const oudPapier = body.oudPapier;
    const containers = body.containers;
    // Bepaal mapping voor groen/grijs op basis van even/oneven weken; default: even = groen, oneven = grijs
    const evenLabel = containers && containers.even_label === 'grijs' ? 'grijs' : 'groen';
    const oddLabel = evenLabel === 'groen' ? 'grijs' : 'groen';
    const config = {
      oudPapier: oudPapier && (oudPapier.type === 'dates'
        ? { type: 'dates', dates: Array.isArray(oudPapier.dates) ? oudPapier.dates : [] }
        : { type: 'recurring', weekday: oudPapier.weekday ?? 2, interval_weeks: oudPapier.interval_weeks ?? 6, first_date: oudPapier.first_date || new Date().toISOString().slice(0, 10) }),
      containers: containers
        ? {
            weekday: containers.weekday ?? 5,
            extra_dates: Array.isArray(containers.extra_dates) ? containers.extra_dates : [],
            even_label: evenLabel,
            odd_label: oddLabel,
          }
        : { weekday: 5, extra_dates: [], even_label: 'groen', odd_label: 'grijs' },
    };
    const json = JSON.stringify(config);
    await executeQuery('INSERT INTO afvalkalender_config (id, config_json) VALUES (1, ?) ON DUPLICATE KEY UPDATE config_json = ?, updated_at = CURRENT_TIMESTAMP', [json, json]);
    res.json({ success: true, config });
  } catch (error) {
    console.error('afvalkalender put error:', error);
    res.status(500).json({ error: 'Kon afvalkalender niet opslaan', message: error.message });
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
    await ensureOrgColumns();
    const { id } = req.params;
    if (!id || isNaN(parseInt(id))) {
      return res.status(400).json({ error: 'Invalid organization ID' });
    }

    const result = await executeQuery(
      `SELECT 
        id, name, category, description, bio,
        website,
        CASE WHEN show_email = true OR show_email IS NULL THEN email ELSE NULL END AS email,
        phone, whatsapp, address,
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
    await ensureOrgColumns();
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
        CASE WHEN show_email = true OR show_email IS NULL THEN email ELSE NULL END AS email,
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

// Publieke organisatie-registratie (bv. formulier op holwert.appenvloed.com)
// Maakt een organisatie aan met is_approved = false; verschijnt in admin voor moderatie.
/**
 * Stuur een notificatie-e-mail naar de beheerder wanneer een nieuwe organisatie
 * zich heeft aangemeld. Gebruikt dezelfde Resend-integratie als wachtwoord-reset.
 * Het doeladres staat in de env-variabele ADMIN_NOTIFICATION_EMAIL.
 */
async function sendNewOrgNotificationEmail({ orgName, orgEmail, orgId }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || 'Holwert Dorpsapp <onboarding@resend.dev>';
  const to = process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!key || !to) {
    console.log('[register] Notificatie-mail overgeslagen (RESEND_API_KEY of ADMIN_NOTIFICATION_EMAIL ontbreekt).');
    return;
  }
  const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const adminUrl = 'https://holwert.appenvloed.com/admin/#organizations';
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      from,
      to: [to],
      subject: `🔔 Nieuwe aanmelding: ${orgName}`,
      html: `
        <h2 style="color:#1a1a2e">Nieuwe organisatie aangemeld</h2>
        <p>Er heeft zich zojuist een nieuwe organisatie aangemeld voor de <strong>Holwert Dorpsapp</strong>.</p>
        <table style="border-collapse:collapse;margin:1rem 0">
          <tr><td style="padding:4px 12px 4px 0;color:#555">Naam</td><td><strong>${esc(orgName)}</strong></td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">E-mail</td><td>${esc(orgEmail)}</td></tr>
          <tr><td style="padding:4px 12px 4px 0;color:#555">ID</td><td>${esc(orgId)}</td></tr>
        </table>
        <p>
          <a href="${adminUrl}" style="background:#1a1a2e;color:#fff;padding:10px 20px;border-radius:6px;text-decoration:none;display:inline-block">
            Bekijk in admin-panel →
          </a>
        </p>
        <p style="color:#999;font-size:0.85em">Holwert Dorpsapp · automatische melding</p>
      `,
    }),
  });
  if (!res.ok) {
    const t = await res.text();
    console.error('[register] Resend-fout:', res.status, t);
  } else {
    console.log('[register] Notificatie-mail verstuurd naar', to);
  }
}

app.post('/api/organizations/register', orgRegisterRateLimiter, async (req, res) => {
  try {
    const {
      name, category, description, bio,
      website, email, phone, whatsapp, address,
      brand_color, logo_url,
      facebook, instagram, twitter, linkedin,
      privacy_statement,
    } = req.body || {};

    const norm = (v) => ((v != null && typeof v === 'string') ? v.trim() : null);
    const normOptUrl = (v) => {
      const s = norm(v);
      if (!s) return null;
      if (!/^https?:\/\//i.test(s)) {
        return null;
      }
      return s.length > 2000 ? s.slice(0, 2000) : s;
    };

    if (!name || typeof name !== 'string' || !name.trim()) {
      return res.status(400).json({ error: 'Naam van de organisatie is verplicht' });
    }

    const bc = norm(brand_color);
    if (bc && !/^#[0-9A-Fa-f]{6}$/.test(bc)) {
      return res.status(400).json({
        error: 'Ongeldige brandkleur',
        message: 'Gebruik een hex-kleur zoals #0f46ae (6 tekens na #).',
      });
    }

    const result = await executeInsert(
      `INSERT INTO organizations (
        name, category, description, bio, is_approved,
        website, email, phone, whatsapp, address,
        facebook, instagram, twitter, linkedin,
        brand_color, logo_url, privacy_statement, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        name.trim(),
        norm(category),
        norm(description),
        norm(bio),
        false, // is_approved = false: wacht op goedkeuring in admin
        norm(website),
        norm(email),
        norm(phone),
        norm(whatsapp),
        norm(address),
        normOptUrl(facebook),
        normOptUrl(instagram),
        normOptUrl(twitter),
        normOptUrl(linkedin),
        bc || null,
        normOptUrl(logo_url),
        norm(privacy_statement),
      ]
    );

    const id = result.insertId || (result.rows && result.rows[0] && result.rows[0].id);
    if (!id) {
      return res.status(500).json({ error: 'Registratie mislukt', message: 'Kon organisatie niet aanmaken' });
    }

    invalidateCache('/api/admin/organizations');
    invalidateCache('/api/admin/stats');
    invalidateCache('/api/admin/moderation/count');
    invalidateCache('/api/admin/pending');

    console.log('[POST /api/organizations/register] New organization registered:', { id, name: name.trim() });

    // Stuur notificatie-e-mail naar de beheerder (fire-and-forget, nooit blocking)
    sendNewOrgNotificationEmail({ orgName: name.trim(), orgEmail: email?.trim() ?? '', orgId: id }).catch(
      (err) => console.error('[register] notificatie-mail mislukt:', err.message)
    );

    res.status(201).json({
      success: true,
      message: 'Organisatie aangemeld. Deze wordt zichtbaar in de app na goedkeuring door de beheerder.',
      id
    });
  } catch (error) {
    console.error('Organization register error:', error);
    res.status(500).json({
      error: 'Registratie mislukt',
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
// Handmatige kolom-migratie (open URL in browser om direct te triggeren)
app.get('/api/migrate-columns', async (req, res) => {
  const results = [];
  const migrations = [
    { table: 'news',          column: 'youtube_url',  sql: `ALTER TABLE news ADD COLUMN youtube_url VARCHAR(500)` },
    { table: 'news',          column: 'source_name',  sql: `ALTER TABLE news ADD COLUMN source_name VARCHAR(255)` },
    { table: 'news',          column: 'source_url',   sql: `ALTER TABLE news ADD COLUMN source_url VARCHAR(500)` },
    { table: 'organizations', column: 'show_email',   sql: `ALTER TABLE organizations ADD COLUMN show_email BOOLEAN DEFAULT true` },
  ];
  for (const m of migrations) {
    try {
      await executeQuery(m.sql);
      results.push({ ...m, status: 'toegevoegd' });
      console.log(`[migrate-columns] ${m.table}.${m.column} toegevoegd`);
    } catch (e) {
      const alreadyExists = String(e.message).includes('Duplicate column') || String(e.message).includes('1060');
      results.push({ ...m, status: alreadyExists ? 'bestaat_al' : 'fout', error: alreadyExists ? undefined : e.message });
    }
  }
  res.json({ ok: true, results });
});

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
          show_email BOOLEAN DEFAULT true,
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
      // Voeg show_email toe aan bestaande tabel als die kolom er nog niet is
      try {
        await executeQuery(`ALTER TABLE organizations ADD COLUMN show_email BOOLEAN DEFAULT true`);
        console.log('[migrate] organizations.show_email kolom toegevoegd');
      } catch (e) {
        // Foutcode 1060 = kolom bestaat al → geen probleem
        if (!String(e.message).includes('Duplicate column') && !String(e.message).includes('1060')) {
          console.warn('[migrate] show_email migration error:', e.message);
        }
      }
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
          youtube_url VARCHAR(500),
          source_name VARCHAR(255),
          source_url VARCHAR(500),
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
      // Voeg nieuwe kolommen toe aan bestaande tabel (try/catch: 1060 = bestaat al)
      for (const [col, def] of [
        ['youtube_url', 'VARCHAR(500)'],
        ['source_name', 'VARCHAR(255)'],
        ['source_url',  'VARCHAR(500)'],
      ]) {
        try {
          await executeQuery(`ALTER TABLE news ADD COLUMN ${col} ${def}`);
          console.log(`[migrate] news.${col} kolom toegevoegd`);
        } catch (e) {
          if (!String(e.message).includes('Duplicate column') && !String(e.message).includes('1060')) {
            console.warn(`[migrate] news.${col} error:`, e.message);
          }
        }
      }
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
    
    const pushHeaders = {
      Accept: 'application/json',
      'Accept-Encoding': 'gzip, deflate',
      'Content-Type': 'application/json',
    };
    if (EXPO_PUSH_ACCESS_TOKEN) {
      pushHeaders.Authorization = `Bearer ${EXPO_PUSH_ACCESS_TOKEN}`;
    }

    // Send to Expo Push API (https://docs.expo.dev/push-notifications/sending-notifications/)
    const response = await axios.post(
      'https://exp.host/--/api/v2/push/send',
      messages,
      { headers: pushHeaders }
    );
    
    console.log(`✅ Sent ${validTokens.length} push notification(s)`);
    
    // Log results
    if (response.data && response.data.data) {
      const rawTickets = response.data.data;
      const tickets = Array.isArray(rawTickets) ? rawTickets : [rawTickets];
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
      icon VARCHAR(500) DEFAULT 'information-circle-outline',
      content TEXT,
      type ENUM('info','schedule','link','phone') DEFAULT 'info',
      url VARCHAR(500),
      sort_order INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
    // Vergroot de icon-kolom als die nog VARCHAR(50) is (legacy).
    await executeQuery(
      `ALTER TABLE practical_info MODIFY COLUMN icon VARCHAR(500) DEFAULT 'information-circle-outline'`
    );
  } catch (e) {
    console.error('ensurePracticalInfoTable error:', e.message);
  }
}

async function ensureAfvalkalenderTable() {
  try {
    await executeQuery(`CREATE TABLE IF NOT EXISTS afvalkalender_config (
      id INT PRIMARY KEY DEFAULT 1,
      config_json JSON NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )`);
  } catch (e) {
    console.error('ensureAfvalkalenderTable error:', e.message);
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

async function ensureUsersPhoneColumn() {
  try {
    const result = await executeQuery(
      "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'users' AND COLUMN_NAME = 'phone'"
    );
    if (result.rows && result.rows.length > 0) {
      return;
    }
    await executeQuery('ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL');
    console.log('✅ phone kolom toegevoegd aan users');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || (e.message && e.message.includes('Duplicate'))) return;
    console.error('ensureUsersPhoneColumn error:', e.message);
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

async function ensureOrgPasswordResetsTable() {
  try {
    await executeQuery(`
      CREATE TABLE IF NOT EXISTS org_password_resets (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        token_hash CHAR(64) NOT NULL,
        expires_at DATETIME NOT NULL,
        created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_org_password_resets_user (user_id),
        KEY idx_org_password_resets_token (token_hash)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);
    console.log('✅ org_password_resets tabel gecontroleerd');
  } catch (e) {
    console.error('ensureOrgPasswordResetsTable error:', e.message);
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
