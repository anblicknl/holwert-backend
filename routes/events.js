const express = require('express');
const { pool } = require('../config/database');
const { authenticateToken, requireAdmin, optionalAuth } = require('../middleware/auth');

const router = express.Router();

// Get all published events (public)
router.get('/', optionalAuth, async (req, res) => {
  try {
    const { page = 1, limit = 20, category, organizationId, search, upcoming } = req.query;
    const offset = (page - 1) * limit;

    let query = `
      SELECT e.id, e.title, e.description, e.event_date, e.event_time, e.location, e.location_details,
             e.category, e.price, e.max_attendees, e.image, e.published_at, e.created_at,
             u.first_name, u.last_name, o.name as organization_name, o.category as organization_category,
             o.logo as organization_logo
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.status = 'published'
    `;
    const params = [];

    if (category) {
      query += ' AND e.category = ?';
      params.push(category);
    }

    if (organizationId) {
      query += ' AND e.organization_id = ?';
      params.push(organizationId);
    }

    if (search) {
      query += ' AND (e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)';
      const searchTerm = `%${search}%`;
      params.push(searchTerm, searchTerm, searchTerm);
    }

    if (upcoming === 'true') {
      query += ' AND (e.event_date > CURDATE() OR (e.event_date = CURDATE() AND e.event_time > CURTIME()))';
    }

    query += ' ORDER BY e.event_date ASC, e.event_time ASC LIMIT ? OFFSET ?';
    params.push(parseInt(limit), parseInt(offset));

    const [events] = await pool.execute(query, params);

    // Get total count
    let countQuery = `
      SELECT COUNT(*) as total 
      FROM events e 
      WHERE e.status = 'published'
    `;
    const countParams = [];

    if (category) {
      countQuery += ' AND e.category = ?';
      countParams.push(category);
    }

    if (organizationId) {
      countQuery += ' AND e.organization_id = ?';
      countParams.push(organizationId);
    }

    if (search) {
      countQuery += ' AND (e.title LIKE ? OR e.description LIKE ? OR e.location LIKE ?)';
      const searchTerm = `%${search}%`;
      countParams.push(searchTerm, searchTerm, searchTerm);
    }

    if (upcoming === 'true') {
      countQuery += ' AND (e.event_date > CURDATE() OR (e.event_date = CURDATE() AND e.event_time > CURTIME()))';
    }

    const [countResult] = await pool.execute(countQuery, countParams);
    const total = countResult[0].total;

    // Check if user is attending any of these events
    let attendingEvents = [];
    if (req.user) {
      const eventIds = events.map(event => event.id);
      if (eventIds.length > 0) {
        const [attending] = await pool.execute(
          'SELECT event_id, status FROM event_attendees WHERE user_id = ? AND event_id IN (' + eventIds.map(() => '?').join(',') + ')',
          [req.user.id, ...eventIds]
        );
        attendingEvents = attending;
      }
    }

    // Add attendance status to events
    const eventsWithAttendance = events.map(event => {
      const attendance = attendingEvents.find(a => a.event_id === event.id);
      return {
        ...event,
        user_attendance: attendance ? attendance.status : null
      };
    });

    res.json({
      events: eventsWithAttendance,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });

  } catch (error) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Failed to get events' });
  }
});

// Get single event (public)
router.get('/:id', optionalAuth, async (req, res) => {
  try {
    const { id } = req.params;

    const [events] = await pool.execute(`
      SELECT e.*, u.first_name, u.last_name, o.name as organization_name, 
             o.category as organization_category, o.logo as organization_logo
      FROM events e
      JOIN users u ON e.organizer_id = u.id
      LEFT JOIN organizations o ON e.organization_id = o.id
      WHERE e.id = ? AND e.status = 'published'
    `, [id]);

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = events[0];

    // Get attendees count
    const [attendeesCount] = await pool.execute(
      'SELECT COUNT(*) as count FROM event_attendees WHERE event_id = ? AND status = "attending"',
      [id]
    );

    // Check if user is attending
    let userAttendance = null;
    if (req.user) {
      const [attendance] = await pool.execute(
        'SELECT status FROM event_attendees WHERE event_id = ? AND user_id = ?',
        [id, req.user.id]
      );
      userAttendance = attendance.length > 0 ? attendance[0].status : null;
    }

    res.json({
      ...event,
      attendees_count: attendeesCount[0].count,
      user_attendance: userAttendance
    });

  } catch (error) {
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Failed to get event' });
  }
});

// Create event (Admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { title, description, eventDate, eventTime, location, locationDetails, category, price, maxAttendees, image, organizationId } = req.body;
    const organizerId = req.user.id;

    // Validation
    if (!title || !description || !eventDate || !eventTime || !location || !category) {
      return res.status(400).json({ 
        error: 'Title, description, event date, event time, location and category are required' 
      });
    }

    const validCategories = ['vergadering', 'evenement', 'sport', 'cultuur', 'markt', 'overig'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category' 
      });
    }

    // Validate date
    const eventDateTime = new Date(`${eventDate}T${eventTime}`);
    if (eventDateTime < new Date()) {
      return res.status(400).json({ 
        error: 'Event date and time must be in the future' 
      });
    }

    // If user is admin (not superadmin), they can only create events for their organization
    if (req.user.role === 'admin' && organizationId && organizationId !== req.user.organization_id) {
      return res.status(403).json({ 
        error: 'You can only create events for your own organization' 
      });
    }

    const [result] = await pool.execute(
      'INSERT INTO events (title, description, event_date, event_time, location, location_details, organizer_id, organization_id, category, price, max_attendees, image, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [title, description, eventDate, eventTime, location, locationDetails || null, organizerId, organizationId || req.user.organization_id, category, price || 0, maxAttendees || null, image || null, 'pending']
    );

    res.status(201).json({
      message: 'Event created successfully',
      eventId: result.insertId
    });

  } catch (error) {
    console.error('Create event error:', error);
    res.status(500).json({ error: 'Failed to create event' });
  }
});

// Update event (Admin only - own events or Superadmin)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { title, description, eventDate, eventTime, location, locationDetails, category, price, maxAttendees, image, organizationId } = req.body;

    // Validation
    if (!title || !description || !eventDate || !eventTime || !location || !category) {
      return res.status(400).json({ 
        error: 'Title, description, event date, event time, location and category are required' 
      });
    }

    // Check if event exists and user has permission to edit
    const [events] = await pool.execute(
      'SELECT organizer_id, organization_id FROM events WHERE id = ?',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = events[0];

    // Check permissions
    if (req.user.role === 'admin' && event.organizer_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only edit your own events' 
      });
    }

    const validCategories = ['vergadering', 'evenement', 'sport', 'cultuur', 'markt', 'overig'];
    if (!validCategories.includes(category)) {
      return res.status(400).json({ 
        error: 'Invalid category' 
      });
    }

    // Validate date
    const eventDateTime = new Date(`${eventDate}T${eventTime}`);
    if (eventDateTime < new Date()) {
      return res.status(400).json({ 
        error: 'Event date and time must be in the future' 
      });
    }

    await pool.execute(
      'UPDATE events SET title = ?, description = ?, event_date = ?, event_time = ?, location = ?, location_details = ?, category = ?, price = ?, max_attendees = ?, image = ?, organization_id = ? WHERE id = ?',
      [title, description, eventDate, eventTime, location, locationDetails || null, category, price || 0, maxAttendees || null, image || null, organizationId || event.organization_id, id]
    );

    res.json({ message: 'Event updated successfully' });

  } catch (error) {
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Failed to update event' });
  }
});

// Delete event (Admin only - own events or Superadmin)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists and user has permission to delete
    const [events] = await pool.execute(
      'SELECT organizer_id FROM events WHERE id = ?',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = events[0];

    // Check permissions
    if (req.user.role === 'admin' && event.organizer_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only delete your own events' 
      });
    }

    await pool.execute('DELETE FROM events WHERE id = ?', [id]);

    res.json({ message: 'Event deleted successfully' });

  } catch (error) {
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Failed to delete event' });
  }
});

// RSVP to event (Authenticated users)
router.post('/:id/rsvp', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const userId = req.user.id;

    // Validation
    if (!['attending', 'maybe', 'not_attending'].includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status. Must be attending, maybe, or not_attending' 
      });
    }

    // Check if event exists and is published
    const [events] = await pool.execute(
      'SELECT id, max_attendees FROM events WHERE id = ? AND status = "published"',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = events[0];

    // Check if event is full (only for attending status)
    if (status === 'attending' && event.max_attendees) {
      const [attendeesCount] = await pool.execute(
        'SELECT COUNT(*) as count FROM event_attendees WHERE event_id = ? AND status = "attending"',
        [id]
      );

      if (attendeesCount[0].count >= event.max_attendees) {
        return res.status(400).json({ error: 'Event is full' });
      }
    }

    // Check if user already has an RSVP
    const [existing] = await pool.execute(
      'SELECT id FROM event_attendees WHERE event_id = ? AND user_id = ?',
      [id, userId]
    );

    if (existing.length > 0) {
      // Update existing RSVP
      await pool.execute(
        'UPDATE event_attendees SET status = ? WHERE event_id = ? AND user_id = ?',
        [status, id, userId]
      );
    } else {
      // Create new RSVP
      await pool.execute(
        'INSERT INTO event_attendees (event_id, user_id, status) VALUES (?, ?, ?)',
        [id, userId, status]
      );
    }

    res.json({ message: 'RSVP updated successfully', status });

  } catch (error) {
    console.error('RSVP error:', error);
    res.status(500).json({ error: 'Failed to update RSVP' });
  }
});

// Get event attendees (Event organizer or Superadmin)
router.get('/:id/attendees', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if event exists and user has permission to view attendees
    const [events] = await pool.execute(
      'SELECT organizer_id FROM events WHERE id = ?',
      [id]
    );

    if (events.length === 0) {
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = events[0];

    // Check permissions
    if (req.user.role !== 'superadmin' && event.organizer_id !== req.user.id) {
      return res.status(403).json({ 
        error: 'You can only view attendees for your own events' 
      });
    }

    const [attendees] = await pool.execute(`
      SELECT ea.status, ea.created_at, u.first_name, u.last_name, u.email
      FROM event_attendees ea
      JOIN users u ON ea.user_id = u.id
      WHERE ea.event_id = ?
      ORDER BY ea.created_at DESC
    `, [id]);

    res.json({ attendees });

  } catch (error) {
    console.error('Get event attendees error:', error);
    res.status(500).json({ error: 'Failed to get event attendees' });
  }
});

module.exports = router;
