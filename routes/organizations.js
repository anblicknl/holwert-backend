const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all active organizations (public)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT o.id, o.name, o.description, o.category, o.logo, o.website, o.email, o.phone, o.address,
             COUNT(u.id) as follower_count
      FROM organizations o
      LEFT JOIN user_follows_organization ufo ON o.id = ufo.organization_id
      LEFT JOIN users u ON ufo.user_id = u.id AND u.is_active = true
      WHERE o.is_active = true
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

    query += ' GROUP BY o.id ORDER BY o.name ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [organizations] = await pool.execute(query, params);

    // Get total count
    let countQuery = 'SELECT COUNT(*) as total FROM organizations o WHERE o.is_active = true';
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

    // Check if user is following any of these organizations
    let followingOrganizations = [];
    if (req.user) {
      const orgIds = organizations.map(org => org.id);
      if (orgIds.length > 0) {
        const [following] = await pool.execute(
          'SELECT organization_id FROM user_follows_organization WHERE user_id = ? AND organization_id IN (' + orgIds.map(() => '?').join(',') + ')',
          [req.user.id, ...orgIds]
        );
        followingOrganizations = following.map(item => item.organization_id);
      }
    }

    // Add following status to organizations
    const organizationsWithFollowingStatus = organizations.map(org => ({
      ...org,
      is_following: followingOrganizations.includes(org.id)
    }));

    res.json({
      organizations: organizationsWithFollowingStatus,
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

// Get single organization (public)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [organizations] = await pool.execute(`
      SELECT o.*, COUNT(ufo.user_id) as follower_count
      FROM organizations o
      LEFT JOIN user_follows_organization ufo ON o.id = ufo.organization_id
      LEFT JOIN users u ON ufo.user_id = u.id AND u.is_active = true
      WHERE o.id = ? AND o.is_active = true
      GROUP BY o.id
    `, [id]);

    if (organizations.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    const organization = organizations[0];

    // Check if user is following this organization
    let isFollowing = false;
    if (req.user) {
      const [following] = await pool.execute(
        'SELECT id FROM user_follows_organization WHERE user_id = ? AND organization_id = ?',
        [req.user.id, id]
      );
      isFollowing = following.length > 0;
    }

    // Get recent news articles from this organization
    const [recentNews] = await pool.execute(`
      SELECT n.id, n.title, n.excerpt, n.image, n.published_at
      FROM news_articles n
      WHERE n.organization_id = ? AND n.status = 'published'
      ORDER BY n.published_at DESC
      LIMIT 5
    `, [id]);

    // Get upcoming events from this organization
    const [upcomingEvents] = await pool.execute(`
      SELECT e.id, e.title, e.event_date, e.event_time, e.location, e.category
      FROM events e
      WHERE e.organization_id = ? AND e.status = 'published' 
        AND (e.event_date > CURDATE() OR (e.event_date = CURDATE() AND e.event_time > CURTIME()))
      ORDER BY e.event_date ASC, e.event_time ASC
      LIMIT 5
    `, [id]);

    res.json({
      ...organization,
      is_following: isFollowing,
      recent_news: recentNews,
      upcoming_events: upcomingEvents
    });

  } catch (error) {
    console.error('Get organization error:', error);
    res.status(500).json({ error: 'Failed to get organization' });
  }
});

// Follow/unfollow organization (Authenticated users)
router.post('/:id/follow', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if organization exists
    const [organizations] = await pool.execute(
      'SELECT id FROM organizations WHERE id = ? AND is_active = true',
      [id]
    );

    if (organizations.length === 0) {
      return res.status(404).json({ error: 'Organization not found' });
    }

    // Check if user is already following
    const [existing] = await pool.execute(
      'SELECT id FROM user_follows_organization WHERE user_id = ? AND organization_id = ?',
      [userId, id]
    );

    if (existing.length > 0) {
      // Unfollow
      await pool.execute(
        'DELETE FROM user_follows_organization WHERE user_id = ? AND organization_id = ?',
        [userId, id]
      );
      res.json({ message: 'Organization unfollowed successfully', is_following: false });
    } else {
      // Follow
      await pool.execute(
        'INSERT INTO user_follows_organization (user_id, organization_id) VALUES (?, ?)',
        [userId, id]
      );
      res.json({ message: 'Organization followed successfully', is_following: true });
    }

  } catch (error) {
    console.error('Follow/unfollow organization error:', error);
    res.status(500).json({ error: 'Failed to follow/unfollow organization' });
  }
});

// Get user's followed organizations (Authenticated users)
router.get('/user/following', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    const [organizations] = await pool.execute(`
      SELECT o.id, o.name, o.description, o.category, o.logo, o.website, o.email, o.phone, o.address,
             ufo.created_at as followed_at
      FROM user_follows_organization ufo
      JOIN organizations o ON ufo.organization_id = o.id
      WHERE ufo.user_id = ? AND o.is_active = true
      ORDER BY ufo.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM user_follows_organization ufo JOIN organizations o ON ufo.organization_id = o.id WHERE ufo.user_id = ? AND o.is_active = true',
      [userId]
    );
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
    console.error('Get followed organizations error:', error);
    res.status(500).json({ error: 'Failed to get followed organizations' });
  }
});

// Get organization categories (public)
router.get('/categories/list', async (req, res) => {
  try {
    const [categories] = await pool.execute(`
      SELECT category, COUNT(*) as count
      FROM organizations
      WHERE is_active = true
      GROUP BY category
      ORDER BY category ASC
    `);

    res.json({ categories });

  } catch (error) {
    console.error('Get organization categories error:', error);
    res.status(500).json({ error: 'Failed to get organization categories' });
  }
});

module.exports = router;
