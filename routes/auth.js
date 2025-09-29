const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const { authenticateToken } = require('../middleware/auth');

const router = express.Router();

// Register new user
router.post('/register', async (req, res) => {
  try {
    const { email, password, firstName, lastName, phone, address } = req.body;

    // Validation
    if (!email || !password || !firstName || !lastName) {
      return res.status(400).json({ 
        error: 'Email, password, first name and last name are required' 
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

    // Hash password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(password, saltRounds);

    // Create user
    const [result] = await pool.execute(
      'INSERT INTO users (email, password, first_name, last_name, phone, address, role) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [email, hashedPassword, firstName, lastName, phone || null, address || null, 'user']
    );

    // Generate JWT token
    const token = jwt.sign(
      { userId: result.insertId, email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      message: 'User registered successfully',
      token,
      user: {
        id: result.insertId,
        email,
        firstName,
        lastName,
        role: 'user'
      }
    });

  } catch (error) {
    console.error('Registration error:', error);
    res.status(500).json({ error: 'Registration failed' });
  }
});

// Login user
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    // Validation
    if (!email || !password) {
      return res.status(400).json({ 
        error: 'E-mailadres en wachtwoord zijn vereist',
        field: !email ? 'email' : 'password'
      });
    }

    // Email format validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({ 
        error: 'Ongeldig e-mailadres formaat',
        field: 'email'
      });
    }

    // Find user
    const [users] = await pool.execute(
      'SELECT id, email, password, first_name, last_name, role, organization_id, is_active, email_verified FROM users WHERE email = ?',
      [email]
    );

    if (users.length === 0) {
      return res.status(401).json({ 
        error: 'E-mailadres niet gevonden',
        field: 'email',
        suggestion: 'Controleer of het e-mailadres correct is gespeld'
      });
    }

    const user = users[0];

    // Check if user is active
    if (!user.is_active) {
      return res.status(401).json({ 
        error: 'Account is gedeactiveerd',
        field: 'account',
        suggestion: 'Neem contact op met de beheerder'
      });
    }

    // Check if email is verified (optional check)
    if (!user.email_verified) {
      console.log(`Login attempt with unverified email: ${email}`);
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);

    if (!isValidPassword) {
      return res.status(401).json({ 
        error: 'Onjuist wachtwoord',
        field: 'password',
        suggestion: 'Controleer of het wachtwoord correct is ingevoerd'
      });
    }

    // Generate JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    // Remove password from response
    delete user.password;

    res.json({
      message: 'Login successful',
      token,
      user
    });

  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// Get current user profile
router.get('/me', authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT u.id, u.email, u.first_name, u.last_name, u.role, u.organization_id, 
              u.profile_image, u.phone, u.address, u.email_verified, u.created_at,
              o.name as organization_name, o.category as organization_category
       FROM users u 
       LEFT JOIN organizations o ON u.organization_id = o.id 
       WHERE u.id = ?`,
      [req.user.id]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: users[0] });

  } catch (error) {
    console.error('Get profile error:', error);
    res.status(500).json({ error: 'Failed to get user profile' });
  }
});

// Update user profile
router.put('/me', authenticateToken, async (req, res) => {
  try {
    const { firstName, lastName, phone, address } = req.body;
    const userId = req.user.id;

    // Validation
    if (!firstName || !lastName) {
      return res.status(400).json({ 
        error: 'First name and last name are required' 
      });
    }

    await pool.execute(
      'UPDATE users SET first_name = ?, last_name = ?, phone = ?, address = ? WHERE id = ?',
      [firstName, lastName, phone || null, address || null, userId]
    );

    res.json({ message: 'Profile updated successfully' });

  } catch (error) {
    console.error('Update profile error:', error);
    res.status(500).json({ error: 'Failed to update profile' });
  }
});

// Change password
router.put('/change-password', authenticateToken, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user.id;

    // Validation
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ 
        error: 'Current password and new password are required' 
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({ 
        error: 'New password must be at least 6 characters long' 
      });
    }

    // Get current password
    const [users] = await pool.execute(
      'SELECT password FROM users WHERE id = ?',
      [userId]
    );

    if (users.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Verify current password
    const isValidPassword = await bcrypt.compare(currentPassword, users[0].password);

    if (!isValidPassword) {
      return res.status(401).json({ error: 'Current password is incorrect' });
    }

    // Hash new password
    const saltRounds = 12;
    const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

    // Update password
    await pool.execute(
      'UPDATE users SET password = ? WHERE id = ?',
      [hashedPassword, userId]
    );

    res.json({ message: 'Password changed successfully' });

  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

// Logout (client-side token removal, but we can log it)
router.post('/logout', authenticateToken, (req, res) => {
  // In a more advanced setup, you might want to blacklist the token
  res.json({ message: 'Logout successful' });
});

module.exports = router;
