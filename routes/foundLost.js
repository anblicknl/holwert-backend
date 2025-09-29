const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all published found/lost items (public)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, type, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT f.id, f.type, f.title, f.description, f.location, f.contact_info, f.image, f.created_at,
             u.first_name, u.last_name
      FROM found_lost_items f
      JOIN users u ON f.reporter_id = u.id
      WHERE f.status = 'approved'
    `;
    const params = [];

    if (type && ['found', 'lost'].includes(type)) {
      query += ' AND f.type = ?';
      params.push(type);
    }

    if (search) {
      query += ' AND (f.title LIKE ? OR f.description LIKE ? OR f.location LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    query += ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [items] = await pool.execute(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM found_lost_items f 
      WHERE f.status = 'approved'
    `;
    const countParams = [];

    if (type && ['found', 'lost'].includes(type)) {
      countQuery += ' AND f.type = ?';
      countParams.push(type);
    }

    if (search) {
      countQuery += ' AND (f.title LIKE ? OR f.description LIKE ? OR f.location LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get found/lost items error:', error);
    res.status(500).json({ error: 'Failed to get found/lost items' });
  }
});

// Get single found/lost item (public)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [items] = await pool.execute(`
      SELECT f.*, u.first_name, u.last_name
      FROM found_lost_items f
      JOIN users u ON f.reporter_id = u.id
      WHERE f.id = ? AND f.status = 'approved'
    `, [id]);

    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    res.json(items[0]);

  } catch (error) {
    console.error('Get found/lost item error:', error);
    res.status(500).json({ error: 'Failed to get found/lost item' });
  }
});

// Create found/lost item (Authenticated users)
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { type, title, description, location, contactInfo, image } = req.body;
    const reporterId = req.user.id;

    // Validation
    if (!type || !title || !description) {
      return res.status(400).json({ 
        error: 'Type, title and description are required' 
      });
    }

    if (!['found', 'lost'].includes(type)) {
      return res.status(400).json({ 
        error: 'Type must be either "found" or "lost"' 
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO found_lost_items (type, title, description, location, contact_info, image, reporter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [type, title, description, location || null, contactInfo || null, image || null, reporterId, 'pending']
    );

    res.status(201).json({
      message: 'Found/lost item submitted successfully. It will be reviewed before publication.',
      itemId: result.insertId
    });

  } catch (error) {
    console.error('Create found/lost item error:', error);
    res.status(500).json({ error: 'Failed to create found/lost item' });
  }
});

// Update found/lost item (Owner only)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { type, title, description, location, contactInfo, image } = req.body;

    // Validation
    if (!type || !title || !description) {
      return res.status(400).json({ 
        error: 'Type, title and description are required' 
      });
    }

    if (!['found', 'lost'].includes(type)) {
      return res.status(400).json({ 
        error: 'Type must be either "found" or "lost"' 
      });
    }

    // Check if item exists and user has permission to edit
    const [items] = await pool.execute(
      'SELECT reporter_id, status FROM found_lost_items WHERE id = ?',
      [id]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = items[0];

    // Check permissions
    if (item.reporter_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only edit your own items' 
      });
    }

    // If item is already approved, it needs to go back to pending for review
    const newStatus = item.status === 'approved' ? 'pending' : item.status;

    await pool.execute(
      'UPDATE found_lost_items SET type = ?, title = ?, description = ?, location = ?, contact_info = ?, image = ?, status = ? WHERE id = ?',
      [type, title, description, location || null, contactInfo || null, image || null, newStatus, id]
    );

    res.json({ 
      message: newStatus === 'pending' 
        ? 'Item updated successfully. It will be reviewed again before publication.'
        : 'Item updated successfully'
    });

  } catch (error) {
    console.error('Update found/lost item error:', error);
    res.status(500).json({ error: 'Failed to update found/lost item' });
  }
});

// Delete found/lost item (Owner only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if item exists and user has permission to delete
    const [items] = await pool.execute(
      'SELECT reporter_id FROM found_lost_items WHERE id = ?',
      [id]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = items[0];

    // Check permissions
    if (item.reporter_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only delete your own items' 
      });
    }

    await pool.execute('DELETE FROM found_lost_items WHERE id = ?', [id]);

    res.json({ message: 'Item deleted successfully' });

  } catch (error) {
    console.error('Delete found/lost item error:', error);
    res.status(500).json({ error: 'Failed to delete found/lost item' });
  }
});

// Get user's found/lost items (Authenticated users)
router.get('/user/my-items', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    let query = `
      SELECT f.id, f.type, f.title, f.description, f.location, f.contact_info, f.image, f.status, f.created_at
      FROM found_lost_items f
      WHERE f.reporter_id = ?
    `;
    const params = [userId];

    if (status && ['pending', 'approved', 'rejected', 'resolved'].includes(status)) {
      query += ' AND f.status = ?';
      params.push(status);
    }

    query += ' ORDER BY f.created_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [items] = await pool.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM found_lost_items f WHERE f.reporter_id = ?';
    const countParams = [userId];

    if (status && ['pending', 'approved', 'rejected', 'resolved'].includes(status)) {
      countQuery += ' AND f.status = ?';
      countParams.push(status);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    res.json({
      items,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get user found/lost items error:', error);
    res.status(500).json({ error: 'Failed to get user found/lost items' });
  }
});

// Mark item as resolved (Owner only)
router.post('/:id/resolve', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if item exists and user has permission to resolve
    const [items] = await pool.execute(
      'SELECT reporter_id FROM found_lost_items WHERE id = ?',
      [id]
    );

    if (items.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }

    const item = items[0];

    // Check permissions
    if (item.reporter_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only resolve your own items' 
      });
    }

    await pool.execute(
      'UPDATE found_lost_items SET status = "resolved" WHERE id = ?',
      [id]
    );

    res.json({ message: 'Item marked as resolved successfully' });

  } catch (error) {
    console.error('Resolve found/lost item error:', error);
    res.status(500).json({ error: 'Failed to resolve found/lost item' });
  }
});

module.exports = router;
