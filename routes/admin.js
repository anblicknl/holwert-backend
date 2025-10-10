const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authenticateToken, requireSuperAdmin, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// All admin routes require authentication
router.use(authenticateToken);

// ==================== USER MANAGEMENT ====================

// Get all users (Superadmin only)
router.get('/users', requireSuperAdmin, async (req, res) => {
  try {
    const { page = 1, limit = 50, role, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.organization_id,
             u.profile_image, u.phone, u.is_active, u.email_verified, u.created_at,
             o.name as organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE 1=1
    `;
    const params = [];

    if (role) {
      query += ' AND u.role = ?';
      params.push(role);
    }

    if (search) {
      query += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY u.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await pool.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM users u WHERE 1=1';
    const countParams = [];

    if (role) {
      countQuery += ' AND u.role = ?';
      countParams.push(role);
    }

    if (search) {
      countQuery += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      users,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Create new user (Superadmin only)
router.post('/users', requireSuperAdmin, async (req, res) => {
  try {
    const { email, password, firstName, lastName, role, organizationId, phone, address } = req.body;

    // Validation
    if (!email || !password || !firstName || !lastName || !role) {
      return res.status(400).json({ 
        error: 'Email, password, first name, last name and role are required' 
      });
    }

    if (!['superadmin', 'admin', 'user'].includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role. Must be superadmin, admin, or user' 
      });
    }

    if (password.length < 6) {
      return res.status(400).json({ 
        error: 'Password must be at least 6 characters long' 
      });
    }

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'User with this email already exists' });
    }

    // If role is admin, organizationId is required
    if (role === 'admin' && !organizationId) {
      return res.status(400).json({ 
        error: 'Organization ID is required for admin users' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, first_name, last_name, role, organization_id, phone, address) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, firstName, lastName, role, organizationId || null, phone || null, address || null]
    );

    res.status(201).json({
      message: 'User created successfully',
      userId: result.insertId
    });

  } catch (error) {
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// Update user (Superadmin only)
router.put('/users/:userId', requireSuperAdmin, async (req, res) => {
  try {
    const { userId } = req.params;
    const { email, firstName, lastName, role, organizationId, phone, address, isActive } = req.body;

    // Validation
    if (!firstName || !lastName || !role) {
      return res.status(400).json({ 
        error: 'First name, last name and role are required' 
      });
    }

    if (!['superadmin', 'admin', 'user'].includes(role)) {
      return res.status(400).json({ 
        error: 'Invalid role. Must be superadmin, admin, or user' 
      });
    }

    // If role is admin, organizationId is required
    if (role === 'admin' && !organizationId) {
      return res.status(400).json({ 
        error: 'Organization ID is required for admin users' 
      });
    }

    await pool.execute(
      'UPDATE users SET email = ?, first_name = ?, last_name = ?, role = ?, organization_id = ?, phone = ?, address = ?, is_active = ? WHERE id = ?',
      [email, firstName, lastName, role, organizationId || null, phone || null, address || null, isActive, userId]
    );

    res.json({ message: 'User updated successfully' });

  } catch (error) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user (Superadmin only)
router.delete('/users/:userId', requireSuperAdmin, async (req, res) => {
  try {
    const { userId } = req.params;

    // Prevent deleting yourself
    if (parseInt(userId) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await pool.execute('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ message: 'User deleted successfully' });

  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ==================== ORGANIZATION MANAGEMENT ====================

// Get all organizations
router.get('/organizations', async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.*, COUNT(u.id) as user_count
      FROM organizations o
      LEFT JOIN users u ON o.id = u.organization_id AND u.is_active = true
      WHERE 1=1
    `;
    const params = [];

    if (category) {
      query += ' AND o.category = ?';
      params.push(category);
    }

    if (search) {
      query += ' AND o.name LIKE ?';
      params.push(`%${search}%`);
    }

    query += ' GROUP BY o.id ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [organizations] = await pool.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM organizations o WHERE 1=1';
    const countParams = [];

    if (category) {
      countQuery += ' AND o.category = ?';
      countParams.push(category);
    }

    if (search) {
      countQuery += ' AND o.name LIKE ?';
      countParams.push(`%${search}%`);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      organizations,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to get organizations' });
  }
});

// Create organization (Superadmin only)
router.post('/organizations', requireSuperAdmin, async (req, res) => {
  try {
    const { name, description, category, website, email, phone, address, logo_url, brand_color } = req.body;

    // Validation
    if (!name || !category) {
      return res.status(400).json({ 
        error: 'Name and category are required' 
      });
    }

    const validCategories = ['gemeente', 'natuur', 'cultuur', 'sport', 'onderwijs', 'zorg', 'overig'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category' 
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO organizations (name, description, category, website, email, phone, address, logo, brand_color) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description || null, category, website || null, email || null, phone || null, address || null, logo_url || null, brand_color || null]
    );

    res.status(201).json({
      message: 'Organization created successfully',
      organizationId: result.insertId
    });

  } catch (error) {
    console.error('Create organization error:', error);
    res.status(500).json({ error: 'Failed to create organization' });
  }
});

// Update organization (Superadmin only)
router.put('/organizations/:organizationId', requireSuperAdmin, async (req, res) => {
  try {
    const { organizationId } = req.params;
    const { name, description, category, website, email, phone, address, isActive } = req.body;

    // Validation
    if (!name || !category) {
      return res.status(400).json({ 
        error: 'Name and category are required' 
      });
    }

    const validCategories = ['gemeente', 'natuur', 'cultuur', 'sport', 'onderwijs', 'zorg', 'overig'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category' 
      });
    }

    await pool.execute(
      'UPDATE organizations SET name = ?, description = ?, category = ?, website = ?, email = ?, phone = ?, address = ?, is_active = ? WHERE id = ?',
      [name, description || null, category, website || null, email || null, phone || null, address || null, isActive, organizationId]
    );

    res.json({ message: 'Organization updated successfully' });

  } catch (error) {
    console.error('Update organization error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

// Get organization status (for debugging) - No auth required for testing
router.get('/organizations/:organizationId/status', async (req, res) => {
  try {
    const { organizationId } = req.params;

    const [orgs] = await pool.execute('SELECT id, name, is_active, is_approved FROM organizations WHERE id = ?', [organizationId]);
    if (orgs.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ organization: orgs[0] });

  } catch (error) {
    console.error('Get organization status error:', error);
    res.status(500).json({ error: 'Failed to get organization status' });
  }
});

// Simple approve organization route - No auth required for testing
router.post('/organizations/:organizationId/approve-simple', async (req, res) => {
  try {
    const { organizationId } = req.params;

    // Simple update to set is_active = true
    await pool.execute(
      'UPDATE organizations SET is_active = true WHERE id = ?',
      [organizationId]
    );

    res.json({ message: 'Organization approved successfully' });

  } catch (error) {
    console.error('Simple approve organization error:', error);
    res.status(500).json({ error: 'Failed to approve organization' });
  }
});

// Approve organization (Superadmin only)
router.post('/organizations/:organizationId/approve', requireSuperAdmin, async (req, res) => {
  try {
    const { organizationId } = req.params;

    // First check if organization exists
    const [orgs] = await pool.execute('SELECT id FROM organizations WHERE id = ?', [organizationId]);
    if (orgs.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Try to update with is_active first (this column definitely exists based on the organizations route)
    await pool.execute(
      'UPDATE organizations SET is_active = true WHERE id = ?',
      [organizationId]
    );

    res.json({ message: 'Organization approved successfully' });

  } catch (error) {
    console.error('Approve organization error:', error);
    res.status(500).json({ error: 'Failed to approve organization' });
  }
});

// Delete organization (Superadmin only)
router.delete('/organizations/:organizationId', requireSuperAdmin, async (req, res) => {
  try {
    const { organizationId } = req.params;

    // Check if organization has users
    const [users] = await pool.execute(
      'SELECT COUNT(*) as count FROM users WHERE organization_id = ?',
      [organizationId]
    );

    if (users[0].count > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete organization with active users. Please reassign users first.' 
      });
    }

    await pool.execute('DELETE FROM organizations WHERE id = ?', [organizationId]);

    res.json({ message: 'Organization deleted successfully' });

  } catch (error) {
    console.error('Delete organization error:', error);
    res.status(500).json({ error: 'Failed to delete organization' });
  }
});

// ==================== CONTENT MODERATION ====================

// Get pending content for approval (Superadmin only)
router.get('/moderation/pending', requireSuperAdmin, async (req, res) => {
  try {
    const { type, page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;

    let results = [];

    if (!type || type === 'news') {
      const [news] = await pool.execute(`
        SELECT 'news' as content_type, n.id, n.title, n.excerpt, n.created_at,
               u.first_name, u.last_name, o.name as organization_name
        FROM news_articles n
        JOIN users u ON n.author_id = u.id
        LEFT JOIN organizations o ON n.organization_id = o.id
        WHERE n.status = 'pending'
        ORDER BY n.created_at DESC
        LIMIT ? OFFSET ?
      `, [parseInt(limit), parseInt(offset)]);
      results = results.concat(news);
    }

    if (!type || type === 'events') {
      const [events] = await pool.execute(`
        SELECT 'event' as content_type, e.id, e.title, e.description, e.event_date, e.event_time, e.created_at,
               u.first_name, u.last_name, o.name as organization_name
        FROM events e
        JOIN users u ON e.organizer_id = u.id
        LEFT JOIN organizations o ON e.organization_id = o.id
        WHERE e.status = 'pending'
        ORDER BY e.created_at DESC
        LIMIT ? OFFSET ?
      `, [parseInt(limit), parseInt(offset)]);
      results = results.concat(events);
    }

    if (!type || type === 'found-lost') {
      const [foundLost] = await pool.execute(`
        SELECT 'found-lost' as content_type, f.id, f.title, f.description, f.type, f.created_at,
               u.first_name, u.last_name
        FROM found_lost_items f
        JOIN users u ON f.reporter_id = u.id
        WHERE f.status = 'pending'
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
      `, [parseInt(limit), parseInt(offset)]);
      results = results.concat(foundLost);
    }

    // Sort by creation date
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ pendingContent: results });

  } catch (error) {
    console.error('Get pending content error:', error);
    res.status(500).json({ error: 'Failed to get pending content' });
  }
});

// Approve content (Superadmin only)
router.post('/moderation/approve/:type/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;

    let tableName, statusField, publishedField;
    
    switch (type) {
      case 'news':
        tableName = 'news_articles';
        statusField = 'status';
        publishedField = 'published_at';
        break;
      case 'event':
        tableName = 'events';
        statusField = 'status';
        publishedField = 'published_at';
        break;
      case 'found-lost':
        tableName = 'found_lost_items';
        statusField = 'status';
        publishedField = 'approved_at';
        break;
      default:
        return res.status(400).json({ error: 'Invalid content type' });
    }

    await pool.execute(
      `UPDATE ${tableName} SET ${statusField} = 'published', ${publishedField} = NOW(), approved_by = ? WHERE id = ?`,
      [req.user.id, id]
    );

    res.json({ message: 'Content approved successfully' });

  } catch (error) {
    console.error('Approve content error:', error);
    res.status(500).json({ error: 'Failed to approve content' });
  }
});

// Reject content (Superadmin only)
router.post('/moderation/reject/:type/:id', requireSuperAdmin, async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    let tableName;
    
    switch (type) {
      case 'news':
        tableName = 'news_articles';
        break;
      case 'event':
        tableName = 'events';
        break;
      case 'found-lost':
        tableName = 'found_lost_items';
        break;
      default:
        return res.status(400).json({ error: 'Invalid content type' });
    }

    await pool.execute(
      `UPDATE ${tableName} SET status = 'rejected' WHERE id = ?`,
      [id]
    );

    res.json({ message: 'Content rejected successfully' });

  } catch (error) {
    console.error('Reject content error:', error);
    res.status(500).json({ error: 'Failed to reject content' });
  }
});

// ==================== DASHBOARD STATISTICS ====================

// Get dashboard statistics (Superadmin only)
router.get('/dashboard/stats', requireSuperAdmin, async (req, res) => {
  try {
    const [userStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_users,
        SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END) as regular_users,
        SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END) as admin_users,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_users
      FROM users
    `);

    const [orgStats] = await pool.execute(`
      SELECT 
        COUNT(*) as total_organizations,
        SUM(CASE WHEN is_active = true THEN 1 ELSE 0 END) as active_organizations
      FROM organizations
    `);

    const [contentStats] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM news_articles WHERE status = 'published') as published_news,
        (SELECT COUNT(*) FROM news_articles WHERE status = 'pending') as pending_news,
        (SELECT COUNT(*) FROM events WHERE status = 'published') as published_events,
        (SELECT COUNT(*) FROM events WHERE status = 'pending') as pending_events,
        (SELECT COUNT(*) FROM found_lost_items WHERE status = 'pending') as pending_found_lost
    `);

    res.json({
      users: userStats[0],
      organizations: orgStats[0],
      content: contentStats[0]
    });

  } catch (error) {
    console.error('Get dashboard stats error:', error);
    res.status(500).json({ error: 'Failed to get dashboard statistics' });
  }
});

module.exports = router;
