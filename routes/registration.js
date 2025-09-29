const express = require('express');
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { upload, processImageSizes, deleteImageSizes } = require('../utils/imageUpload');
const { validationRules, validateWithJoi, schemas, sanitizeInput } = require('../utils/validation');
const { logError, logDatabaseError, logUserAction, logImageUpload, logSecurityEvent } = require('../utils/logger');

const router = express.Router();

// Apply middleware
router.use(sanitizeInput);

// ==================== USER REGISTRATION ====================

// Register new user
router.post('/users', upload.single('profileImage'), validationRules.createUser, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { email, password, firstName, lastName, phone, address, organizationId } = req.body;

    // Check if user already exists
    const [existingUsers] = await pool.execute(
      'SELECT id FROM users WHERE email = ?',
      [email]
    );

    if (existingUsers.length > 0) {
      return res.status(409).json({ error: 'Gebruiker met dit e-mailadres bestaat al' });
    }

    // Validate organization if provided
    if (organizationId) {
      const [org] = await pool.execute(
        'SELECT id, is_active FROM organizations WHERE id = ?',
        [organizationId]
      );
      
      if (org.length === 0) {
        return res.status(400).json({ error: 'Organisatie niet gevonden' });
      }
      
      if (!org[0].is_active) {
        return res.status(400).json({ error: 'Organisatie is niet actief' });
      }
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

    // Create user with 'user' role by default
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, first_name, last_name, role, organization_id, phone, address, profile_image, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      [
        email, 
        hashedPassword, 
        firstName, 
        lastName, 
        'user', // Default role for registrations
        organizationId || null, 
        phone || null, 
        address || null,
        profileImageData ? JSON.stringify(profileImageData) : null,
        0 // Email not verified yet
      ]
    );

    // Log security event
    logSecurityEvent('user_registration', req, {
      userId: result.insertId,
      email,
      organizationId
    });

    logUserAction('register_user', result.insertId, { 
      email,
      organizationId 
    });

    res.status(201).json({
      message: 'Registratie succesvol! Je account is aangemaakt en wacht op goedkeuring.',
      userId: result.insertId,
      requiresApproval: true
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij registratie' });
  }
});

// ==================== ORGANIZATION REGISTRATION ====================

// Register new organization
router.post('/organizations', upload.single('logo'), validationRules.createOrganization, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { name, description, type, email, phone, website, address, contactPerson, contactEmail, contactPhone } = req.body;

    // Check if organization already exists
    const [existingOrgs] = await pool.execute(
      'SELECT id FROM organizations WHERE name = ?',
      [name]
    );

    if (existingOrgs.length > 0) {
      return res.status(409).json({ error: 'Organisatie met deze naam bestaat al' });
    }

    // Check if contact email is provided and not already in use
    if (contactEmail) {
      const [existingContact] = await pool.execute(
        'SELECT id FROM users WHERE email = ?',
        [contactEmail]
      );

      if (existingContact.length > 0) {
        return res.status(409).json({ error: 'Contact e-mailadres is al in gebruik' });
      }
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

    // Start transaction
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      // Create organization
      const [orgResult] = await connection.execute(
        'INSERT INTO organizations (name, description, type, email, phone, website, address, logo, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [name, description || null, type, email || null, phone || null, website || null, address || null, logoData ? JSON.stringify(logoData) : null, 0] // Not active until approved
      );

      const organizationId = orgResult.insertId;

      // Create contact person user if contact details provided
      let contactUserId = null;
      if (contactPerson && contactEmail) {
        // Generate temporary password
        const tempPassword = Math.random().toString(36).slice(-8);
        const hashedPassword = await bcrypt.hash(tempPassword, 12);

        const [contactResult] = await connection.execute(
          'INSERT INTO users (email, password, first_name, last_name, role, organization_id, phone, email_verified) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [contactEmail, hashedPassword, contactPerson.split(' ')[0] || contactPerson, contactPerson.split(' ').slice(1).join(' ') || '', 'admin', organizationId, contactPhone || null, 0]
        );

        contactUserId = contactResult.insertId;
      }

      await connection.commit();

      // Log security event
      logSecurityEvent('organization_registration', req, {
        organizationId,
        name,
        type,
        contactUserId
      });

      logUserAction('register_organization', contactUserId || 'system', { 
        organizationId,
        name,
        type
      });

      res.status(201).json({
        message: 'Organisatie registratie succesvol! Je aanvraag wacht op goedkeuring.',
        organizationId,
        contactUserId,
        requiresApproval: true,
        ...(contactUserId && { tempPassword: 'Tijdelijk wachtwoord is per e-mail verzonden' })
      });

    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij registratie van organisatie' });
  }
});

// ==================== REGISTRATION APPROVAL ====================

// Get pending registrations (Admin only)
router.get('/pending', async (req, res) => {
  try {
    // This would require admin authentication in real implementation
    const [pendingUsers] = await pool.execute(`
      SELECT u.id, u.email, u.first_name, u.last_name, u.phone, u.address, u.created_at,
             o.name as organization_name
      FROM users u
      LEFT JOIN organizations o ON u.organization_id = o.id
      WHERE u.role = 'user' AND u.is_active = 0
      ORDER BY u.created_at DESC
    `);

    const [pendingOrgs] = await pool.execute(`
      SELECT o.id, o.name, o.description, o.type, o.email, o.phone, o.website, o.address, o.created_at,
             u.email as contact_email, u.first_name as contact_first_name, u.last_name as contact_last_name
      FROM organizations o
      LEFT JOIN users u ON o.id = u.organization_id AND u.role = 'admin'
      WHERE o.is_active = 0
      ORDER BY o.created_at DESC
    `);

    res.json({
      pendingUsers,
      pendingOrganizations: pendingOrgs
    });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij ophalen van wachtende registraties' });
  }
});

// Approve user registration
router.post('/approve/user/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await pool.execute(
      'UPDATE users SET is_active = 1, approved_at = NOW(), approved_by = ? WHERE id = ?',
      ['system', id] // In real implementation, use req.user.id
    );

    logUserAction('approve_user_registration', 'system', { 
      userId: id,
      reason 
    });

    res.json({ message: 'Gebruiker registratie goedgekeurd' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij goedkeuren van gebruiker' });
  }
});

// Approve organization registration
router.post('/approve/organization/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;

    await pool.execute(
      'UPDATE organizations SET is_active = 1, approved_at = NOW(), approved_by = ? WHERE id = ?',
      ['system', id] // In real implementation, use req.user.id
    );

    // Also activate the contact person
    await pool.execute(
      'UPDATE users SET is_active = 1 WHERE organization_id = ? AND role = "admin"',
      [id]
    );

    logUserAction('approve_organization_registration', 'system', { 
      organizationId: id,
      reason 
    });

    res.json({ message: 'Organisatie registratie goedgekeurd' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij goedkeuren van organisatie' });
  }
});

// Reject registration
router.post('/reject/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;
    const { reason } = req.body;

    if (!reason || reason.trim().length < 5) {
      return res.status(400).json({ error: 'Reden voor afwijzing is vereist (minimaal 5 karakters)' });
    }

    if (type === 'user') {
      await pool.execute(
        'UPDATE users SET rejection_reason = ?, rejected_at = NOW(), rejected_by = ? WHERE id = ?',
        [reason, 'system', id]
      );
    } else if (type === 'organization') {
      await pool.execute(
        'UPDATE organizations SET rejection_reason = ?, rejected_at = NOW(), rejected_by = ? WHERE id = ?',
        [reason, 'system', id]
      );
    } else {
      return res.status(400).json({ error: 'Ongeldig type' });
    }

    logUserAction('reject_registration', 'system', { 
      type,
      id,
      reason 
    });

    res.json({ message: 'Registratie afgewezen' });

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij afwijzen van registratie' });
  }
});

// ==================== REGISTRATION STATUS CHECK ====================

// Check registration status
router.get('/status/:type/:id', async (req, res) => {
  try {
    const { type, id } = req.params;

    if (type === 'user') {
      const [user] = await pool.execute(`
        SELECT id, email, first_name, last_name, is_active, email_verified, 
               approved_at, rejected_at, rejection_reason, created_at
        FROM users WHERE id = ?
      `, [id]);

      if (user.length === 0) {
        return res.status(404).json({ error: 'Gebruiker niet gevonden' });
      }

      res.json({
        type: 'user',
        status: user[0].is_active ? 'approved' : user[0].rejected_at ? 'rejected' : 'pending',
        data: user[0]
      });

    } else if (type === 'organization') {
      const [org] = await pool.execute(`
        SELECT id, name, type, is_active, approved_at, rejected_at, rejection_reason, created_at
        FROM organizations WHERE id = ?
      `, [id]);

      if (org.length === 0) {
        return res.status(404).json({ error: 'Organisatie niet gevonden' });
      }

      res.json({
        type: 'organization',
        status: org[0].is_active ? 'approved' : org[0].rejected_at ? 'rejected' : 'pending',
        data: org[0]
      });

    } else {
      return res.status(400).json({ error: 'Ongeldig type' });
    }

  } catch (error) {
    logDatabaseError(error);
    res.status(500).json({ error: 'Fout bij ophalen van status' });
  }
});

module.exports = router;
