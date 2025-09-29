const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { authenticateToken, requireSuperAdmin, requireAdmin } = require('../middleware/auth');
const { upload, processImageSizes, deleteImageSizes } = require('../utils/imageUpload');
const { validationRules, validateWithJoi, schemas, sanitizeInput } = require('../utils/validation');
const { logError, logDatabaseError, logUserAction, logImageUpload, logPerformance } = require('../utils/logger');

const router = express.Router();

// Apply middleware
router.use(authenticateToken);
router.use(sanitizeInput);

// ==================== DASHBOARD STATISTICS ====================

// Get dashboard statistics
router.get('/stats', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const [stats] = await pool.execute(`
      SELECT 
        (SELECT COUNT(*) FROM users WHERE is_active = 1) as totalUsers,
        (SELECT COUNT(*) FROM organizations WHERE is_active = 1) as totalOrganizations,
        (SELECT COUNT(*) FROM news WHERE is_published = 1) as totalNews,
        (SELECT COUNT(*) FROM events WHERE start_date >= CURDATE()) as totalEvents,
        (SELECT COUNT(*) FROM found_lost WHERE is_resolved = 0) as totalFoundLost,
        (SELECT COUNT(*) FROM news WHERE is_published = 0) as pendingNews,
        (SELECT COUNT(*) FROM events WHERE is_approved = 0) as pendingEvents,
        (SELECT COUNT(*) FROM found_lost WHERE is_approved = 0) as pendingFoundLost
    `);

    const [recentActivity] = await pool.execute(`
      SELECT 
        'user' as type,
        CONCAT(first_name, ' ', last_name) as title,
        'Nieuwe gebruiker geregistreerd' as description,
        created_at as timestamp
      FROM users 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      UNION ALL
      
      SELECT 
        'news' as type,
        title,
        'Nieuw nieuwsartikel' as description,
        created_at as timestamp
      FROM news 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      UNION ALL
      
      SELECT 
        'event' as type,
        title,
        'Nieuw evenement' as description,
        created_at as timestamp
      FROM events 
      WHERE created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY)
      
      ORDER BY timestamp DESC 
      LIMIT 10
    `);

    const [pendingContent] = await pool.execute(`
      SELECT 
        'news' as type,
        id,
        title,
        'Nieuwsartikel wacht op goedkeuring' as description,
        created_at as timestamp,
        (SELECT name FROM organizations WHERE id = news.organization_id) as organization_name
      FROM news 
      WHERE is_published = 0
      
      UNION ALL
      
      SELECT 
        'event' as type,
        id,
        title,
        'Evenement wacht op goedkeuring' as description,
        created_at as timestamp,
        (SELECT name FROM organizations WHERE id = events.organization_id) as organization_name
      FROM events 
      WHERE is_approved = 0
      
      UNION ALL
      
      SELECT 
        'found_lost' as type,
        id,
        title,
        CONCAT(IF(type = 'found', 'Gevonden: ', 'Verloren: '), title) as description,
        created_at as timestamp,
        NULL as organization_name
      FROM found_lost 
      WHERE is_approved = 0
      
      ORDER BY timestamp DESC 
      LIMIT 10
    `);

    logPerformance('dashboard_stats', Date.now() - startTime);

    res.json({
      statistics: stats[0],
      recentActivity,
      pendingContent
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Failed to get dashboard statistics' });
  }
});

// ==================== USER MANAGEMENT ====================

// Get all users with advanced filtering
router.get('/users', requireSuperAdmin, validationRules.pagination, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { page = 1, limit = 50, role, search, organizationId, isActive, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.organization_id,
             u.profile_image, u.phone, u.is_active, u.email_verified, u.created_at, u.last_login,
             o.name as organization_name, o.type as organization_type
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

    if (organizationId) {
      query += ' AND u.organization_id = ?';
      params.push(organizationId);
    }

    if (isActive !== undefined) {
      query += ' AND u.is_active = ?';
      params.push(isActive === 'true' ? 1 : 0);
    }

    // Validate sortBy to prevent SQL injection
    const allowedSortFields = ['created_at', 'last_login', 'first_name', 'last_name', 'email'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY u.${sortField} ${sortDirection} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [users] = await pool.execute(query, params);

    // Get total count with same filters
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

    if (organizationId) {
      countQuery += ' AND u.organization_id = ?';
      countParams.push(organizationId);
    }

    if (isActive !== undefined) {
      countQuery += ' AND u.is_active = ?';
      countParams.push(isActive === 'true' ? 1 : 0);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    logPerformance('get_users', Date.now() - startTime, { count: users.length });

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
    logDatabaseError(error);
    res.status(500).json({ error: 'Failed to get users' });
  }
});

// Create new user with profile image upload
router.post('/users', requireSuperAdmin, upload.single('profileImage'), validationRules.createUser, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { email, password, firstName, lastName, role, organizationId, phone, address } = req.body;

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'Gebruiker met dit e-mailadres bestaat al' });
    }

    // If role is admin, organizationId is required
    if (role === 'admin' && !organizationId) {
      return res.status(400).json({ 
        error: 'Organisatie ID is vereist voor admin gebruikers' 
      });
    }

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    let profileImageData = null;

    // Process profile image if uploaded
    if (req.file) {
      try {
        profileImageData = await processImageSizes(req.file.buffer, req.file.originalname, 'profile');
        logImageUpload(req, profileImageData);
      } catch (imageError) {
        logError(imageError, req);
        return res.status(400).json({ error: 'Fout bij verwerken van profielfoto' });
      }
    }

    // Create user
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, first_name, last_name, role, organization_id, phone, address, profile_image) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        email, 
        hashedPassword, 
        firstName, 
        lastName, 
        role, 
        organizationId || null, 
        phone || null, 
        address || null,
        profileImageData ? JSON.stringify(profileImageData) : null
      ]
    );

    logUserAction('create_user', req.user.id, { 
      newUserId: result.insertId, 
      role,
      organizationId 
    });

    logPerformance('create_user', Date.now() - startTime);

    res.status(201).json({
      message: 'Gebruiker succesvol aangemaakt',
      userId: result.insertId
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij aanmaken van gebruiker' });
  }
});

// Update user with profile image
router.put('/users/:id', requireSuperAdmin, upload.single('profileImage'), validationRules.updateUser, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { email, firstName, lastName, role, organizationId, phone, address, isActive } = req.body;

    // Get current user data
    const [currentUser] = await pool.execute(
      'SELECT profile_image FROM users WHERE id = ?',
      [id]
    );

    if (currentUser.length === 0) {
      return res.status(404).json({ error: 'Gebruiker niet gevonden' });
    }

    let profileImageData = null;

    // Process new profile image if uploaded
    if (req.file) {
      try {
        // Delete old images
        if (currentUser[0].profile_image) {
          const oldImageData = JSON.parse(currentUser[0].profile_image);
          await deleteImageSizes(oldImageData);
        }

        profileImageData = await processImageSizes(req.file.buffer, req.file.originalname, 'profile');
        logImageUpload(req, profileImageData);
      } catch (imageError) {
        logError(imageError, req);
        return res.status(400).json({ error: 'Fout bij verwerken van profielfoto' });
      }
    }

    // Update user
    const updateFields = ['email = ?', 'first_name = ?', 'last_name = ?', 'role = ?', 'organization_id = ?', 'phone = ?', 'address = ?', 'is_active = ?'];
    const updateValues = [email, firstName, lastName, role, organizationId || null, phone || null, address || null, isActive];

    if (profileImageData) {
      updateFields.push('profile_image = ?');
      updateValues.push(JSON.stringify(profileImageData));
    }

    updateValues.push(id);

    await pool.execute(
      `UPDATE users SET ${updateFields.join(', ')} WHERE id = ?`,
      updateValues
    );

    logUserAction('update_user', req.user.id, { 
      targetUserId: id, 
      role,
      organizationId 
    });

    logPerformance('update_user', Date.now() - startTime);

    res.json({ message: 'Gebruiker succesvol bijgewerkt' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij bijwerken van gebruiker' });
  }
});

// Delete user
router.delete('/users/:id', requireSuperAdmin, validationRules.idParam, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Je kunt je eigen account niet verwijderen' });
    }

    // Get user data to delete profile image
    const [user] = await pool.execute(
      'SELECT profile_image FROM users WHERE id = ?',
      [id]
    );

    if (user.length === 0) {
      return res.status(404).json({ error: 'Gebruiker niet gevonden' });
    }

    // Delete profile image files
    if (user[0].profile_image) {
      try {
        const imageData = JSON.parse(user[0].profile_image);
        await deleteImageSizes(imageData);
      } catch (imageError) {
        logError(imageError, req);
      }
    }

    await pool.execute('DELETE FROM users WHERE id = ?', [id]);

    logUserAction('delete_user', req.user.id, { targetUserId: id });
    logPerformance('delete_user', Date.now() - startTime);

    res.json({ message: 'Gebruiker succesvol verwijderd' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij verwijderen van gebruiker' });
  }
});

// ==================== ORGANIZATION MANAGEMENT ====================

// Get all organizations
router.get('/organizations', validationRules.pagination, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { page = 1, limit = 50, type, search, isActive, sortBy = 'created_at', sortOrder = 'DESC' } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.id, o.name, o.description, o.type, o.email, o.phone, o.website, 
             o.address, o.logo, o.is_active, o.created_at,
             COUNT(u.id) as user_count
      FROM organizations o
      LEFT JOIN users u ON o.id = u.organization_id AND u.is_active = 1
      WHERE 1=1
    `;
    const params = [];

    if (type) {
      query += ' AND o.type = ?';
      params.push(type);
    }

    if (search) {
      query += ' AND (o.name LIKE ? OR o.description LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    if (isActive !== undefined) {
      query += ' AND o.is_active = ?';
      params.push(isActive === 'true' ? 1 : 0);
    }

    query += ' GROUP BY o.id';

    // Validate sortBy
    const allowedSortFields = ['created_at', 'name', 'type', 'user_count'];
    const sortField = allowedSortFields.includes(sortBy) ? sortBy : 'created_at';
    const sortDirection = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    query += ` ORDER BY ${sortField} ${sortDirection} LIMIT ? OFFSET ?`;
    params.push(parseInt(limit), parseInt(offset));

    const [organizations] = await pool.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM organizations o WHERE 1=1';
    const countParams = [];

    if (type) {
      countQuery += ' AND o.type = ?';
      countParams.push(type);
    }

    if (search) {
      countQuery += ' AND (o.name LIKE ? OR o.description LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm);
    }

    if (isActive !== undefined) {
      countQuery += ' AND o.is_active = ?';
      countParams.push(isActive === 'true' ? 1 : 0);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    logPerformance('get_organizations', Date.now() - startTime, { count: organizations.length });

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
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij ophalen van organisaties' });
  }
});

// Create organization with logo upload
router.post('/organizations', upload.single('logo'), validationRules.createOrganization, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { name, description, type, email, phone, website, address } = req.body;

    // Check if organization already exists
    const [existingOrgs] = await pool.execute(
      'SELECT id FROM organizations WHERE name = ?',
      [name]
    );

    if (existingOrgs.length > 0) {
      return res.status(409).json({ error: 'Organisatie met deze naam bestaat al' });
    }

    let logoData = null;

    // Process logo if uploaded
    if (req.file) {
      try {
        logoData = await processImageSizes(req.file.buffer, req.file.originalname, 'organization');
        logImageUpload(req, logoData);
      } catch (imageError) {
        logError(imageError, req);
        return res.status(400).json({ error: 'Fout bij verwerken van logo' });
      }
    }

    // Create organization
    const [result] = await pool.execute(
      'INSERT INTO organizations (name, description, type, email, phone, website, address, logo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [name, description || null, type, email || null, phone || null, website || null, address || null, logoData ? JSON.stringify(logoData) : null]
    );

    logUserAction('create_organization', req.user.id, { 
      organizationId: result.insertId, 
      type 
    });

    logPerformance('create_organization', Date.now() - startTime);

    res.status(201).json({
      message: 'Organisatie succesvol aangemaakt',
      organizationId: result.insertId
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij aanmaken van organisatie' });
  }
});

// ==================== CONTENT MODERATION ====================

// Approve content
router.post('/moderate/approve/:type/:id', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    if (!['news', 'event', 'found_lost'].includes(type)) {
      return res.status(400).json({ error: 'Ongeldig content type' });
    }

    let tableName, statusField;
    switch (type) {
      case 'news':
        tableName = 'news';
        statusField = 'is_published';
        break;
      case 'event':
        tableName = 'events';
        statusField = 'is_approved';
        break;
      case 'found_lost':
        tableName = 'found_lost';
        statusField = 'is_approved';
        break;
    }

    // Update content status
    await pool.execute(
      `UPDATE ${tableName} SET ${statusField} = 1, approved_at = NOW(), approved_by = ? WHERE id = ?`,
      [req.user.id, id]
    );

    logUserAction('approve_content', req.user.id, { 
      contentType: type, 
      contentId: id,
      reason 
    });

    logPerformance('approve_content', Date.now() - startTime);

    res.json({ message: 'Content succesvol goedgekeurd' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij goedkeuren van content' });
  }
});

// Reject content
router.post('/moderate/reject/:type/:id', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Reden voor afwijzing is vereist (minimaal 5 karakters)' });
    }

    if (!['news', 'event', 'found_lost'].includes(type)) {
      return res.status(400).json({ error: 'Ongeldig content type' });
    }

    let tableName, statusField;
    switch (type) {
      case 'news':
        tableName = 'news';
        statusField = 'is_published';
        break;
      case 'event':
        tableName = 'events';
        statusField = 'is_approved';
        break;
      case 'found_lost':
        tableName = 'found_lost';
        statusField = 'is_approved';
        break;
    }

    // Update content status and add rejection reason
    await pool.execute(
      `UPDATE ${tableName} SET ${statusField} = 0, rejection_reason = ?, rejected_at = NOW(), rejected_by = ? WHERE id = ?`,
      [reason, req.user.id, id]
    );

    logUserAction('reject_content', req.user.id, { 
      contentType: type, 
      contentId: id,
      reason 
    });

    logPerformance('reject_content', Date.now() - startTime);

    res.json({ message: 'Content succesvol afgewezen' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij afwijzen van content' });
  }
});

// ==================== BULK OPERATIONS ====================

// Bulk approve content
router.post('/moderate/bulk-approve', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { items } = req.body; // Array of {type, id}

    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Items array is vereist' });
    }

    const results = { success: 0, failed: 0, errors: [] };

    for (const item of items) {
      try {
        const { type, id } = item;

        if (!['news', 'event', 'found_lost'].includes(type)) {
          results.failed++;
          results.errors.push({ id, type, error: 'Ongeldig content type' });
          continue;
        }

        let tableName, statusField;
        switch (type) {
          case 'news':
            tableName = 'news';
            statusField = 'is_published';
            break;
          case 'event':
            tableName = 'events';
            statusField = 'is_approved';
            break;
          case 'found_lost':
            tableName = 'found_lost';
            statusField = 'is_approved';
            break;
        }

        await pool.execute(
          `UPDATE ${tableName} SET ${statusField} = 1, approved_at = NOW(), approved_by = ? WHERE id = ?`,
          [req.user.id, id]
        );

        results.success++;
      } catch (error) {
        results.failed++;
        results.errors.push({ id: item.id, type: item.type, error: error.message });
      }
    }

    logUserAction('bulk_approve_content', req.user.id, { 
      totalItems: items.length,
      successCount: results.success,
      failedCount: results.failed
    });

    logPerformance('bulk_approve_content', Date.now() - startTime, { 
      itemCount: items.length 
    });

    res.json({
      message: `Bulk goedkeuring voltooid: ${results.success} succesvol, ${results.failed} gefaald`,
      results
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij bulk goedkeuring' });
  }
});

// ==================== SEARCH FUNCTIONALITY ====================

// Global search across all content types
router.get('/search', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { q: query, type, limit = 20 } = req.query;

    if (!query || query.trim().length < 2) {
      return res.status(400).json({ error: 'Zoekterm moet minimaal 2 karakters bevatten' });
    }

    const searchTerm = `%${query.trim()}%`;
    const results = { users: [], organizations: [], news: [], events: [], foundLost: [] };

    // Search users
    if (!type || type === 'users') {
      const [users] = await pool.execute(`
        SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.is_active,
               o.name as organization_name
        FROM users u
        LEFT JOIN organizations o ON u.organization_id = o.id
        WHERE (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ?)
        AND u.is_active = 1
        LIMIT ?
      `, [searchTerm, searchTerm, searchTerm, parseInt(limit)]);
      results.users = users;
    }

    // Search organizations
    if (!type || type === 'organizations') {
      const [organizations] = await pool.execute(`
        SELECT id, name, description, type, is_active
        FROM organizations
        WHERE (name LIKE ? OR description LIKE ?)
        AND is_active = 1
        LIMIT ?
      `, [searchTerm, searchTerm, parseInt(limit)]);
      results.organizations = organizations;
    }

    // Search news
    if (!type || type === 'news') {
      const [news] = await pool.execute(`
        SELECT n.id, n.title, n.excerpt, n.category, n.is_published, n.created_at,
               o.name as organization_name
        FROM news n
        LEFT JOIN organizations o ON n.organization_id = o.id
        WHERE (n.title LIKE ? OR n.content LIKE ? OR n.excerpt LIKE ?)
        LIMIT ?
      `, [searchTerm, searchTerm, searchTerm, parseInt(limit)]);
      results.news = news;
    }

    // Search events
    if (!type || type === 'events') {
      const [events] = await pool.execute(`
        SELECT e.id, e.title, e.description, e.location, e.start_date, e.is_approved,
               o.name as organization_name
        FROM events e
        LEFT JOIN organizations o ON e.organization_id = o.id
        WHERE (e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)
        LIMIT ?
      `, [searchTerm, searchTerm, searchTerm, parseInt(limit)]);
      results.events = events;
    }

    // Search found/lost items
    if (!type || type === 'found_lost') {
      const [foundLost] = await pool.execute(`
        SELECT id, type, title, description, category, location, is_resolved, created_at
        FROM found_lost
        WHERE (title LIKE ? OR description LIKE ? OR location LIKE ?)
        LIMIT ?
      `, [searchTerm, searchTerm, searchTerm, parseInt(limit)]);
      results.foundLost = foundLost;
    }

    logPerformance('global_search', Date.now() - startTime, { 
      query: query.trim(),
      type,
      totalResults: Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
    });

    res.json({
      query: query.trim(),
      results,
      totalResults: Object.values(results).reduce((sum, arr) => sum + arr.length, 0)
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij zoeken' });
  }
});

module.exports = router;
