const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import utilities (with fallbacks)
let logRequest, errorHandler, logSystemEvent, ensureUploadDirs;
try {
    const logger = require('./utils/logger');
    logRequest = logger.logRequest;
    errorHandler = logger.errorHandler;
    logSystemEvent = logger.logSystemEvent;
} catch (error) {
    console.log('Logger not available, using fallbacks');
    logRequest = (req, res, next) => next();
    errorHandler = (err, req, res, next) => {
        console.error(err.stack);
        res.status(500).json({ error: 'Something went wrong!' });
    };
    logSystemEvent = () => {};
}

try {
    const imageUpload = require('./utils/imageUpload');
    ensureUploadDirs = imageUpload.ensureUploadDirs;
} catch (error) {
    console.log('Image upload not available, using fallback');
    ensureUploadDirs = () => {};
}

const app = express();
const PORT = process.env.PORT || 3000;

// Initialize upload directories
ensureUploadDirs();

// Security middleware
app.use(helmet({
  crossOriginResourcePolicy: { policy: "cross-origin" }
}));

app.use(cors({
  origin: process.env.NODE_ENV === 'production' 
    ? ['https://holwert.appenvloed.com', 'https://holwert-backend-production.up.railway.app'] 
    : true, // Allow all origins in development
  credentials: true
}));

// Compression middleware (optional)
try {
    const compression = require('compression');
    app.use(compression());
} catch (error) {
    console.log('Compression not available, skipping');
}

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: {
    error: 'Te veel verzoeken, probeer het later opnieuw'
  }
});
app.use('/api/', limiter);

// Request logging
app.use(logRequest);

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Static files
app.use('/uploads', express.static('uploads'));

// Routes
app.use('/api/auth', require('./routes/auth'));
// app.use('/api/register', require('./routes/registration')); // Temporarily disabled
app.use('/api/users', require('./routes/users'));
app.use('/api/organizations', require('./routes/organizations'));
app.use('/api/news', require('./routes/news'));
app.use('/api/events', require('./routes/events'));
app.use('/api/found-lost', require('./routes/foundLost'));
app.use('/api/admin', require('./routes/admin'));

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
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

// Error handler
// Error handling middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Holwert Backend server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 API Base URL: ${process.env.API_BASE_URL || `http://localhost:${PORT}/api`}`);
});

module.exports = app;
