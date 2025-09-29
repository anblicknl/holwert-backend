const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all published news articles (public)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, organizationId, search } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT n.id, n.title, n.excerpt, n.image, n.category, n.published_at, n.created_at,
             u.first_name, u.last_name, o.name as organization_name, o.category as organization_category,
             o.logo as organization_logo
      FROM news_articles n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.status = 'published'
    `;
    const params = [];

    if (category) {
      query += ' AND n.category = ?';
      params.push(category);
    }

    if (organizationId) {
      query += ' AND n.organization_id = ?';
      params.push(organizationId);
    }

    if (search) {
      query += ' AND (n.title LIKE ? OR n.excerpt LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm);
    }

    query += ' ORDER BY n.published_at DESC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [articles] = await pool.execute(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM news_articles n 
      WHERE n.status = 'published'
    `;
    const countParams = [];

    if (category) {
      countQuery += ' AND n.category = ?';
      countParams.push(category);
    }

    if (organizationId) {
      countQuery += ' AND n.organization_id = ?';
      countParams.push(organizationId);
    }

    if (search) {
      countQuery += ' AND (n.title LIKE ? OR n.excerpt LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm);
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    // Check if user has saved any of these articles
    let savedArticles = [];
    if (req.user) {
      const articleIds = articles.map(article => article.id);
      if (articleIds.length > 0) {
        const [saved] = await pool.execute(
          'SELECT article_id FROM user_saved_articles WHERE user_id = ? AND article_id IN (' + articleIds.map(() => '?').join(',') + ')',
          [req.user.id, ...articleIds]
        );
        savedArticles = saved.map(item => item.article_id);
      }
    }

    // Add saved status to articles
    const articlesWithSavedStatus = articles.map(article => ({
      ...article,
      is_saved: savedArticles.includes(article.id)
    }));

    res.json({
      articles: articlesWithSavedStatus,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get news articles error:', error);
    res.status(500).json({ error: 'Failed to get news articles' });
  }
});

// Get single news article (public)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [articles] = await pool.execute(`
      SELECT n.*, u.first_name, u.last_name, o.name as organization_name, 
             o.category as organization_category, o.logo as organization_logo
      FROM news_articles n
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE n.id = ? AND n.status = 'published'
    `, [id]);

    if (articles.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const article = articles[0];

    // Check if user has saved this article
    let isSaved = false;
    if (req.user) {
      const [saved] = await pool.execute(
        'SELECT id FROM user_saved_articles WHERE user_id = ? AND article_id = ?',
        [req.user.id, id]
      );
      isSaved = saved.length > 0;
    }

    res.json({
      ...article,
      is_saved: isSaved
    });

  } catch (error) {
    console.error('Get news article error:', error);
    res.status(500).json({ error: 'Failed to get news article' });
  }
});

// Create news article (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, content, excerpt, image, category, organizationId } = req.body;
    const authorId = req.user.id;

    // Validation
    if (!title || !content) {
      return res.status(400).json({ 
        error: 'Title and content are required' 
      });
    }

    const validCategories = ['dorpsnieuws', 'sport', 'cultuur', 'onderwijs', 'zorg', 'overig'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category' 
      });
    }

    // If user is admin (not superadmin), they can only create articles for their organization
    if (req.user.role === 'admin' && organizationId && organizationId !== req.user.organization_id) {
      return res.status(403).json({ 
        error: 'You can only create articles for your own organization' 
      });
    }

    // Auto-generate excerpt if not provided
    const finalExcerpt = excerpt || content.substring(0, 200) + '...';

    const [result] = await pool.execute(
      'INSERT INTO news_articles (title, content, excerpt, image, author_id, organization_id, category, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [title, content, finalExcerpt, image || null, authorId, organizationId || req.user.organization_id, category || 'dorpsnieuws', 'pending']
    );

    res.status(201).json({
      message: 'News article created successfully',
      articleId: result.insertId
    });

  } catch (error) {
    console.error('Create news article error:', error);
    res.status(500).json({ error: 'Failed to create news article' });
  }
});

// Update news article (Admin only - own articles or Superadmin)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, content, excerpt, image, category, organizationId } = req.body;

    // Validation
    if (!title || !content) {
      return res.status(400).json({ 
        error: 'Title and content are required' 
      });
    }

    // Check if article exists and user has permission to edit
    const [articles] = await pool.execute(
      'SELECT author_id, organization_id FROM news_articles WHERE id = ?',
      [id]
    );

    if (articles.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const article = articles[0];

    // Check permissions
    if (req.user.role === 'admin' && article.author_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only edit your own articles' 
      });
    }

    const validCategories = ['dorpsnieuws', 'sport', 'cultuur', 'onderwijs', 'zorg', 'overig'];
    if (category && !validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category' 
      });
    }

    // Auto-generate excerpt if not provided
    const finalExcerpt = excerpt || content.substring(0, 200) + '...';

    await pool.execute(
      'UPDATE news_articles SET title = ?, content = ?, excerpt = ?, image = ?, category = ?, organization_id = ? WHERE id = ?',
      [title, content, finalExcerpt, image || null, category || 'dorpsnieuws', organizationId || article.organization_id, id]
    );

    res.json({ message: 'News article updated successfully' });

  } catch (error) {
    console.error('Update news article error:', error);
    res.status(500).json({ error: 'Failed to update news article' });
  }
});

// Delete news article (Admin only - own articles or Superadmin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if article exists and user has permission to delete
    const [articles] = await pool.execute(
      'SELECT author_id FROM news_articles WHERE id = ?',
      [id]
    );

    if (articles.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    const article = articles[0];

    // Check permissions
    if (req.user.role === 'admin' && article.author_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only delete your own articles' 
      });
    }

    await pool.execute('DELETE FROM news_articles WHERE id = ?', [id]);

    res.json({ message: 'News article deleted successfully' });

  } catch (error) {
    console.error('Delete news article error:', error);
    res.status(500).json({ error: 'Failed to delete news article' });
  }
});

// Save/unsave article (Authenticated users)
router.post('/:id/save', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if article exists
    const [articles] = await pool.execute(
      'SELECT id FROM news_articles WHERE id = ? AND status = "published"',
      [id]
    );

    if (articles.length === 0) {
      return res.status(404).json({ error: 'Article not found' });
    }

    // Check if already saved
    const [existing] = await pool.execute(
      'SELECT id FROM user_saved_articles WHERE user_id = ? AND article_id = ?',
      [userId, id]
    );

    if (existing.length > 0) {
      // Remove from saved
      await pool.execute(
        'DELETE FROM user_saved_articles WHERE user_id = ? AND article_id = ?',
        [userId, id]
      );
      res.json({ message: 'Article removed from saved', is_saved: false });
    } else {
      // Add to saved
      await pool.execute(
        'INSERT INTO user_saved_articles (user_id, article_id) VALUES (?, ?)',
        [userId, id]
      );
      res.json({ message: 'Article saved successfully', is_saved: true });
    }

  } catch (error) {
    console.error('Save/unsave article error:', error);
    res.status(500).json({ error: 'Failed to save/unsave article' });
  }
});

// Get user's saved articles (Authenticated users)
router.get('/user/saved', authenticateToken, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const offset = (page - 1) * limit;
    const userId = req.user.id;

    const [articles] = await pool.execute(`
      SELECT n.id, n.title, n.excerpt, n.image, n.category, n.published_at,
             u.first_name, u.last_name, o.name as organization_name,
             usa.created_at as saved_at
      FROM user_saved_articles usa
      JOIN news_articles n ON usa.article_id = n.id
      JOIN users u ON n.author_id = u.id
      LEFT JOIN organizations o ON n.organization_id = o.id
      WHERE usa.user_id = ? AND n.status = 'published'
      ORDER BY usa.created_at DESC
      LIMIT ? OFFSET ?
    `, [userId, parseInt(limit), parseInt(offset)]);

    // Get total count
    const [countResult] = await pool.execute(
      'SELECT COUNT(*) as total FROM user_saved_articles usa JOIN news_articles n ON usa.article_id = n.id WHERE usa.user_id = ? AND n.status = "published"',
      [userId]
    );
    const total = countResult[0].total;

    res.json({
      articles,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get saved articles error:', error);
    res.status(500).json({ error: 'Failed to get saved articles' });
  }
});

module.exports = router;
