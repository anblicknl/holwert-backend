const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');

// Verify JWT token
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    
    // Get user from database to ensure they still exist and are active
    const [users] = await pool.execute(
      'SELECT id, email, first_name, last_name, role, organization_id, is_active FROM users WHERE id = ? AND is_active = true',
      [decoded.userId]
    );

    if (users.length === 0) {
      return res.status(401).json({ error: 'User not found or inactive' });
    }

    req.user = users[0];
    next();
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    } else if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    return res.status(500).json({ error: 'Token verification failed' });
  }
};

// Check if user has required role
const requireRole = (roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const userRole = req.user.role;
    const allowedRoles = Array.isArray(roles) ? roles : [roles];

    if (!allowedRoles.includes(userRole)) {
      return res.status(403).json({ 
        error: 'Insufficient permissions',
        required: allowedRoles,
        current: userRole
      });
    }

    next();
  };
};

// Check if user is superadmin
const requireSuperAdmin = requireRole('superadmin');

// Check if user is admin or superadmin
const requireAdmin = requireRole(['admin', 'superadmin']);

// Check if user can access organization content
const requireOrganizationAccess = async (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  // Superadmin can access everything
  if (req.user.role === 'superadmin') {
    return next();
  }

  // Admin can only access their own organization
  if (req.user.role === 'admin') {
    const organizationId = req.params.organizationId || req.body.organization_id;
    
    if (organizationId && req.user.organization_id !== parseInt(organizationId)) {
      return res.status(403).json({ error: 'Access denied to this organization' });
    }
  }

  next();
};

// Optional authentication (for public endpoints that can benefit from user context)
const optionalAuth = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    req.user = null;
    return next();
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const [users] = await pool.execute(
      'SELECT id, email, first_name, last_name, role, organization_id, is_active FROM users WHERE id = ? AND is_active = true',
      [decoded.userId]
    );

    req.user = users.length > 0 ? users[0] : null;
  } catch (error) {
    req.user = null;
  }

  next();
};

module.exports = {
  authenticateToken,
  requireRole,
  requireSuperAdmin,
  requireAdmin,
  requireOrganizationAccess,
  optionalAuth
};
