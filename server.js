const express = require('express');
const cors = require('cors');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Middleware
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static('public'));

// Multer configuration for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed'), false);
    }
  }
});

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ error: 'Access token required' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  });
};

// Admin middleware
const requireAdmin = (req, res, next) => {
  if (!req.user || (req.user.role !== 'admin' && req.user.role !== 'superadmin')) {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

// Validation helper
const validateEvent = (event) => {
  const errors = [];
  
  if (!event.title || event.title.trim().length < 5) {
    errors.push('Titel moet minimaal 5 karakters bevatten');
  }
  
  if (!event.description || event.description.trim().length < 10) {
    errors.push('Beschrijving moet minimaal 10 karakters bevatten');
  }
  
  if (!event.event_date) {
    errors.push('Startdatum is verplicht');
  }
  
  if (!event.location || event.location.trim().length === 0) {
    errors.push('Locatie is verplicht');
  }
  
  if (!event.category) {
    errors.push('Categorie is verplicht');
  }
  
  if (!event.organization_id) {
    errors.push('Organisatie is verplicht');
  }
  
  // Validate end_date if provided
  if (event.end_date && event.event_date) {
    const startDate = new Date(event.event_date);
    const endDate = new Date(event.end_date);
    if (endDate <= startDate) {
      errors.push('Einddatum moet na startdatum liggen');
    }
  }
  
  return errors;
};

// Routes

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// File upload endpoint
app.post('/api/upload', authenticateToken, requireAdmin, upload.single('image'), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }
    
    const fileUrl = `/uploads/${req.file.filename}`;
    res.json({ 
      success: true, 
      url: fileUrl,
      filename: req.file.filename 
    });
  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', message: error.message });
  }
});

// Serve uploaded files
app.use('/uploads', express.static('uploads'));

// Get all events (public)
app.get('/api/events', async (req, res) => {
  try {
    console.log('Fetching events...');
    const result = await pool.query(`
      SELECT e.*, o.name as organization_name, u.name as organizer_name
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      LEFT JOIN users u ON e.organizer_id = u.id
      WHERE e.status IN ('scheduled', 'published', 'approved')
      ORDER BY e.event_date ASC
    `);
    
    console.log(`Found ${result.rows.length} events`);
    res.json({ events: result.rows });
  } catch (error) {
    console.error('Get events error:', error);
    console.error('Error details:', error.message, error.stack);
    res.status(500).json({ error: 'Failed to fetch events', message: error.message });
  }
});

// Get single event (public)
app.get('/api/events/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(`
      SELECT e.*, o.name as organization_name, u.name as organizer_name
      FROM events e
      LEFT JOIN organizations o ON e.organization_id = o.id
      LEFT JOIN users u ON e.organizer_id = u.id
      WHERE e.id = $1
    `, [id]);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }
    
    res.json({ event: result.rows[0] });
  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to fetch event', message: error.message });
  }
});

// Create event (admin only)
app.post('/api/events', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      title,
      description,
      event_date,
      end_date,
      location,
      category,
      organization_id,
      image_url,
      max_attendees,
      price
    } = req.body;

    const event = {
      title,
      description,
      event_date,
      end_date,
      location,
      category,
      organization_id,
      image_url,
      max_attendees,
      price
    };

    // Validate event data
    const errors = validateEvent(event);
    if (errors.length > 0) {
      return res.status(400).json({
        error: 'Validation failed', 
        details: errors 
      });
    }

    // Insert event
    const result = await pool.query(`
      INSERT INTO events (
        title, description, event_date, end_date, location, 
        category, organization_id, image_url, max_attendees, 
        price, organizer_id, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, NOW(), NOW())
      RETURNING *
    `, [
      title.trim(),
      description.trim(),
      event_date,
      end_date || null,
      location.trim(),
      category,
      organization_id,
      image_url || null,
      max_attendees || null,
      price || 0,
      req.user.id,
      'scheduled'
    ]);

    res.status(201).json({
      success: true, 
      event: result.rows[0],
      message: 'Event created successfully'
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({
      error: 'Failed to create event', 
      message: error.message
    });
  }
});

// Update event (admin only)
app.put('/api/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      title,
      description,
      event_date,
      end_date,
      location,
      category,
      organization_id,
      image_url,
      max_attendees,
      price,
      status
    } = req.body;

    // Check if event exists
    const checkResult = await pool.query('SELECT organizer_id FROM events WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check permissions (admin can edit own events, superadmin can edit all)
    if (req.user.role === 'admin' && checkResult.rows[0].organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only edit your own events' });
    }

    // Build update query dynamically
    const updates = [];
    const values = [];
    let paramCount = 1;

    if (title !== undefined) {
      updates.push(`title = $${paramCount++}`);
      values.push(title.trim());
    }
    if (description !== undefined) {
      updates.push(`description = $${paramCount++}`);
      values.push(description.trim());
    }
    if (event_date !== undefined) {
      updates.push(`event_date = $${paramCount++}`);
      values.push(event_date);
    }
    if (end_date !== undefined) {
      updates.push(`end_date = $${paramCount++}`);
      values.push(end_date);
    }
    if (location !== undefined) {
      updates.push(`location = $${paramCount++}`);
      values.push(location.trim());
    }
    if (category !== undefined) {
      updates.push(`category = $${paramCount++}`);
      values.push(category);
    }
    if (organization_id !== undefined) {
      updates.push(`organization_id = $${paramCount++}`);
      values.push(organization_id);
    }
    if (image_url !== undefined) {
      updates.push(`image_url = $${paramCount++}`);
      values.push(image_url);
    }
    if (max_attendees !== undefined) {
      updates.push(`max_attendees = $${paramCount++}`);
      values.push(max_attendees);
    }
    if (price !== undefined) {
      updates.push(`price = $${paramCount++}`);
      values.push(price);
    }
    if (status !== undefined) {
      updates.push(`status = $${paramCount++}`);
      values.push(status);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields to update' });
    }

    // Add updated_at and id
    updates.push(`updated_at = NOW()`);
    values.push(id);

    const query = `
      UPDATE events 
      SET ${updates.join(', ')} 
      WHERE id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);

    res.json({
      success: true, 
      event: result.rows[0],
      message: 'Event updated successfully'
    });

  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({
      error: 'Failed to update event', 
      message: error.message
    });
  }
});

// Delete event (admin only)
app.delete('/api/events/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists and get organizer
    const checkResult = await pool.query('SELECT organizer_id FROM events WHERE id = $1', [id]);
    if (checkResult.rows.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    // Check permissions
    if (req.user.role === 'admin' && checkResult.rows[0].organizer_id !== req.user.id) {
      return res.status(403).json({ error: 'You can only delete your own events' });
    }

    await pool.query('DELETE FROM events WHERE id = $1', [id]);

    res.json({
      success: true, 
      message: 'Event deleted successfully' 
    });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({
      error: 'Failed to delete event', 
      message: error.message
    });
  }
});

// Get organizations (for dropdown)
app.get('/api/organizations', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query('SELECT id, name FROM organizations ORDER BY name');
    res.json({ organizations: result.rows });
  } catch (error) {
    console.error('Get organizations error:', error);
    res.status(500).json({ error: 'Failed to fetch organizations', message: error.message });
  }
});

// Login endpoint
app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await pool.query(
      'SELECT id, email, password, role, name FROM users WHERE email = $1',
      [email]
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password);

    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        name: user.name
      }
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed', message: error.message });
  }
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('Unhandled error:', error);
    res.status(500).json({
    error: 'Internal server error', 
      message: error.message
    });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Holwert Backend running on port ${PORT}`);
  console.log(`📊 Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
