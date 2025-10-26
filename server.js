const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const mysql = require('mysql2');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

// Import route modules
const createAuthRoutes = require('./routes/auth');
const createProjectRoutes = require('./routes/projects');
const createEmissionRoutes = require('./routes/emissions');
const createUtilityRoutes = require('./routes/utilities');
const createAdminRoutes = require('./routes/admin');
const createCollaborationRoutes = require('./routes/collaboration');
const createCodeAnalysisRoutes = require('./routes/codeAnalysis');
const createAdvancedAdminRoutes = require('./routes/advancedAdmin');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// MySQL Connection Setup
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

function ensureConnection(callback) {
  if (!connection || connection.state === 'disconnected') {
    createConnection();
    setTimeout(() => {
      callback();
    }, 1000);
  } else {
    callback();
  }
}

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

function executeTransaction(transactionCallback) {
  function startTransaction() {
    if (!connection || connection.state === 'disconnected') {
      createConnection();
      setTimeout(startTransaction, 1000);
      return;
    }

    connection.beginTransaction((err) => {
      if (err) {
        console.error('Error starting transaction:', err);
        return setTimeout(startTransaction, 1000);
      }
      transactionCallback(connection);
    });
  }

  startTransaction();
}

createConnection();

// Utility function to check and update project completion status
const checkAndUpdateProjectCompletion = (projectId, callback) => {
  const getMembersQuery = `
    SELECT user_id, progress_status, role
    FROM project_members 
    WHERE project_id = ? AND role <> 'project_owner'
  `;
  console.log(`Checking project completion for project ID: ${projectId}`);
  
  queryDatabase(getMembersQuery, [projectId], (err, members) => {
    if (err) {
      console.error('Error fetching project members:', err);
      return callback(err);
    }

    if (members.length === 0) {
      return callback(null);
    }

    const allComplete = members.every(member => member.progress_status === 'Complete');

    if (allComplete) {
      const updateQuery = 'UPDATE user_history SET status = "Complete" WHERE id = ?';
      queryDatabase(updateQuery, [projectId], (updateErr) => {
        if (updateErr) {
          console.error('Error updating project status:', updateErr);
          return callback(updateErr);
        }
        console.log(`Project ${projectId} marked as complete`);
        callback(null);
      });
    } else {
      callback(null);
    }
  });
};

// Emission factors utilities
const { getFactor: getStaticFactor, getRegions } = require('./emissionFactors');
const { getLiveFactor } = require('./dynamicCarbonProvider');

async function resolveCarbonFactorWithSource({ region, zone, lat, lon } = {}) {
  const envOverride = process.env.FORCE_CARBON_FACTOR_KG_PER_KWH;
  if (envOverride) {
    return { factor: parseFloat(envOverride), source: 'env_override' };
  }
  const live = await getLiveFactor({ region, zone, lat, lon });
  if (typeof live === 'number' && live > 0) {
    return { factor: live, source: 'live' };
  }
  return { factor: getStaticFactor(region), source: 'static' };
}

async function resolveCarbonFactor({ region, zone, lat, lon } = {}) {
  const { factor } = await resolveCarbonFactorWithSource({ region, zone, lat, lon });
  return factor;
}

// CORS and Middleware Setup
app.use(cors({
  origin: 'https://emission-vert.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Uploads Directory Setup
const uploadsDir = process.env.NODE_ENV === 'production' 
  ? '/tmp/uploads' 
  : path.join(__dirname, 'uploads');

try {
  if (!fs.existsSync(uploadsDir)) {
    fs.mkdirSync(uploadsDir, { recursive: true });
  }
} catch (error) {
  console.error('Failed to create uploads directory:', error);
}

// Serve uploads with headers
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://emission-vert.vercel.app');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cache-Control', 'max-age=3600');
  next();
}, express.static(uploadsDir, {
  fallthrough: false
}), (err, req, res, next) => {
  if (err.status === 404) {
    res.status(404).json({ error: 'Image not found' });
  } else {
    res.status(500).json({ error: 'Error serving image' });
  }
});

// Multer Setup
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir);
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname));
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpg|jpeg|png|gif/;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = fileTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true);
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

// Authentication Middleware
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

const authenticateAdmin = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (token == null) return res.sendStatus(401);

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err || user.role !== 'admin') return res.sendStatus(403);
    req.user = user;
    next();
  });
};

// Root Route
app.get('/', (req, res) => {
  res.status(200).json({ 
    message: 'Emission Server API is running',
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.get('/protected', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'This is a protected route', user: req.user });
});

// Register all route modules
app.use('/', createAuthRoutes(queryDatabase, upload, authenticateToken));
app.use('/', createProjectRoutes(queryDatabase, authenticateToken, checkAndUpdateProjectCompletion));
app.use('/', createEmissionRoutes(queryDatabase, authenticateToken, resolveCarbonFactor, resolveCarbonFactorWithSource, getRegions));
app.use('/', createUtilityRoutes(queryDatabase, authenticateToken));
app.use('/', createAdminRoutes(queryDatabase, authenticateAdmin));
app.use('/', createCollaborationRoutes(queryDatabase, authenticateToken, authenticateAdmin));
app.use('/', createCodeAnalysisRoutes(queryDatabase, authenticateToken));
app.use('/', createAdvancedAdminRoutes(queryDatabase, authenticateAdmin, authenticateToken));

module.exports = app;
