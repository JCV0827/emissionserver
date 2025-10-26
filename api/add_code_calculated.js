const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const app = express();
app.use(express.json());

// Set up global CORS headers
app.use(cors({
  origin: 'https://emission-vert.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

// Create MySQL connection with reconnection handling
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
      setTimeout(createConnection, 2000); // Retry connection after 2 seconds
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

// Initialize connection
createConnection();

// Wrapper function for database queries with reconnection handling
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

// Canonical project stages (used for gating code analysis additions)
const CANONICAL_STAGES = [
  'Design: Creating the software architecture',
  'Development: Writing the actual code',
  'Testing: Ensuring the software works as expected'
];

// Middleware to protect routes
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

// Add code analysis result to a project stage with gating and metadata
app.post('/add_code_calculated', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { project_id, stage, emissions_gco2, energy_kwh, eco_score, time_complexity, space_complexity } = req.body;

  console.log('=== /add_code_calculated called ===');
  console.log('Request body:', req.body);
  console.log('User ID:', userId);

  // Validate required fields
  if (!project_id || !stage) {
    console.log('Missing project_id or stage');
    return res.status(400).json({ error: 'Missing required fields: project_id and stage' });
  }

  if (emissions_gco2 == null) {
    console.log('Missing emissions_gco2');
    return res.status(400).json({ error: 'Missing required field: emissions_gco2' });
  }

  if (!CANONICAL_STAGES.includes(stage)) {
    console.log('Invalid stage:', stage);
    return res.status(400).json({ error: 'Invalid stage. Must be one of: ' + CANONICAL_STAGES.join(', ') });
  }

  // Verify user is owner/member of the project
  const accessSql = `
    SELECT uh.id, uh.stage as current_stage
    FROM user_history uh
    LEFT JOIN project_members pm ON pm.project_id = uh.id AND pm.user_id = ?
    WHERE uh.id = ? AND (uh.user_id = ? OR pm.user_id IS NOT NULL)
    LIMIT 1`;

  try {
    const accessCheck = await new Promise((resolve, reject) => {
      queryDatabase(accessSql, [userId, project_id, userId], (err, rows) => {
        if (err) {
          console.error('Access check error:', err);
          return reject(err);
        }
        resolve(rows && rows.length > 0 ? rows[0] : null);
      });
    });

    if (!accessCheck) {
      console.log('Project not found or no access');
      return res.status(404).json({ error: 'Project not found or no access' });
    }

    console.log('Access check passed. Current stage:', accessCheck.current_stage);

    // Gating: requested stage must be reached (<= current stage)
    const currentStage = accessCheck.current_stage;
    if (!currentStage) {
      console.log('Unable to determine current project stage');
      return res.status(400).json({ error: 'Unable to determine current project stage' });
    }

    const reqIdx = CANONICAL_STAGES.indexOf(stage);
    const curIdx = CANONICAL_STAGES.indexOf(currentStage);
    
    console.log('Stage indices - Requested:', reqIdx, 'Current:', curIdx);

    if (curIdx === -1) {
      console.log('Project current stage is not recognized:', currentStage);
      return res.status(400).json({ error: 'Project current stage is not recognized' });
    }

    if (reqIdx > curIdx) {
      console.log('Stage not reached yet');
      return res.status(400).json({ 
        error: `Stage not reached yet. Current stage is "${currentStage}". Cannot add code analysis to "${stage}".` 
      });
    }

    // Fetch base project properties
    const baseSql = `SELECT user_id, organization, project_name, project_description,
                            stage_duration, stage_start_date, stage_due_date,
                            project_start_date, project_due_date, status
                     FROM user_history WHERE id = ? LIMIT 1`;

    queryDatabase(baseSql, [project_id], (baseErr, baseRows) => {
      if (baseErr) {
        console.error('Error fetching project base row:', baseErr);
        return res.status(500).json({ error: 'Database error fetching project details' });
      }
      if (!baseRows || baseRows.length === 0) {
        console.log('Project not found in user_history');
        return res.status(404).json({ error: 'Project not found' });
      }

      const base = baseRows[0];
      console.log('Base project data:', base);

      // Insert a new user_history row representing this code analysis
      const insertSql = `
        INSERT INTO user_history (
          user_id, organization, project_name, project_description,
          session_duration, carbon_emit, stage, status,
          stage_duration, stage_start_date, stage_due_date,
          project_start_date, project_due_date,
          project_id, entry_type, is_deleted, energy_kwh, eco_score, 
          time_complexity, space_complexity, carbon_unit, source
        ) VALUES (
          ?, ?, ?, ?,
          0, ?, ?, ?,
          ?, ?, ?,
          ?, ?,
          ?, 'code', 0, ?, ?, 
          ?, ?, 'gco2', 'code_calculator'
        )`;

      const params = [
        base.user_id, base.organization, base.project_name, base.project_description,
        emissions_gco2, stage, (base.status || 'In Progress'),
        base.stage_duration, base.stage_start_date, base.stage_due_date,
        base.project_start_date, base.project_due_date,
        project_id, energy_kwh || 0, eco_score || null, 
        time_complexity || null, space_complexity || null
      ];

      console.log('Inserting code analysis with params:', params);

      queryDatabase(insertSql, params, (err, result) => {
        if (err) {
          console.error('Error inserting code analysis:', err);
          return res.status(500).json({ 
            error: 'Database error inserting code analysis', 
            details: err.message 
          });
        }

        console.log('Code analysis inserted successfully. ID:', result.insertId);

        // Return accumulated emissions for this stage
        const sumSql = `SELECT COALESCE(SUM(carbon_emit),0) AS accumulated_emissions
                        FROM user_history
                        WHERE project_id = ? AND stage = ? AND entry_type = 'code' AND is_deleted = 0`;

        queryDatabase(sumSql, [project_id, stage], (sumErr, sumRows) => {
          if (sumErr) {
            console.error('Error summing code analyses:', sumErr);
            return res.status(201).json({ 
              message: 'Code analysis added', 
              id: result.insertId,
              accumulated_emissions: emissions_gco2 
            });
          }

          const accumulated = (sumRows && sumRows[0] && sumRows[0].accumulated_emissions) || 0;
          console.log('Total accumulated emissions for stage:', accumulated);

          return res.status(200).json({ 
            message: 'Code analysis added successfully', 
            id: result.insertId, 
            accumulated_emissions: accumulated 
          });
        });
      });
    });
  } catch (e) {
    console.error('add_code_calculated failed:', e);
    return res.status(500).json({ error: 'Server error', details: e.message });
  }
});

module.exports = app;