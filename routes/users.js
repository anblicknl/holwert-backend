const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin } = require('../middleware/auth');

const router = express.Router();

// Get user statistics (Authenticated users)
router.get('/stats', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    // Get user's content statistics
    const [newsStats] = await pool.execute(
      'SELECT COUNT(*) as total_articles FROM news_articles WHERE author_id = ?',
      [userId]
    );

    const [eventsStats] = await pool.execute(
      'SELECT COUNT(*) as total_events FROM events WHERE organizer_id = ?',
      [userId]
    );

    const [foundLostStats] = await pool.execute(
      'SELECT COUNT(*) as total_items FROM found_lost_items WHERE reporter_id = ?',
      [userId]
    );

    const [savedStats] = await pool.execute(
      'SELECT COUNT(*) as saved_articles FROM user_saved_articles WHERE user_id = ?',
      [userId]
    );

    const [followingStats] = await pool.execute(
      'SELECT COUNT(*) as following_organizations FROM user_follows_organization WHERE user_id = ?',
      [userId]
    );

    res.json({
      content: {
        articles: newsStats[0].total_articles,
        events: eventsStats[0].total_events,
        found_lost_items: foundLostStats[0].total_items
      },
      interactions: {
        saved_articles: savedStats[0].saved_articles,
        following_organizations: followingStats[0].following_organizations
      }
    });

  } catch (error) {
    console.error('Get user stats error:', error);
    res.status(500).json({ error: 'Failed to get user statistics' });
  }
});

// Get user's content (Authenticated users)
router.get('/my-content', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, type } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    let results = [];

    if (!type || type === 'news') {
      const [news] = await pool.execute(`
        SELECT 'news' as content_type, n.id, n.title, n.excerpt, n.status, n.created_at, n.published_at,
               o.name as organization_name
        FROM news_articles n
        LEFT JOIN organizations o ON n.organization_id = o.id
        WHERE n.author_id = ?
        ORDER BY n.created_at DESC
        LIMIT ? OFFSET ?
      `, [userId, parseInt(limit), parseInt(offset)]);
      results = results.concat(news);
    }

    if (!type || type === 'events') {
      const [events] = await pool.execute(`
        SELECT 'event' as content_type, e.id, e.title, e.description, e.event_date, e.event_time, e.status, e.created_at, e.published_at,
               o.name as organization_name
        FROM events e
        LEFT JOIN organizations o ON e.organization_id = o.id
        WHERE e.organizer_id = ?
        ORDER BY e.created_at DESC
        LIMIT ? OFFSET ?
      `, [userId, parseInt(limit), parseInt(offset)]);
      results = results.concat(events);
    }

    if (!type || type === 'found-lost') {
      const [foundLost] = await pool.execute(`
        SELECT 'found-lost' as content_type, f.id, f.title, f.description, f.type, f.status, f.created_at
        FROM found_lost_items f
        WHERE f.reporter_id = ?
        ORDER BY f.created_at DESC
        LIMIT ? OFFSET ?
      `, [userId, parseInt(limit), parseInt(offset)]);
      results = results.concat(foundLost);
    }

    // Sort by creation date
    results.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));

    res.json({ content: results });

  } catch (error) {
    console.error('Get user content error:', error);
    res.status(500).json({ error: 'Failed to get user content' });
  }
});

// Get user's activity feed (Authenticated users)
router.get('/activity', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    // Get recent activity from followed organizations
    const [activity] = await pool.execute(`
      SELECT 'news' as activity_type, n.id, n.title, n.excerpt, n.published_at, n.created_at,
             o.name as organization_name, o.logo as organization_logo
      FROM user_follows_organization ufo
      JOIN news_articles n ON ufo.organization_id = n.organization_id
      JOIN organizations o ON ufo.organization_id = o.id
      WHERE ufo.user_id = ? AND n.status = 'published'
      
      UNION ALL
      
      SELECT 'event' as activity_type, e.id, e.title, e.description as excerpt, e.published_at, e.created_at,
             o.name as organization_name, o.logo as organization_logo
      FROM user_follows_organization ufo
      JOIN events e ON ufo.organization_id = e.organization_id
      JOIN organizations o ON ufo.organization_id = o.id
      WHERE ufo.user_id = ? AND e.status = 'published'
      
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, userId, parseInt(limit), parseInt(offset)]);

    res.json({ activity });

  } catch (error) {
    console.error('Get user activity error:', error);
    res.status(500).json({ error: 'Failed to get user activity' });
  }
});

// Get user's notifications (Authenticated users)
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20, unread_only } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    // For now, we'll return a simple structure
    // In a full implementation, you'd have a notifications table
    const notifications = [
      {
        id: 1,
        type: 'content_approved',
        title: 'Je nieuwsbericht is goedgekeurd',
        message: 'Je artikel "Dorpsvergadering" is gepubliceerd.',
        is_read: false,
        created_at: new Date().toISOString()
      },
      {
        id: 2,
        type: 'event_reminder',
        title: 'Evenement herinnering',
        message: 'De dorpsvergadering is morgen om 19:30.',
        is_read: true,
        created_at: new Date(Date.now() - 86400000).toISOString()
      }
    ];

    const filteredNotifications = unread_only === 'true' 
      ? notifications.filter(n => !n.is_read)
      : notifications;

    res.json({ 
      notifications: filteredNotifications.slice(offset, offset + parseInt(limit)),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: filteredNotifications.length,
        pages: Math.ceil(filteredNotifications.length / limit)
      }
    });

  } catch (error) {
    console.error('Get user notifications error:', error);
    res.status(500).json({ error: 'Failed to get user notifications' });
  }
});

// Mark notification as read (Authenticated users)
router.put('/notifications/:id/read', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // In a full implementation, you'd update the notifications table
    // For now, we'll just return success
    res.json({ message: 'Notification marked as read' });

  } catch (error) {
    console.error('Mark notification as read error:', error);
    res.status(500).json({ error: 'Failed to mark notification as read' });
  }
});

// Get user's organization (if admin)
router.get('/my-organization', authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    if (req.user.role !== 'admin' && req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Access denied' });
    }

    const [organizations] = await pool.execute(`
      SELECT o.*, COUNT(u.id) as user_count
      FROM organizations o
      LEFT JOIN users u ON o.id = u.organization_id AND u.is_active = true
      WHERE o.id = ?
      GROUP BY o.id
    `, [req.user.organization_id]);

    if (organizations.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    res.json({ organization: organizations[0] });

  } catch (error) {
    console.error('Get user organization error:', error);
    res.status(500).json({ error: 'Failed to get user organization' });
  }
});

// Update user's organization (Admin only)
router.put('/my-organization', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, description, website, email, phone, address } = req.body;
    const organizationId = req.user.organization_id;

    if (!organizationId) {
      return res.status(400).json({ error: 'User is not associated with an organization' });
    }

    await pool.execute(
      'UPDATE organizations SET name = ?, description = ?, website = ?, email = ?, phone = ?, address = ? WHERE id = ?',
      [name, description || null, website || null, email || null, phone || null, address || null, organizationId]
    );

    res.json({ message: 'Organization updated successfully' });

  } catch (error) {
    console.error('Update user organization error:', error);
    res.status(500).json({ error: 'Failed to update organization' });
  }
});

module.exports = router;
