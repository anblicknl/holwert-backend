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

// Error handler
// Error handling middleware
app.use(errorHandler);

app.listen(PORT, () => {
  console.log(`🚀 Holwert Backend server running on port ${PORT}`);
  console.log(`📱 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 API Base URL: ${process.env.API_BASE_URL || `http://localhost:${PORT}/api`}`);
});

module.exports = app;
