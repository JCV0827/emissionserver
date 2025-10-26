const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const app = express();
app.use(express.json());

// Set up CORS
app.use(cors({
  origin: 'https://emission-vert.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// Database connection
let connection;

function createConnection() {
  connection = mysql.createConnection({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    idleTimeout: 300000,
    maxReconnects: 3,
    reconnectDelay: 2000
  });

  connection.connect((err) => {
    if (err) {
      console.error('Error connecting to MySQL:', err);
      setTimeout(createConnection, 2000);
      return;
    }
    console.log('Connected to MySQL database');
  });

  connection.on('error', (err) => {
    console.error('MySQL connection error:', err);
    if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
      console.log('Reconnecting to MySQL...');
      createConnection();
    } else {
      throw err;
    }
  });
}

createConnection();

function queryDatabase(query, params, callback) {
  if (typeof params === 'function') {
    callback = params;
    params = [];
  }

  function executeQuery() {
    if (!connection || connection.state === 'disconnected') {
      createConnection();
      setTimeout(() => executeQuery(), 1000);
      return;
    }

    connection.query(query, params, (err, results) => {
      if (err && (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT')) {
        console.log('Connection lost, reconnecting...');
        createConnection();
        setTimeout(() => executeQuery(), 1000);
        return;
      }
      callback(err, results);
    });
  }

  executeQuery();
}

let totpSecrets = {};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Check email endpoint
app.post('/check-email', (req, res) => {
  const { email } = req.body;
  const query = 'SELECT * FROM users WHERE email = ?';

  queryDatabase(query, [email], (err, results) => {
    if (err) {
      console.error('Error checking email:', err);
      return res.status(500).json({ error: 'Internal Server Error' });
    }

    if (results.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  });
});

// Register endpoint
app.post('/register', (req, res) => {
  const { name, email, password, organization, region, device, cpu, gpu, ram, capacity, motherboard, psu } = req.body;

  const userQuery = `
    INSERT INTO users (name, email, password, organization, region, profile_image, current_device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  queryDatabase(userQuery, [name, email, password, organization, region, null, null], (err, results) => {
    if (err) {
      console.error('Error inserting data into the users table:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const userId = results.insertId;
    const deviceQuery = `
      INSERT INTO user_devices (user_id, device, cpu, gpu, ram, capacity, motherboard, psu)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    queryDatabase(deviceQuery, [userId, device, cpu, gpu, ram, capacity, motherboard, psu], (err, deviceResult) => {
      if (err) {
        console.error('Error inserting data into the user_devices table:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const deviceId = deviceResult.insertId;
      
      const updateUserQuery = `
        UPDATE users SET current_device_id = ? WHERE id = ?
      `;
      
      queryDatabase(updateUserQuery, [deviceId, userId], (err) => {
        if (err) {
          console.error('Error updating user with current device ID:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        res.status(200).json({ message: 'User registered successfully' });
      });
    });
  });
});

// Login endpoint
app.post('/login', (req, res) => {
  const { email, password } = req.body;

  const userQuery = `
    SELECT id, name, email, current_device_id FROM users WHERE email = ? AND password = ?
  `;

  queryDatabase(userQuery, [email, password], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length > 0) {
      const user = results[0];
      const token = jwt.sign({ email: user.email, id: user.id }, JWT_SECRET, { expiresIn: '7d' });

      const deviceQuery = `
        SELECT id, device, cpu, gpu, ram, capacity, motherboard, psu FROM user_devices WHERE user_id = ?
      `;

      queryDatabase(deviceQuery, [user.id], (err, deviceResults) => {
        if (err) {
          console.error('Error querying the user_devices table:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const currentDevice = deviceResults.find(device => device.id === user.current_device_id);

        res.status(200).json({
          message: 'Login successful',
          token,
          userId: user.id,
          name: user.name,
          email: user.email,
          devices: deviceResults,
          currentDevice
        });
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

// Get user endpoint
app.get('/user', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const userQuery = `
    SELECT id, name, email, organization, region, profile_image
    FROM users 
    WHERE id = ?
  `;

  queryDatabase(userQuery, [userId], (err, userResults) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (userResults.length > 0) {
      const user = userResults[0];
      const profileImageUrl = user.profile_image ? `https://emissionserver.vercel.app/uploads/${user.profile_image}` : null;
      user.profile_image = profileImageUrl;

      const deviceQuery = `
        SELECT device, cpu, gpu, ram, capacity, motherboard, psu 
        FROM user_devices 
        WHERE user_id = ?
      `;

      queryDatabase(deviceQuery, [user.id], (err, deviceResults) => {
        if (err) {
          console.error('Error querying the user_devices table:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        res.status(200).json({ user, devices: deviceResults });
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
});

// Generate TOTP endpoint
app.post('/generate-totp', async (req, res) => {
  const { email } = req.body;

  const secret = speakeasy.generateSecret({ name: `EmissionSense (${email})` });
  totpSecrets[email] = secret.base32;

  const qr = await qrcode.toDataURL(secret.otpauth_url);
  res.json({ secret: secret.base32, qr });
});

// Validate TOTP endpoint
app.post('/validate-totp', async (req, res) => {
  const { email, token, newPassword } = req.body;
  const secret = totpSecrets[email];

  if (!secret) {
    return res.status(400).json({ error: 'No TOTP secret found for this email' });
  }

  const verified = speakeasy.totp.verify({
    secret: secret,
    encoding: 'base32',
    token: token,
    window: 2
  });

  if (!verified) {
    return res.status(400).json({ error: 'Invalid TOTP token' });
  }

  const query = 'UPDATE users SET password = ? WHERE email = ?';
  queryDatabase(query, [newPassword, email], (err, results) => {
    if (err) {
      console.error('Error updating password:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    delete totpSecrets[email];
    res.status(200).json({ message: 'Password updated successfully' });
  });
});

// Send reset email endpoint
app.post('/send-reset-email', async (req, res) => {
  const { email } = req.body;

  const query = 'SELECT * FROM users WHERE email = ?';
  queryDatabase(query, [email], async (err, results) => {
    if (err || results.length === 0) {
      return res.status(404).json({ error: 'Email not found' });
    }

    const resetToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '1h' });
    const resetLink = `https://emission-vert.vercel.app/reset-password?token=${resetToken}`;

    const mailOptions = {
      from: process.env.EMAIL_USER,
      to: email,
      subject: 'Password Reset',
      html: `<p>Click <a href="${resetLink}">here</a> to reset your password</p>`
    };

    transporter.sendMail(mailOptions, (err, info) => {
      if (err) {
        console.error('Error sending email:', err);
        return res.status(500).json({ error: 'Error sending email' });
      }
      res.status(200).json({ message: 'Reset email sent' });
    });
  });
});

// Reset password endpoint
app.post('/resetpassword', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    const query = 'UPDATE users SET password = ? WHERE email = ?';
    queryDatabase(query, [newPassword, decoded.email], (err, results) => {
      if (err) {
        console.error('Error resetting password:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ message: 'Password reset successfully' });
    });
  } catch (error) {
    res.status(400).json({ error: 'Invalid or expired token' });
  }
});

module.exports = app;
