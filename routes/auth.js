const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const path = require('path');

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

let totpSecrets = {};

module.exports = (queryDatabase, upload, authenticateToken) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Check if email exists
  router.post('/check-email', (req, res) => {
    const { email } = req.body;
    const query = 'SELECT * FROM users WHERE email = ?';

    queryDatabase(query, [email], (err, results) => {
      if (err) {
        console.error('Error checking email:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length > 0) {
        return res.status(409).json({ error: 'Email already exists' });
      }

      res.status(200).json({ available: true });
    });
  });

  // Register new user
  router.post('/register', upload.single('profilePicture'), (req, res) => {
    const { name, email, password, organization, region, device, cpu, gpu, ram, capacity, motherboard, psu } = req.body;
    const profilePicture = req.file ? req.file.filename : null;

    const userQuery = `
      INSERT INTO users (name, email, password, organization, region, profile_image, current_device_id)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `;

    queryDatabase(userQuery, [name, email, password, organization, region, profilePicture, null], (err, results) => {
      if (err) {
        console.error('Error registering user:', err);
        return res.status(500).json({ error: 'Error registering user' });
      }

      const userId = results.insertId;

      // Create a device entry if device info is provided
      if (device === 'personal_computer' && (cpu || gpu || ram)) {
        const deviceQuery = `
          INSERT INTO devices (user_id, device_type, cpu, gpu, ram, capacity, motherboard, psu)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `;

        queryDatabase(deviceQuery, [userId, device, cpu || null, gpu || null, ram || null, capacity || null, motherboard || null, psu || null], (err, deviceResults) => {
          if (err) {
            console.error('Error creating device:', err);
            return res.status(500).json({ error: 'Error creating device' });
          }

          // Update user's current_device_id
          const updateUserQuery = 'UPDATE users SET current_device_id = ? WHERE id = ?';
          queryDatabase(updateUserQuery, [deviceResults.insertId, userId], (updateErr) => {
            if (updateErr) {
              console.error('Error updating user device:', updateErr);
              return res.status(500).json({ error: 'User created but device update failed' });
            }

            res.status(201).json({ message: 'User registered successfully', userId });
          });
        });
      } else {
        res.status(201).json({ message: 'User registered successfully', userId });
      }
    });
  });

  // Login endpoint
  router.post('/login', (req, res) => {
    const { email, password } = req.body;

    const userQuery = `
      SELECT id, name, email, current_device_id FROM users WHERE email = ? AND password = ?
    `;

    queryDatabase(userQuery, [email, password], (err, results) => {
      if (err) {
        console.error('Error logging in user:', err);
        return res.status(500).json({ error: 'Error logging in' });
      }

      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const user = results[0];
      const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '24h' });

      res.status(200).json({
        message: 'Login successful',
        token,
        user: {
          id: user.id,
          name: user.name,
          email: user.email,
          current_device_id: user.current_device_id,
        },
      });
    });
  });

  // Generate TOTP
  router.post('/generate-totp', async (req, res) => {
    const { email } = req.body;

    const secret = speakeasy.generateSecret({ name: `EmissionSense (${email})` });
    totpSecrets[email] = secret.base32;

    const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

    res.status(200).json({
      secret: secret.base32,
      qrCode: qrCodeUrl,
    });
  });

  // Validate TOTP
  router.post('/validate-totp', async (req, res) => {
    const { email, token, newPassword } = req.body;

    const secret = totpSecrets[email];
    if (!secret) {
      return res.status(400).json({ error: 'TOTP secret not found. Generate one first.' });
    }

    const verified = speakeasy.totp.verify({
      secret: secret,
      encoding: 'base32',
      token: token,
      window: 2,
    });

    if (!verified) {
      return res.status(401).json({ error: 'Invalid TOTP token' });
    }

    if (!newPassword) {
      return res.status(400).json({ error: 'New password is required' });
    }

    const updateQuery = 'UPDATE users SET password = ? WHERE email = ?';
    queryDatabase(updateQuery, [newPassword, email], (err, results) => {
      if (err) {
        console.error('Error updating password:', err);
        return res.status(500).json({ error: 'Error updating password' });
      }

      delete totpSecrets[email];
      res.status(200).json({ message: 'Password updated successfully' });
    });
  });

  // Send password reset email
  router.post('/send-reset-email', async (req, res) => {
    const { email } = req.body;

    const checkUserQuery = 'SELECT * FROM users WHERE email = ?';
    queryDatabase(checkUserQuery, [email], async (err, results) => {
      if (err) {
        console.error('Error checking user:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Email not found' });
      }

      const resetToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '15m' });
      const resetLink = `https://emission-vert.vercel.app/reset-password?token=${resetToken}`;

      const mailOptions = {
        from: process.env.EMAIL_USER,
        to: email,
        subject: 'Password Reset Request',
        html: `
          <h2>Password Reset</h2>
          <p>Click the link below to reset your password:</p>
          <a href="${resetLink}">Reset Password</a>
          <p>This link will expire in 15 minutes.</p>
        `,
      };

      transporter.sendMail(mailOptions, (error, info) => {
        if (error) {
          console.error('Error sending email:', error);
          return res.status(500).json({ error: 'Error sending reset email' });
        }

        res.status(200).json({ message: 'Reset email sent successfully' });
      });
    });
  });

  // Reset password
  router.post('/resetpassword', async (req, res) => {
    const { token, newPassword } = req.body;

    try {
      const decoded = jwt.verify(token, JWT_SECRET);
      const email = decoded.email;

      const updateQuery = 'UPDATE users SET password = ? WHERE email = ?';
      queryDatabase(updateQuery, [newPassword, email], (err, results) => {
        if (err) {
          console.error('Error resetting password:', err);
          return res.status(500).json({ error: 'Error resetting password' });
        }

        res.status(200).json({ message: 'Password reset successfully' });
      });
    } catch (error) {
      console.error('Invalid token:', error);
      res.status(401).json({ error: 'Invalid or expired token' });
    }
  });

  // File upload endpoint
  router.post('/upload', upload.single('profileImage'), (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    res.status(200).send({ fileName: req.file.filename });
  });

  return router;
};
