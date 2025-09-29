const winston = require('winston');
const path = require('path');

// Define log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  debug: 4,
};

// Define colors for each level
const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  debug: 'white',
};

// Tell winston that you want to link the colors
winston.addColors(colors);

// Define which logs to print based on environment
const level = () => {
  const env = process.env.NODE_ENV || 'development';
  const isDevelopment = env === 'development';
  return isDevelopment ? 'debug' : 'warn';
};

// Define different log formats
const format = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss:ms' }),
  winston.format.colorize({ all: true }),
  winston.format.printf(
    (info) => `${info.timestamp} ${info.level}: ${info.message}`,
  ),
);

// Define transports
const transports = [
  // Console transport
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.simple()
    )
  }),
  
  // File transport for errors
  new winston.transports.File({
    filename: path.join('logs', 'error.log'),
    level: 'error',
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
  
  // File transport for all logs
  new winston.transports.File({
    filename: path.join('logs', 'combined.log'),
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json()
    )
  }),
];

// Create the logger
const logger = winston.createLogger({
  level: level(),
  levels,
  format,
  transports,
  exitOnError: false,
});

// Create logs directory if it doesn't exist
const fs = require('fs');
const logsDir = 'logs';
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir);
}

// Custom logging methods
const logRequest = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    const logData = {
      method: req.method,
      url: req.originalUrl,
      status: res.statusCode,
      duration: `${duration}ms`,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous'
    };

    if (res.statusCode >= 400) {
      logger.error(`HTTP ${res.statusCode} - ${req.method} ${req.originalUrl}`, logData);
    } else {
      logger.http(`HTTP ${res.statusCode} - ${req.method} ${req.originalUrl}`, logData);
    }
  });

  next();
};

const logError = (error, req = null, additionalInfo = {}) => {
  const errorData = {
    message: error.message,
    stack: error.stack,
    ...additionalInfo
  };

  if (req) {
    errorData.request = {
      method: req.method,
      url: req.originalUrl,
      body: req.body,
      params: req.params,
      query: req.query,
      ip: req.ip || req.connection.remoteAddress,
      userAgent: req.get('User-Agent'),
      userId: req.user?.id || 'anonymous'
    };
  }

  logger.error('Application Error', errorData);
};

const logDatabaseError = (error, query = null, params = null) => {
  const errorData = {
    message: error.message,
    code: error.code,
    errno: error.errno,
    sqlState: error.sqlState,
    sqlMessage: error.sqlMessage
  };

  if (query) {
    errorData.query = query;
  }

  if (params) {
    errorData.params = params;
  }

  logger.error('Database Error', errorData);
};

const logSecurityEvent = (event, req, additionalInfo = {}) => {
  const securityData = {
    event,
    ip: req.ip || req.connection.remoteAddress,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id || 'anonymous',
    ...additionalInfo
  };

  logger.warn('Security Event', securityData);
};

const logImageUpload = (req, result, error = null) => {
  const uploadData = {
    userId: req.user?.id || 'anonymous',
    ip: req.ip || req.connection.remoteAddress,
    files: req.files?.length || 0,
    result: result ? 'success' : 'failed'
  };

  if (error) {
    uploadData.error = error.message;
    logger.error('Image Upload Failed', uploadData);
  } else {
    uploadData.processedImages = result?.length || 0;
    logger.info('Image Upload Success', uploadData);
  }
};

const logUserAction = (action, userId, additionalInfo = {}) => {
  const actionData = {
    action,
    userId,
    timestamp: new Date().toISOString(),
    ...additionalInfo
  };

  logger.info('User Action', actionData);
};

const logSystemEvent = (event, additionalInfo = {}) => {
  const eventData = {
    event,
    timestamp: new Date().toISOString(),
    ...additionalInfo
  };

  logger.info('System Event', eventData);
};

// Performance monitoring
const logPerformance = (operation, duration, additionalInfo = {}) => {
  const perfData = {
    operation,
    duration: `${duration}ms`,
    timestamp: new Date().toISOString(),
    ...additionalInfo
  };

  if (duration > 1000) {
    logger.warn('Slow Operation', perfData);
  } else {
    logger.debug('Performance', perfData);
  }
};

// Error handling middleware
const errorHandler = (error, req, res, next) => {
  logError(error, req);

  // Don't leak error details in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const response = {
    error: 'Er is een fout opgetreden',
    ...(isDevelopment && { 
      message: error.message,
      stack: error.stack 
    })
  };

  // Handle specific error types
  if (error.name === 'ValidationError') {
    response.error = 'Validatiefout';
    response.details = error.details;
    return res.status(400).json(response);
  }

  if (error.name === 'UnauthorizedError') {
    response.error = 'Niet geautoriseerd';
    return res.status(401).json(response);
  }

  if (error.name === 'ForbiddenError') {
    response.error = 'Toegang geweigerd';
    return res.status(403).json(response);
  }

  if (error.name === 'NotFoundError') {
    response.error = 'Niet gevonden';
    return res.status(404).json(response);
  }

  // Default to 500
  res.status(500).json(response);
};

module.exports = {
  logger,
  logRequest,
  logError,
  logDatabaseError,
  logSecurityEvent,
  logImageUpload,
  logUserAction,
  logSystemEvent,
  logPerformance,
  errorHandler
};
