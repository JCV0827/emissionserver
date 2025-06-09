const express = require('express');
const cors = require('cors');
const fs = require('fs');
const bodyParser = require('body-parser');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const mysql = require('mysql2');
const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const nodemailer = require('nodemailer');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key'; // Use environment variable for secret key

let totpSecrets = {};

// Create MySQL connection
const connection = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: process.env.DB_PORT,
});

connection.connect((err) => {
  if (err) {
    console.error('Error connecting to MySQL:', err);
    return;
  }
  console.log('Connected to MySQL database');
});

// Utility function to check and update project completion status
const checkAndUpdateProjectCompletion = (projectId, callback) => {
  // Step 1: Get all project members excluding project_owner role
  const getMembersQuery = `
    SELECT user_id, progress_status, role
    FROM project_members 
    WHERE project_id = ? AND role != 'project_owner'
  `;

  console.log(`Checking project completion for project ID: ${projectId}`);
  
  connection.query(getMembersQuery, [projectId], (err, members) => {
    if (err) {
      console.error('Error checking project members:', err);
      return callback(err, false);
    }

    console.log(`Found ${members.length} contributing members for project ${projectId}`);
    console.log('Member statuses:', members.map(m => `${m.user_id}: ${m.progress_status} (${m.role})`));

    // If there are no contributing members, we can't determine completion
    if (members.length === 0) {
      console.log(`Project ${projectId} has no contributing members.`);
      return callback(null, false);
    }

    // Step 2: Check if all contributing members have 'Stage Complete' status
    const allCompleted = members.every(member => member.progress_status === 'Stage Complete');
    console.log(`All members completed: ${allCompleted}`);
    
    if (allCompleted) {
      // Step 3: Update project status to 'Complete'
      const updateProjectQuery = `
        UPDATE user_history 
        SET status = 'Complete' 
        WHERE id = ?
      `;

      connection.query(updateProjectQuery, [projectId], (err, result) => {
        if (err) {
          console.error('Error updating project status:', err);
          return callback(err, false);
        }

        console.log(`Project ${projectId} marked as Complete. Affected rows: ${result.affectedRows}`);
        callback(null, true);
      });
    } else {
      callback(null, false);
    }  });
};

// Function to get carbon factor based on region
const getCarbonFactor = (region) => {
  const carbonFactors = {
    'Singapore': 0.412,
    'Philippines': 0.5246
  };
  
  return carbonFactors[region] || 0.412; // Default to Singapore's factor if region not found
};

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER, // Your email address
    pass: process.env.EMAIL_PASS, // Your email password or app password
  },
});

// Set up global CORS headers
app.use(cors({
  origin: 'https://emission-vert.vercel.app',
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization']
}));

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Update the uploads directory to use the folder path relative to this server.js file
const uploadsDir = process.env.NODE_ENV === 'production' 
  ? '/data/uploads' 
  : path.join(__dirname, 'uploads');

// Ensure the uploads directory exists
if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

// Serve static files from uploads directory with proper headers and error handling
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', 'https://emission-vert.vercel.app');
  res.header('Cross-Origin-Resource-Policy', 'cross-origin');
  res.header('Cache-Control', 'max-age=3600'); // Cache images for 1 hour
  next();
}, express.static(uploadsDir, {
  fallthrough: false // Return 404 if file doesn't exist
}), (err, req, res, next) => {
  if (err.status === 404) {
    res.status(404).json({ error: 'Image not found' });
  } else {
    res.status(500).json({ error: 'Error serving image' });
  }
});

  app.post('/check-email', (req, res) => {
    const { email } = req.body;
    const query = 'SELECT * FROM users WHERE email = ?'; // Replace 'users' with your table name
  
    connection.query(query, [email], (err, results) => {
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

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadsDir); // Save to uploads directory
  },
  filename: (req, file, cb) => {
    cb(null, Date.now() + path.extname(file.originalname)); // Append timestamp to filename
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // Limit file size to 5MB
  fileFilter: (req, file, cb) => {
    const fileTypes = /jpg|jpeg|png|gif/;
    const extname = fileTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = fileTypes.test(file.mimetype);
    if (extname && mimetype) {
      return cb(null, true); // Accept the file
    } else {
      cb(new Error('Only image files are allowed.'));
    }
  }
});

// File upload route
app.post('/upload', upload.single('profileImage'), (req, res) => {
  if (!req.file) {
    return res.status(400).send('No file uploaded.');
  }

  res.status(200).send({ fileName: req.file.filename });
});

// Serve the uploads folder
app.use('/uploads', express.static(uploadsDir));

  app.post('/check-email', (req, res) => {
    const { email } = req.body;
    const query = 'SELECT * FROM users WHERE email = ?'; // Replace 'users' with your table name
  
    connection.query(query, [email], (err, results) => {
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

// Endpoint to insert user data into the MySQL database
app.post('/register', upload.single('profilePicture'), (req, res) => {
  const { name, email, password, organization, region, device, cpu, gpu, ram, capacity, motherboard, psu } = req.body;
  const profilePicture = req.file ? req.file.filename : null;

  const userQuery = `
    INSERT INTO users (name, email, password, organization, region, profile_image, current_device_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;

  connection.query(userQuery, [name, email, password, organization, region, profilePicture, null], (err, results) => {
    if (err) {
      console.error('Error inserting data into the users table:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const userId = results.insertId;
    const deviceQuery = `
      INSERT INTO user_devices (user_id, device, cpu, gpu, ram, capacity, motherboard, psu)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

  connection.query(deviceQuery, [userId, device, cpu, gpu, ram, capacity, motherboard, psu], (err, deviceResult) => {
      if (err) {
        console.error('Error inserting data into the user_devices table:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      // Get the newly inserted device ID
      const deviceId = deviceResult.insertId;
      
      // Update the user's current_device_id with the newly inserted device ID
      const updateUserQuery = `
        UPDATE users SET current_device_id = ? WHERE id = ?
      `;
      
      connection.query(updateUserQuery, [deviceId, userId], (err) => {
        if (err) {
          console.error('Error updating user with current device ID:', err);
          return res.status(500).json({ error: 'Database error' });
        }
        
        const profileImageUrl = profilePicture ? `https://emission-vert.vercel.app/uploads/${profilePicture}` : null;
        res.status(200).json({ message: 'User registered successfully', profileImageUrl });
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

  connection.query(userQuery, [email, password], (err, results) => {
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

      connection.query(deviceQuery, [user.id], (err, deviceResults) => {
        if (err) {
          console.error('Error querying the user_devices table:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        const currentDevice = deviceResults.find(device => device.id === user.current_device_id);

        if (currentDevice) {
          // Fetch average watt usage for CPU and GPU
          const cpuQuery = 'SELECT avg_watt_usage FROM cpus WHERE model = ?';
          const gpuQuery = 'SELECT avg_watt_usage FROM gpus WHERE model = ?';

          connection.query(cpuQuery, [currentDevice.cpu], (err, cpuResult) => {
            if (err) {
              console.error('Error querying CPU database:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            currentDevice.cpuAvgWattUsage = cpuResult[0]?.avg_watt_usage || null;

            connection.query(gpuQuery, [currentDevice.gpu], (err, gpuResult) => {
              if (err) {
                console.error('Error querying GPU database:', err);
                return res.status(500).json({ error: 'Database error' });
              }

              currentDevice.gpuAvgWattUsage = gpuResult[0]?.avg_watt_usage || null;

              // Send response with current device including watt usage
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
          });
        } else {
          res.status(200).json({
            message: 'Login successful',
            token,
            userId: user.id,
            name: user.name,
            email: user.email,
            devices: deviceResults,
            currentDevice: null
          });
        }
      });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

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

// Middleware to authenticate admin
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

// Endpoint to fetch user's name and email after login
app.get('/user', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const userQuery = `
    SELECT id, name, email, organization, region, profile_image
    FROM users 
    WHERE id = ?
  `;

  connection.query(userQuery, [userId], (err, userResults) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (userResults.length > 0) {
      const user = userResults[0];
      const profileImageUrl = user.profile_image ? `https://emissionserver.vercel.app//uploads/${user.profile_image}` : null;
      user.profile_image = profileImageUrl;

      const deviceQuery = `
        SELECT device, cpu, gpu, ram, capacity, motherboard, psu 
        FROM user_devices 
        WHERE user_id = ?
      `;

      connection.query(deviceQuery, [user.id], (err, deviceResults) => {
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

app.post('/user_history', authenticateToken, (req, res) => {
  const { organization, projectName, projectDescription, sessionDuration, carbonEmit, projectStage, status } = req.body;
  const userId = req.user.id;

  // Set default values for timeline fields with more robust date handling
  const now = new Date();
  const stage_start_date = req.body.stage_start_date || now.toISOString().split('T')[0];
  const stage_duration = req.body.stage_duration || 14;
  
  // Calculate stage_due_date based on stage_duration
  const due_date = new Date(stage_start_date);
  due_date.setDate(due_date.getDate() + stage_duration);
  const stage_due_date = req.body.stage_due_date || due_date.toISOString().split('T')[0];
  
  // Set project dates
  const project_start_date = req.body.project_start_date || stage_start_date;
  const project_due_date = req.body.project_due_date || stage_due_date;

  // Validate dates
  const dates = [stage_start_date, stage_due_date, project_start_date, project_due_date];
  for (const date of dates) {
    if (isNaN(new Date(date).getTime())) {
      return res.status(400).json({ error: 'Invalid date format' });
    }
  }

  const query = `
    INSERT INTO user_history (
      user_id, organization, project_name, project_description, 
      session_duration, carbon_emit, stage, status,
      stage_duration, stage_start_date, stage_due_date,
      project_start_date, project_due_date
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;

  connection.query(query, [
    userId, organization, projectName, projectDescription, 
    sessionDuration, carbonEmit, projectStage, status,
    stage_duration, stage_start_date, stage_due_date,
    project_start_date, project_due_date
  ], (err, results) => {
    if (err) {
      console.error('Error inserting session data into the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ 
      message: 'Session recorded successfully',
      projectId: results.insertId,
      timeline: {
        stage_duration,
        stage_start_date,
        stage_due_date,
        project_start_date,
        project_due_date
      }
    });
  });
});



// Endpoint to fetch user's projects
app.get('/user_projects', authenticateToken, (req, res) => {
  const userId = req.user.id; // Get the user ID from the authenticated token

  const query = `
    SELECT id, organization, project_name, project_description, session_duration, carbon_emit, stage, status 
    FROM user_history 
    WHERE user_id = ? AND status <> 'Complete'
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ projects: results }); // Send back user's projects
  });
});

app.get('/all_user_projects', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `
    SELECT project_name, SUM(carbon_emit) as total_emissions
    FROM user_history
    WHERE user_id = ?
    GROUP BY project_name
  `;

  console.log('Executing query:', query);
  console.log('With parameters:', [userId]);

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    console.log('Query results:', results);

    // Calculate highest and lowest emissions
    if (results.length > 0) {
      const emissions = results.map(r => r.total_emissions);
      const highestEmission = Math.max(...emissions);
      const lowestEmission = Math.min(...emissions);
      res.status(200).json({ projects: results, highestEmission, lowestEmission });
    } else {
      res.status(200).json({ projects: results, highestEmission: null, lowestEmission: null });
    }
  });
});

app.get('/profile_display_projects', authenticateToken, (req, res) => {
  const userId = req.user.id; // Get the user ID from the authenticated token

  const query = `
    SELECT id, organization, project_name, project_description, session_duration, carbon_emit, stage, status, created_at 
    FROM user_history 
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ projects: results }); // Send back all user's projects
  });
});

// Endpoint to fetch user's projects
app.get('/user_project_display', authenticateToken, (req, res) => {
  const userId = req.user.id; // Get the user ID from the authenticated token

  const query = `
    SELECT id, organization, project_name, project_description, session_duration, carbon_emit, stage, status 
    FROM user_history 
    WHERE user_id = ? AND status
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ projects: results }); // Send back user's projects
  });
});

// Endpoint to update a project
app.put('/update_project/:id', authenticateToken, (req, res) => {
  const projectId = req.params.id;
  const userId = req.user.id;
  const { 
    projectName, 
    projectDescription, 
    projectStage,
    stage_duration,
    stage_start_date,
    stage_due_date,
    project_due_date 
  } = req.body;

  console.log('Update request received:', {
    projectId,
    userId,
    projectName,
    projectDescription,
    projectStage,
    stage_duration,
    stage_start_date,
    stage_due_date,
    project_due_date
  });

  // Convert dates to YYYY-MM-DD format if needed
  const formattedStageStartDate = stage_start_date ? new Date(stage_start_date).toISOString().split('T')[0] : null;
  const formattedProjectDueDate = project_due_date ? new Date(project_due_date).toISOString().split('T')[0] : null;

  // Updated query to also update timeline fields
  const query = `
    UPDATE user_history 
    SET project_name = ?,
        project_description = ?,
        stage = ?,
        stage_duration = ?,
        stage_start_date = ?,
        stage_due_date = ?,
        project_due_date = ?
    WHERE id = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?))
  `;

  connection.query(query, [
    projectName,
    projectDescription,
    projectStage || 'Design: Creating the software architecture',
    stage_duration || 14,
    formattedStageStartDate,
    stage_due_date,
    formattedProjectDueDate,
    projectId,
    userId,
    userId
  ], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    if (results.affectedRows === 0) {
      console.log('No rows affected');
      return res.status(404).json({ error: 'Project not found or no permission to update' });
    }

    console.log('Update successful:', results);
    res.status(200).json({ 
      message: 'Project updated successfully',
      projectId: projectId,
      affectedRows: results.affectedRows
    });
  });
});

app.post('/user_Update', authenticateToken, (req, res) => {
  const { projectName, projectDescription, sessionDuration, carbonEmissions, projectStage, projectId } = req.body;
  const userId = req.user.id; // Get the user ID from the authenticated token

  const query = `
    UPDATE user_history 
    SET session_duration = ?, carbon_emit = ?, stage = ?
    WHERE id = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?)) AND project_name = ? AND project_description = ? AND status <> 'Complete'
  `;

  connection.query(
    query,
    [sessionDuration, carbonEmissions, projectStage, projectId, userId, userId, projectName, projectDescription],
    (err, results) => {
      if (err) {
        console.error('Error updating session data in the database:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'No matching project found to update' });
      }

      res.status(200).json({ message: 'Session updated successfully' });
    }
  );
});


// Endpoint to delete a project
app.delete('/delete_project/:id', authenticateToken, (req, res) => {
  const projectId = req.params.id; // Get project ID from request parameters
  const userId = req.user.id; // Get user ID from the authenticated token

  // First, delete related notifications
  const deleteNotificationsQuery = `
    DELETE FROM notifications WHERE project_id = ?;
  `;

  connection.query(deleteNotificationsQuery, [projectId], (err, results) => {
    if (err) {
      console.error('Error deleting notifications from the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Then, delete related project members
    const deleteProjectMembersQuery = `
      DELETE FROM project_members WHERE project_id = ?;
    `;

    connection.query(deleteProjectMembersQuery, [projectId], (err, results) => {
      if (err) {
        console.error('Error deleting project members from the database:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      // Finally, delete the project
      const deleteProjectQuery = `
        DELETE FROM user_history WHERE id = ? AND user_id = ?;
      `;

      connection.query(deleteProjectQuery, [projectId, userId], (err, results) => {
        if (err) {
          console.error('Error deleting project from the database:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        res.status(200).json({ message: 'Project deleted successfully' });
      });
    });
  });
});

// Endpoint to archive a project
app.put('/archive_project/:id', authenticateToken, (req, res) => {
  const projectId = req.params.id; // Get project ID from request parameters
  const userId = req.user.id; // Get user ID from the authenticated token

  const archiveProjectQuery = `
    UPDATE user_history 
    SET status = 'Archived'
    WHERE id = ? AND user_id = ?;
  `;

  connection.query(archiveProjectQuery, [projectId, userId], (err, results) => {
    if (err) {
      console.error('Error archiving project in the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.affectedRows > 0) {
      res.status(200).json({ message: 'Project archived successfully' });
    } else {
      res.status(404).json({ error: 'Project not found or you do not have permission to archive this project' });
    }
  });
});

// Example of a protected route
app.get('/protected', authenticateToken, (req, res) => {
  res.status(200).json({ message: 'This is a protected route', user: req.user });
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

// Endpoint to find a project by name and description
app.post('/find_project', authenticateToken, (req, res) => {
  const { projectName, projectDescription } = req.body;
  const userId = req.user.id; // Get user ID from the authenticated token

  const query = `
    SELECT session_duration, id, status
    FROM user_history
    WHERE project_name = ? AND project_description = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?)) AND status <> 'Complete'
  `;

  connection.query(query, [projectName, projectDescription, userId, userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length > 0) {
      // Project found, return session duration and project ID
      const project = results[0];
      res.status(200).json({
        session_duration: project.session_duration,
        project_id: project.id,
        project_status: project.status
      });
    } else {
      // No matching project found
      res.status(200).json(null);
    }
  });
});

// Endpoint to find a project by name only
app.post('/check_existing_projectname', authenticateToken, (req, res) => {
  const { projectName } = req.body; // Only check for project name
  const userId = req.user.id; // Get user ID from the authenticated token

  const query = `
    SELECT id
    FROM user_history
    WHERE project_name = ? AND user_id = ?
  `;

  connection.query(query, [projectName, userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length > 0) {
      // Project with the same name found, return exists:true
      console.log('Project with the same name exists');
      return res.status(200).json({ exists: true });
    } else {
      // No matching project found
      console.log('No project found with the same name');
      return res.status(200).json({ exists: false });
    }
  });
});

// Endpoint to calculate carbon emissions for pc personal computer
app.post('/calculate_emissions', authenticateToken, async (req, res) => {
  const { sessionDuration, projectId } = req.body;
  const userId = req.user.id;

  try {
    // Fetch user's current device ID and region
    const deviceIdQuery = `SELECT current_device_id, region FROM users WHERE id = ?`;
    connection.query(deviceIdQuery, [userId], (err, deviceIdResults) => {
      if (err) {
        console.error('Error fetching current device ID:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (deviceIdResults.length === 0 || !deviceIdResults[0].current_device_id) {
        return res.status(404).json({ error: 'Current device not set' });
      }

      const currentDeviceId = deviceIdResults[0].current_device_id;
      const userRegion = deviceIdResults[0].region;

      // Fetch current device details
      const userQuery = `SELECT cpu, gpu, ram, psu FROM user_devices WHERE id = ?`;
      connection.query(userQuery, [currentDeviceId], async (err, userResults) => {
        if (err) {
          console.error('Error fetching user details:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (userResults.length === 0) {
          return res.status(404).json({ error: 'User device information not found' });
        }

        const { cpu, gpu, ram, psu } = userResults[0];

        // Fetch CPU, GPU, and RAM wattage
        const cpuResponse = await fetch(`https://emissionserver.vercel.app//cpu_usage?model=${cpu}`);
        const gpuResponse = await fetch(`https://emissionserver.vercel.app//gpu_usage?model=${gpu}`);
        const ramResponse = await fetch(`https://emissionserver.vercel.app//ram_usage?model=${ram}`);

        if (cpuResponse.ok && gpuResponse.ok && ramResponse.ok) {
          const { avg_watt_usage: cpuWattUsage } = await cpuResponse.json();
          const { avg_watt_usage: gpuWattUsage } = await gpuResponse.json();
          const { avg_watt_usage: ramWattUsage } = await ramResponse.json();

          const psuWattUsage = Number(psu);

          // Ensure wattage values are numbers
          const totalWattUsage = Number(cpuWattUsage) + Number(gpuWattUsage) + Number(ramWattUsage) + psuWattUsage;

          // Calculate energy used (in watt-hours)
          const sessionDurationSeconds = Number(sessionDuration);
          const totalEnergyUsed = (totalWattUsage / 3600) * sessionDurationSeconds;

          // Get carbon factor based on user's region
          const carbonFactor = getCarbonFactor(userRegion);
          const carbonEmissions = totalEnergyUsed * carbonFactor;

          // Update the project with the calculated emissions
          const updateProjectQuery = `
            UPDATE user_history 
            SET carbon_emit = carbon_emit + ?
            WHERE id = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?))
          `;

          connection.query(updateProjectQuery, [carbonEmissions, projectId, userId, userId], (err, results) => {
            if (err) {
              console.error('Error updating project emissions:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            res.status(200).json({ carbonEmissions });
          });
        } else {
          return res.status(500).json({ error: 'Error fetching wattage data' });
        }
      });
    });
  } catch (error) {
    console.error('Error calculating carbon emissions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Check CPU watt usage for pc personal computer
app.get('/cpu_usage', (req, res) => {
  const { model } = req.query;
  const query = 'SELECT avg_watt_usage FROM cpus WHERE model = ?';
  
  connection.query(query, [model], (err, results) => {
    if (err) {
      console.error('Error querying CPU database:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results.length > 0) {
      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    } else {
      res.status(404).json({ error: 'CPU not found' });
    }
  });
});

// Check GPU watt usage for pc personal computer
app.get('/gpu_usage', (req, res) => {
  const { model } = req.query;
  const query = 'SELECT avg_watt_usage FROM gpus WHERE model = ?';
  
  connection.query(query, [model], (err, results) => {
    if (err) {
      console.error('Error querying GPU database:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results.length > 0) {
      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    } else {
      res.status(404).json({ error: 'GPU not found' });
    }
  });
});

// Endpoint to calculate carbon emissions for mobile or laptop
app.post('/calculate_emissionsM', authenticateToken, async (req, res) => {
  const { sessionDuration, projectId } = req.body;
  const userId = req.user.id;

  try {
    // Fetch user's current device ID and region
    const deviceIdQuery = `SELECT current_device_id, region FROM users WHERE id = ?`;
    connection.query(deviceIdQuery, [userId], (err, deviceIdResults) => {
      if (err) {
        console.error('Error fetching current device ID:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (deviceIdResults.length === 0 || !deviceIdResults[0].current_device_id) {
        return res.status(404).json({ error: 'Current device not set' });
      }

      const currentDeviceId = deviceIdResults[0].current_device_id;
      const userRegion = deviceIdResults[0].region;

      // Fetch current device details
      const userQuery = `SELECT cpu, gpu, ram, psu FROM user_devices WHERE id = ?`;
      connection.query(userQuery, [currentDeviceId], async (err, userResults) => {
        if (err) {
          console.error('Error fetching user details:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (userResults.length === 0) {
          return res.status(404).json({ error: 'User device information not found' });
        }

        const { cpu, gpu, ram, psu } = userResults[0];

        // Fetch CPU, GPU, and RAM wattage from mobile tables
        const cpuResponse = await fetch(`https://emissionserver.vercel.app//cpum_usage?model=${cpu}`);
        const gpuResponse = await fetch(`https://emissionserver.vercel.app//gpum_usage?model=${gpu}`);
        const ramResponse = await fetch(`https://emissionserver.vercel.app//ram_usage?model=${ram}`);

        if (cpuResponse.ok && gpuResponse.ok && ramResponse.ok) {
          const cpuData = await cpuResponse.json();
          const gpuData = await gpuResponse.json();
          const ramData = await ramResponse.json();

          const cpuWattage = cpuData.avg_watt_usage;
          const gpuWattage = gpuData.avg_watt_usage;
          const ramWattage = ramData.avg_watt_usage;

          /// Calculate total wattage
          const totalWattage = cpuWattage + gpuWattage + ramWattage;

          // Get carbon factor based on user's region
          const carbonFactor = getCarbonFactor(userRegion);
          // Calculate carbon emissions
          const carbonEmissions = ((totalWattage * sessionDuration) / 3600) * carbonFactor;

          // Update the project with the new carbon emissions and session duration
          const updateQuery = `
            UPDATE user_history
            SET session_duration = session_duration + ?, carbon_emit = carbon_emit + ?
            WHERE id = ? AND user_id = ?
          `;

          connection.query(updateQuery, [sessionDuration, carbonEmissions, projectId, userId], (err, updateResults) => {
            if (err) {
              console.error('Error updating project data:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            res.status(200).json({ message: 'Carbon emissions calculated successfully', carbonEmissions });
          });

        } else {
          console.error('Error fetching wattage data from server');
          res.status(500).json({ error: 'Error fetching wattage data from server' });
        }
      });
    });
  } catch (error) {
    console.error('Error calculating carbon emissions:', error);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// Check CPU watt usage for mobile or laptop
app.get('/cpum_usage', (req, res) => {
  const { model } = req.query;
  const query = 'SELECT cpu_watts AS avg_watt_usage FROM cpusm WHERE model = ?';
  
  connection.query(query, [model], (err, results) => {
    if (err) {
      console.error('Error querying CPU database:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results.length > 0) {
      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    } else {
      res.status(404).json({ error: 'CPU not found' });
    }
  });
});

// Check GPU watt usage for mobile or laptop
app.get('/gpum_usage', (req, res) => {
  const { model } = req.query;
  const query = 'SELECT gpu_watts AS avg_watt_usage FROM gpusm WHERE model = ?';
  
  connection.query(query, [model], (err, results) => {
    if (err) {
      console.error('Error querying GPU database:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results.length > 0) {
      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    } else {
      res.status(404).json({ error: 'GPU not found' });
    }
  });
});

// Check ram watt usage for mobile or laptop
app.get('/ram_usage', (req, res) => {
  const { model } = req.query;
  const query = 'SELECT avg_watt_usage FROM ram WHERE ddr_generation = ?';
  
  connection.query(query, [model], (err, results) => {
    if (err) {
      console.error('Error querying CPU database:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results.length > 0) {
      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    } else {
      res.status(404).json({ error: 'CPU not found' });
    }
  });
});

// Endpoints to fetch available CPU and GPU options
app.get('/cpu-options', (req, res) => {
  const query = 'SELECT manufacturer, series, model FROM cpus';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching GPU options:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Return an array of objects with optionString and model
    const cpuOptions = results.map(row => ({
      label: `${row.manufacturer} ${row.series} ${row.model}`, // Display string
      value: row.model // Unique model value
    }));

    res.status(200).json({ cpuOptions });
  });
});

app.get('/gpu-options', (req, res) => {
  const query = 'SELECT manufacturer, series, model FROM gpus';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching GPU options:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Return an array of objects with optionString and model
    const gpuOptions = results.map(row => ({
      label: `${row.manufacturer} ${row.series} ${row.model}`, // Display string
      value: row.model // Unique model value
    }));

    res.status(200).json({ gpuOptions });
  });
});

app.get('/cpu-options-mobile', (req, res) => {
  const query = 'SELECT generation, model FROM cpusm';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching CPUm options:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Return an array of objects with optionString and model
    const cpuOptions = results.map(row => ({
      label: `${row.generation} ${row.model}`, // Display string
      value: row.model // Unique model value
    }));

    res.status(200).json({ cpuOptions }); // Now matches frontend expectation
  });
});

app.get('/gpu-options-mobile', (req, res) => {
  const query = 'SELECT manufacturer, model FROM gpusm';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching GPUm options:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Return an array of objects with optionString and model
    const gpuOptions = results.map(row => ({
      label: `${row.manufacturer} ${row.model}`, // Display string
      value: row.model // Unique model value
    }));

    res.status(200).json({ gpuOptions }); // Now matches frontend expectation
  });
});

// Endpoint to fetch full user details including organization and device specifications for personal computer
app.get('/displayuser', authenticateToken, (req, res) => {
  const { email } = req.user;

  const userQuery = `
    SELECT id, name, email, organization, region, profile_image, current_device_id
    FROM users 
    WHERE email = ?
  `;

  connection.query(userQuery, [email], (err, userResults) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (userResults.length > 0) {
      const user = userResults[0];
      const profileImageUrl = user.profile_image ? `https://emissionserver.vercel.app//uploads/${user.profile_image}` : null;
      user.profile_image = profileImageUrl;

      const deviceQuery = `
        SELECT id, device, cpu, gpu, ram, capacity, motherboard, psu 
        FROM user_devices 
        WHERE user_id = ? AND id = ?
      `;

      connection.query(deviceQuery, [user.id, user.current_device_id], (err, deviceResults) => {
        if (err) {
          console.error('Error querying the user_devices table:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (deviceResults.length > 0) {
          const device = deviceResults[0];
          const specifications = {
            CPU: device.cpu,
            GPU: device.gpu,
            RAM: device.ram,
            motherboard: device.motherboard,
            PSU: device.psu,
            CPU_avg_watt_usage: null,
            GPU_avg_watt_usage: null
          };

          // Fetch wattage for CPU and GPU
          const cpuQuery = 'SELECT avg_watt_usage FROM cpus WHERE model = ?';
          const gpuQuery = 'SELECT avg_watt_usage FROM gpus WHERE model = ?';

          connection.query(cpuQuery, [device.cpu], (err, cpuResults) => {
            if (err) {
              console.error('Error querying CPU database:', err);
              return res.status(500).json({ error: 'CPU database error' });
            }

            if (cpuResults.length > 0) {
              specifications.CPU_avg_watt_usage = cpuResults[0].avg_watt_usage;
            }

            connection.query(gpuQuery, [device.gpu], (err, gpuResults) => {
              if (err) {
                console.error('Error querying GPU database:', err);
                return res.status(500).json({ error: 'GPU database error' });
              }

              if (gpuResults.length > 0) {
                specifications.GPU_avg_watt_usage = gpuResults[0].avg_watt_usage;
              }

              res.status(200).json({ user: { ...user, specifications }, currentDevice: device });
            });
          });
        } else {
          res.status(200).json({ user, devices: deviceResults });
        }
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
});

// Endpoint to fetch full user details including organization and device specifications for mobile or laptop
app.get('/displayuserM', authenticateToken, (req, res) => {
  const { email } = req.user;

  const userQuery = `
    SELECT id, name, email, organization, profile_image, current_device_id
    FROM users 
    WHERE email = ?
  `;

  connection.query(userQuery, [email], (err, userResults) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (userResults.length > 0) {
      const user = userResults[0];
      const profileImageUrl = user.profile_image ? `https://emissionserver.vercel.app//uploads/${user.profile_image}` : null;
      user.profile_image = profileImageUrl;

      const deviceQuery = `
        SELECT id, device, cpu, gpu, ram, capacity, motherboard, psu 
        FROM user_devices 
        WHERE user_id = ? AND id = ?
      `;

      connection.query(deviceQuery, [user.id, user.current_device_id], (err, deviceResults) => {
        if (err) {
          console.error('Error querying the user_devices table:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (deviceResults.length > 0) {
          const device = deviceResults[0];
          const specifications = {
            CPU: device.cpu,
            GPU: device.gpu,
            RAM: device.ram,
            motherboard: device.motherboard,
            PSU: device.psu,
            cpu_watts: null,
            gpu_watts: null
          };

          // Fetch wattage for CPU and GPU
          const cpuQuery = 'SELECT cpu_watts FROM cpusm WHERE model = ?';
          const gpuQuery = 'SELECT gpu_watts FROM gpusm WHERE model = ?';

          connection.query(cpuQuery, [device.cpu], (err, cpuResults) => {
            if (err) {
              console.error('Error querying CPU database:', err);
              return res.status(500).json({ error: 'CPU database error' });
            }

            if (cpuResults.length > 0) {
              specifications.cpu_watts = cpuResults[0].cpu_watts;
            }

            connection.query(gpuQuery, [device.gpu], (err, gpuResults) => {
              if (err) {
                console.error('Error querying GPU database:', err);
                return res.status(500).json({ error: 'GPU database error' });
              }

              if (gpuResults.length > 0) {
                specifications.gpu_watts = gpuResults[0].gpu_watts;
              }

              res.status(200).json({ user: { ...user, specifications }, currentDevice: device });
            });
          });
        } else {
          res.status(200).json({ user, devices: deviceResults });
        }
      });
    } else {
      res.status(404).json({ error: 'User not found' });
    }
  });
});

// Endpoint to check device type (Laptop or Personal Computer)
app.get('/checkDeviceType', authenticateToken, (req, res) => {
  const userId = req.user.id; // Get user ID from the authenticated token

  // First, get the current_device_id from the users table
  const getCurrentDeviceIdQuery = `SELECT current_device_id FROM users WHERE id = ?`;

  connection.query(getCurrentDeviceIdQuery, [userId], (err, result) => {
    if (err) {
      console.error('Error querying current_device_id from database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (result.length > 0 && result[0].current_device_id) {
      const currentDeviceId = result[0].current_device_id;

      // Now, fetch the device type from user_devices using current_device_id
      const getDeviceQuery = `SELECT device FROM user_devices WHERE id = ?`;

      connection.query(getDeviceQuery, [currentDeviceId], (err, deviceResult) => {
        if (err) {
          console.error('Error querying device type from database:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (deviceResult.length > 0) {
          const deviceType = deviceResult[0].device;
          res.status(200).json({ deviceType }); // Return the device type
        } else {
          res.status(404).json({ error: 'Device not found' });
        }
      });
    } else {
      res.status(404).json({ error: 'Current device not set' });
    }
  });
});

// Endpoint to complete user's project stage
app.post('/complete_project/:id', authenticateToken, (req, res) => {
  const projectId = req.params.id;
  const userId = req.user.id;
  const { nextStage, currentStage } = req.body;

  // Define all project stages in order
  const projectStages = [
    'Design: Creating the software architecture',
    'Development: Writing the actual code',
    'Testing: Ensuring the software works as expected'
  ];

  // First get the current project's information
  const getCurrentProjectQuery = `
    SELECT 
      uh.id, uh.user_id as owner_id, 
      u.email as owner_email, u.name as owner_name,
      uh.organization, uh.project_name, uh.project_description,
      uh.stage, uh.project_id, uh.stage_duration, 
      uh.stage_start_date, uh.stage_due_date, 
      uh.project_start_date, uh.project_due_date,
      uh.carbon_emit, uh.session_duration
    FROM user_history uh
    JOIN users u ON uh.user_id = u.id
    WHERE uh.id = ?
    LIMIT 1
  `;

  connection.query(getCurrentProjectQuery, [projectId], (err, results) => {
    if (err) {
      console.error('Error getting current project:', err);
      return res.status(500).json({ error: 'Failed to get current project' });
    }

    if (!results || results.length === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    const currentProject = results[0];
    const nextProjectStage = nextStage || null;
    
    // Begin transaction
    connection.beginTransaction(err => {
      if (err) {
        console.error('Error starting transaction:', err);
        return res.status(500).json({ error: 'Transaction error' });
      }

      // First, mark the current stage as complete in the project_stage_progress table
      const completeCurrentStageQuery = `
        INSERT INTO project_stage_progress (project_id, user_id, stage, status, start_date, completion_date)
        VALUES (?, ?, ?, 'Complete', NOW(), NOW())
        ON DUPLICATE KEY UPDATE status = 'Complete', completion_date = NOW()
      `;
      
      connection.query(completeCurrentStageQuery, [
        projectId, 
        userId, 
        currentStage || currentProject.stage
      ], (err) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Error completing current stage:', err);
            res.status(500).json({ error: 'Failed to complete current stage' });
          });
        }

        // Update current user's progress status to Stage Complete (but don't change current_stage)
        // Only update if the user is NOT a project_owner
        const updateUserProgressQuery = `
          UPDATE project_members 
          SET progress_status = 'Stage Complete'
          WHERE project_id = ? AND user_id = ? AND role != 'project_owner'`;
          
        connection.query(updateUserProgressQuery, [projectId, userId], (err, updateResult) => {
          if (err) {
            return connection.rollback(() => {
              console.error('Error updating user progress:', err);
              res.status(500).json({ error: 'Failed to update user progress' });
            });
          }

          // Check if all members have completed the stage and update project status if needed
          checkAndUpdateProjectCompletion(projectId, (err, allCompleted) => {
            if (err) {
              return connection.rollback(() => {
                console.error('Error checking project completion:', err);
                res.status(500).json({ error: 'Failed to check project completion' });
              });
            }

            // If there's no next stage, just mark this stage as complete for the user and finish
            if (!nextProjectStage) {
              return connection.commit(err => {
                if (err) {
                  return connection.rollback(() => {
                    console.error('Error committing transaction:', err);
                    res.status(500).json({ error: 'Failed to commit transaction' });
                  });
                }
                
                if (allCompleted) {
                  res.json({
                    status: 'Project-Completed',
                    message: 'All team members have completed this project. Project status is now Complete.',
                    stage: currentProject.stage
                  });
                } else {
                  res.json({
                    status: 'User-Stage-Completed',
                    message: 'You have completed this project stage. There are no more stages.',
                    stage: currentProject.stage
                  });
                }
              });
            }

            // Continue with the existing code for handling next stages
            // Check if there's already a project for the next stage
            const checkExistingQuery = `
              SELECT id 
              FROM user_history 
              WHERE 
                project_name = ? AND 
                project_description = ? AND 
                stage = ? AND 
                (project_id = ? OR project_id IS NULL)
              LIMIT 1`;
            
            connection.query(checkExistingQuery, [
              currentProject.project_name, 
              currentProject.project_description,
              nextProjectStage,
              currentProject.project_id || projectId
            ], (err, existingResults) => {
              if (err) {
                return connection.rollback(() => {
                  console.error('Error checking existing project:', err);
                  res.status(500).json({ error: 'Failed to check existing project' });
                });
              }

              if (existingResults.length > 0) {
                // A project for the next stage already exists
                const existingProjectId = existingResults[0].id;

                // Add the current user to the existing next stage project with "In Progress" status
                const checkMembershipQuery = `
                  SELECT id FROM project_members 
                  WHERE project_id = ? AND user_id = ?
                `;
                
                connection.query(checkMembershipQuery, [existingProjectId, userId], (err, membershipResult) => {
                  if (err) {
                    return connection.rollback(() => {
                      console.error('Error checking membership:', err);
                      res.status(500).json({ error: 'Failed to check membership' });
                    });
                  }
                  
                  // If the user is not yet a member of the next stage project, add them
                  if (membershipResult.length === 0) {
                    const addToNextStageQuery = `
                      INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status, joined_at)
                      SELECT ?, user_id, role, ?, 'In Progress', NOW()
                      FROM project_members
                      WHERE project_id = ? AND user_id = ?
                    `;
                    
                    connection.query(addToNextStageQuery, [existingProjectId, nextProjectStage, projectId, userId], (err) => {
                      if (err) {
                        return connection.rollback(() => {
                          console.error('Error adding to next stage:', err);
                          res.status(500).json({ error: 'Failed to add to next stage' });
                        });
                      }
                      
                      connection.commit(err => {
                        if (err) {
                          return connection.rollback(() => {
                            console.error('Error committing transaction:', err);
                            res.status(500).json({ error: 'Failed to commit transaction' });
                          });
                        }
                        
                        if (allCompleted) {
                          res.json({
                            status: 'Stage-Completed',
                            message: 'All team members have completed this stage. Moving to the next stage.',
                            newStageId: existingProjectId,
                            stage: nextProjectStage
                          });
                        } else {
                          res.json({
                            status: 'Stage-User-Completed',
                            message: 'You have completed your part of this stage. Moving to the next stage while waiting for other team members.',
                            newStageId: existingProjectId,
                            stage: nextProjectStage
                          });
                        }
                      });
                    });
                  } else {
                    // User is already a member of the next stage project - update their status to In Progress
                    const updateUserStatusQuery = `
                      UPDATE project_members
                      SET progress_status = 'In Progress'
                      WHERE project_id = ? AND user_id = ?
                    `;
                    
                    connection.query(updateUserStatusQuery, [existingProjectId, userId], (err) => {
                      if (err) {
                        return connection.rollback(() => {
                          console.error('Error updating user status:', err);
                          res.status(500).json({ error: 'Failed to update user status' });
                        });
                      }
                      
                      connection.commit(err => {
                        if (err) {
                          return connection.rollback(() => {
                            console.error('Error committing transaction:', err);
                            res.status(500).json({ error: 'Failed to commit transaction' });
                          });
                        }
                        
                        if (allCompleted) {
                          res.json({
                            status: 'Stage-Completed',
                            message: 'All team members have completed this stage. Moving to the next stage.',
                            newStageId: existingProjectId,
                            stage: nextProjectStage
                          });
                        } else {
                          res.json({
                            status: 'Stage-User-Completed',
                            message: 'You have completed your part of this stage. Moving to the next stage.',
                            newStageId: existingProjectId,
                            stage: nextProjectStage
                          });
                        }
                      });
                    });
                  }
                });
              } else {
                // Create a new project for the next stage
                const stageStartDate = new Date();
                const stageDueDate = new Date(stageStartDate);
                stageDueDate.setDate(stageStartDate.getDate() + (currentProject.stage_duration || 14));
                
                const createNextStageQuery = `
                  INSERT INTO user_history (
                    user_id, organization, project_name, project_description, 
                    stage, project_id, status, carbon_emit, session_duration,
                    stage_duration, stage_start_date, stage_due_date,
                    project_start_date, project_due_date
                  )
                  VALUES (?, ?, ?, ?, ?, ?, 'In Progress', 0, 0, ?, ?, ?, ?, ?)
                `;
                
                connection.query(createNextStageQuery, [
                  currentProject.owner_id,
                  currentProject.organization,
                  currentProject.project_name,
                  currentProject.project_description,
                  nextProjectStage,
                  currentProject.project_id || projectId,
                  currentProject.stage_duration,
                  stageStartDate.toISOString().split('T')[0],
                  stageDueDate.toISOString().split('T')[0],
                  currentProject.project_start_date,
                  currentProject.project_due_date
                ], (err, insertResult) => {
                  if (err) {
                    return connection.rollback(() => {
                      console.error('Error creating next stage project:', err);
                      res.status(500).json({ error: 'Failed to create next stage project' });
                    });
                  }
                  
                  const newProjectId = insertResult.insertId;
                  
                  // Transfer all team members to the new project
                  const transferMembersQuery = `
                    SELECT user_id, role FROM project_members WHERE project_id = ?
                  `;
                  
                  connection.query(transferMembersQuery, [projectId], (err, membersToTransfer) => {
                    if (err) {
                      return connection.rollback(() => {
                        console.error('Error getting members to transfer:', err);
                        res.status(500).json({ error: 'Failed to get members to transfer' });
                      });
                    }
                    
                    // Create an array of values for batch insert
                    const memberValues = membersToTransfer.map(member => [
                      newProjectId,
                      member.user_id,
                      member.role,
                      nextProjectStage,
                      // Set the user who completed this stage to 'In Progress', others to 'Not Started'
                      // And ensure project_owner always has NULL progress_status
                      member.role === 'project_owner' ? null : 
                        (member.user_id === userId ? 'In Progress' : 'Not Started'),
                      new Date()
                    ]);
                    
                    if (memberValues.length === 0) {
                      // No valid members to add, commit transaction
                      return connection.commit(err => {
                        if (err) {
                          return connection.rollback(() => {
                            res.status(500).json({ error: 'Failed to commit transaction' });
                          });
                        }
                        
                        res.status(200).json({
                          message: 'Stage completed successfully',
                          newProjectId,
                          nextProjectStage
                        });
                      });
                    }
                    
                    // Add all members to the new project
                    const addMembersQuery = `
                      INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status, joined_at)
                      VALUES ?
                    `;
                    
                    connection.query(addMembersQuery, [memberValues], (err) => {
                      if (err) {
                        return connection.rollback(() => {
                          console.error('Error transferring members:', err);
                          res.status(500).json({ error: 'Failed to transfer members' });
                        });
                      }
                      
                      // Now check how many users have completed the current stage
                      const getCompletedUsersQuery = `
                        SELECT COUNT(*) as count 
                        FROM project_members 
                        WHERE project_id = ? AND progress_status = 'Stage Complete'
                      `;
                      
                      connection.query(getCompletedUsersQuery, [projectId], (err, completedResult) => {
                        if (err) {
                          return connection.rollback(() => {
                            console.error('Error counting completed users:', err);
                            res.status(500).json({ error: 'Failed to count completed users' });
                          });
                        }
                        
                        const totalMembersQuery = `
                          SELECT COUNT(*) as count 
                          FROM project_members 
                          WHERE project_id = ?
                        `;
                        
                        connection.query(totalMembersQuery, [projectId], (err, totalResult) => {
                          if (err) {
                            return connection.rollback(() => {
                              console.error('Error counting total users:', err);
                              res.status(500).json({ error: 'Failed to count total users' });
                            });
                          };
                          
                          const completedCount = completedResult[0].count;
                          const totalCount = totalResult[0].count;
                          
                          connection.commit(err => {
                            if (err) {
                              return connection.rollback(() => {
                                console.error('Error committing transaction:', err);
                                res.status(500).json({ error: 'Failed to commit transaction' });
                              });
                            }
                            
                            // If all members have completed, send a different response
                            if (allCompleted) {
                              return res.json({
                                status: 'Stage-Completed',
                                message: 'All team members have completed this stage. Moving to the next stage.',
                                newStageId: newProjectId,
                                stage: nextProjectStage
                              });
                            }
                            
                            // Otherwise, just this user has completed
                            res.json({
                              status: 'Stage-User-Completed',
                              message: 'You have completed your part of this stage. Moving to the next stage while waiting for other team members.',
                              completedMembers: completedCount,
                              totalMembers: totalCount,
                              newStageId: newProjectId,
                              stage: nextProjectStage
                            });
                          });
                        });
                      });
                    });
                  });
                });
              }
            });
          });
        });
      });
    });
  });
});

app.get('/organization_projects', authenticateToken, (req, res) => {
  const { organization } = req.query;

  const query = `
    SELECT uh.id, uh.project_name, uh.project_description, uh.session_duration, uh.carbon_emit, uh.status, uh.stage, u.name AS owner
    FROM user_history uh
    JOIN users u ON uh.user_id = u.id
    WHERE uh.organization = ?
  `;

  connection.query(query, [organization], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ projects: results });
  });
});

app.get('/user_projects_only', authenticateToken, (req, res) => {
  const userId = req.user.id; // Get user ID from the authenticated token

  const query = `
    SELECT id, project_name, project_description, session_duration, carbon_emit, status, stage
    FROM user_history
    WHERE user_id = ?
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ projects: results });
  });
});

app.get('/ram-options', (req, res) => {
  const query = 'SELECT ddr_generation FROM ram';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching RAM options:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Create an array of RAM options
    const ramOptions = results.map(row => ({
      label: `${row.ddr_generation}`,
      value: row.ddr_generation.toString(),
    }));

    res.status(200).json({ ramOptions });
  });
});

app.post('/generate-totp', async (req, res) => {
  const { email } = req.body;

  // Generate TOTP secret
  const secret = speakeasy.generateSecret({ name: `EmissionSense (${email})` });
  totpSecrets[email] = secret.base32; // Store the secret securely (in a database)

  // Generate QR Code for Google Authenticator
  const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);

  res.json({ qrCodeUrl });
});

// Step 2: Validate TOTP and update password
app.post('/validate-totp', async (req, res) => {
  const { email, token, newPassword } = req.body;

  // Retrieve the user's TOTP secret
  const userSecret = totpSecrets[email];
  if (!userSecret) {
    return res.status(400).json({ error: 'Invalid email or token.' });
  }

  // Verify TOTP token
  const isValid = speakeasy.totp.verify({
    secret: userSecret,
    encoding: 'base32',
    token,
  });

  if (!isValid) {
    return res.status(400).json({ error: 'Invalid token.' });
  }

  try {
    // Update the password in the database
    connection.query(
      'UPDATE users SET password = ? WHERE email = ?',
      [newPassword, email],
      (err, result) => {
        if (err) {
          console.error('Error updating password:', err);
          return res.status(500).json({ error: 'Failed to update password.' });
        }

        // Return success response
        if (result.affectedRows > 0) {
          return res.json({ message: 'Password reset successful.' });
        } else {
          return res.status(404).json({ error: 'User not found.' });
        }
      }
    );
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'An error occurred. Please try again.' });
  }
});

// Endpoint to send password reset email
app.post('/send-reset-email', async (req, res) => {
  const { email } = req.body;

  // Check if the email exists in the database
  const query = 'SELECT * FROM users WHERE email = ?';
  connection.query(query, [email], (err, results) => {
      if (err) {
          console.error('Error querying the database:', err);
          return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
          return res.status(404).json({ error: 'Email not found' });
      }

      // Generate a password reset token
      const resetToken = jwt.sign({ email }, JWT_SECRET, { expiresIn: '5m' });

      // Send the password reset email
      const resetLink = `https://emissionserver.vercel.app//reset-password?token=${resetToken}`;
      const mailOptions = {
          from: `"EmissionSense" <${process.env.EMAIL_USER}>`,
          to: email,
          subject: 'Password Reset Request - EmissionSense',
          text: `Click the following link to reset your password: ${resetLink}`,
          html: `
        <div style="max-width: 600px; margin: 0 auto; padding: 20px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
          <div style="background-color: #006241; padding: 24px; text-align: center; border-radius: 8px 8px 0 0;">
            <h1 style="color: white; margin: 0; font-size: 28px; font-weight: 600;">EmissionSense</h1>
          </div>
          
          <div style="background-color: #ffffff; padding: 32px; border-radius: 0 0 8px 8px; box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);">
            <h2 style="color: #1A1A1A; margin-top: 0; font-size: 24px; font-weight: 500;">Password Reset Request</h2>
            <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">Hello,</p>
            <p style="color: #4a4a4a; line-height: 1.6; font-size: 16px;">We received a request to reset your password. To proceed with the password reset, please click the button below:</p>
            
            <div style="text-align: center; margin: 32px 0;">
              <a href="${resetLink}" style="background-color: #006241; color: white; padding: 14px 32px; text-decoration: none; border-radius: 6px; font-weight: 500; font-size: 16px; display: inline-block; transition: background-color 0.2s ease;">Reset Password</a>
            </div>
            
            <div style="background-color: #f8f9fa; padding: 16px; border-radius: 6px; margin-top: 24px;">
              <p style="color: #666; line-height: 1.6; font-size: 14px; margin: 0;">⚠️ If you did not make this request, please ignore this email and your password will remain unchanged.</p>
            </div>
            
            <p style="color: #666; line-height: 1.6; font-size: 14px; margin-top: 24px;">This link will expire in 5 minutes for security purposes.</p>
          </div>
          
          <div style="text-align: center; margin-top:24px; color: #666;">
            <p style="font-size: 14px; margin: 4px 0;">&copy; ${new Date().getFullYear()} EmissionSense. All rights reserved.</p>
            <p style="font-size: 12px; color: #999; margin: 4px 0;">This is an automated message, please do not reply to this email.</p>
          </div>
        </div>
          `,
      };

      transporter.sendMail(mailOptions, (err, info) => {
          if (err) {
              console.error('Error sending email:', err);
              return res.status(500).json({ error: 'Failed to send email' });
          }

          res.status(200).json({ message: 'Password reset email sent successfully' });
      });
  });
});

// Endpoint to reset password
app.post('/resetpassword', async (req, res) => {
  const { token, newPassword } = req.body;

  try {
    // Verify the token
    const decoded = jwt.verify(token, JWT_SECRET);
    const email = decoded.email;

    // Update the password in the database
    connection.query(
      'UPDATE users SET password = ? WHERE email = ?',
      [newPassword, email],
      (err, result) => {
        if (err) {
          console.error('Error updating password:', err);
          return res.status(500).json({ error: 'Failed to update password.' });
        }

        // Return success response
        if (result.affectedRows > 0) {
          return res.json({ message: 'Password reset successful.' });
        } else {
          return res.status(404).json({ error: 'User not found.' });
        }
      }
    );
  } catch (err) {
    console.error('Error:', err);
    return res.status(500).json({ error: 'Invalid or expired token.' });
  }
});


// Send project invitation
app.post('/send-invitation', authenticateToken, (req, res) => {
  const senderId = req.user.id;
  const { recipientEmail, projectId, message } = req.body;

  // First get recipient's user ID from their email
  const getUserQuery = 'SELECT id FROM users WHERE email = ?';
  
  connection.query(getUserQuery, [recipientEmail], (err, userResults) => {
    if (err) {
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (userResults.length === 0) {
      return res.status(404).json({ error: 'Recipient not found' });
    }

    const recipientId = userResults[0].id;
    
    // Create notification
    const createNotificationQuery = `
      INSERT INTO notifications (sender_id, recipient_id, project_id, type, message)
      VALUES (?, ?, ?, 'project_invitation', ?)
    `;

    connection.query(createNotificationQuery, 
      [senderId, recipientId, projectId, message],
      (err, results) => {
        if (err) {
          console.error('Error creating notification:', err);
          return res.status(500).json({ error: 'Failed to send invitation' });
        }
        res.json({ message: 'Invitation sent successfully' });
    });
  });
});

// Get user's notifications
app.get('/notifications', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `
    SELECT 
      n.*,
      u.name as sender_name,
      u.email as sender_email,
      p.project_name,
      p.project_description,
      p.organization,
      p.stage
    FROM notifications n
    JOIN users u ON n.sender_id = u.id
    JOIN user_history p ON n.project_id = p.id
    WHERE n.recipient_id = ?
    ORDER BY n.created_at DESC
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching notifications:', err);
      return res.status(500).json({ error: 'Failed to fetch notifications' });
    }

    // Format the date for each notification
    const formattedResults = results.map(notification => ({
      ...notification,
      created_at: new Date(notification.created_at).toLocaleString()
    }));

    res.json({ notifications: formattedResults });
  });
});

// Mark notification as read
app.put('/notifications/:id/read', authenticateToken, (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.id;

  const query = `
    UPDATE notifications 
    SET status = 'read'
    WHERE id = ? AND recipient_id = ?
  `;

  connection.query(query, [notificationId, userId], (err, results) => {
    if (err) {
      console.error('Error updating notification:', err);
      return res.status(500).json({ error: 'Failed to update notification' });
    }
    res.json({ message: 'Notification marked as read' });
  });
});

// Respond to project invitation
app.put('/invitations/:id/respond', authenticateToken, (req, res) => {
  const notificationId = req.params.id;
  const userId = req.user.id;
  const { response } = req.body; // 'accepted' or 'rejected'

  connection.beginTransaction(async (err) => {
    if (err) {
      return res.status(500).json({ error: 'Transaction error' });
    }

    try {
      // Update notification status
      const updateQuery = `
        UPDATE notifications 
        SET response = ?, status = 'read'
        WHERE id = ? AND recipient_id = ?
      `;

      await new Promise((resolve, reject) => {
        connection.query(updateQuery, [response, notificationId, userId], (err, results) => {
          if (err) {
            return reject(err);
          }
          resolve(results);
        });
      });

      // If accepted, add user to project_members
      if (response === 'accepted') {
        const getProjectIdQuery = `
          SELECT project_id FROM notifications WHERE id = ? AND recipient_id = ?
        `;

        const projectId = await new Promise((resolve, reject) => {
          connection.query(getProjectIdQuery, [notificationId, userId], (err, results) => {
            if (err) {
              return reject(err);
            }
            resolve(results[0].project_id);
          });
        });

        const insertMemberQuery = `
          INSERT INTO project_members (project_id, user_id, role)
          VALUES (?, ?, 'member')
        `;

        await new Promise((resolve, reject) => {
          connection.query(insertMemberQuery, [projectId, userId], (err, results) => {
            if (err) {
              return reject(err);
            }
            resolve(results);
          });
        });
      }

      connection.commit((err) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).json({ error: 'Transaction commit error' });
          });
        }
        res.json({ message: 'Invitation response recorded successfully' });
      });
    } catch (error) {
      connection.rollback(() => {
        res.status(500).json({ error: 'Transaction error' });
      });
    }
  });
});

// Get project members
app.get('/project/:id/members', authenticateToken, (req, res) => {
  const projectId = req.params.id;

  const query = `
    SELECT u.name, u.email, u.profile_image, pm.role, pm.joined_at
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `;

  connection.query(query, [projectId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const members = results.map(member => ({
      ...member,
      profile_image: member.profile_image 
        ? `https://emissionserver.vercel.app//uploads/${member.profile_image}`
        : null
    }));

    res.status(200).json({ members });
  });
});

app.get('/user_project_display_combined', authenticateToken, (req, res) => {
  const userId = req.user.id;

  // First, get all projects this user is a member of, either as owner or team member
  // This will get us all the project IDs the user has access to
  const getAllProjectIdsQuery = `
    SELECT DISTINCT 
      project_id 
    FROM 
      project_members 
    WHERE 
      user_id = ?
    UNION    SELECT 
      id as project_id
    FROM 
      user_history
    WHERE 
      user_id = ? AND status NOT IN ('Archived')
  `;

  connection.query(getAllProjectIdsQuery, [userId, userId], (err, projectIds) => {
    if (err) {
      console.error('Error getting project IDs:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (!projectIds || projectIds.length === 0) {
      return res.status(200).json({ projects: [] });
    }

    // Extract just the IDs into an array
    const ids = projectIds.map(p => p.project_id);
    const idPlaceholders = ids.map(() => '?').join(',');

    // For each project, get the stage specific to this user's progress
    // This query prioritizes the user's individual stage from project_members
    const projectsQuery = `
      SELECT 
        uh.id, 
        uh.organization, 
        uh.project_name, 
        uh.project_description,
        uh.session_duration, 
        uh.carbon_emit, 
        uh.status,
        uh.stage_duration, 
        uh.stage_start_date, 
        uh.stage_due_date,
        uh.project_start_date, 
        uh.project_due_date,
        u.email as owner_email, 
        u.name as owner_name,
        pm.role, 
        pm.progress_status,
        CASE 
          WHEN pm.current_stage IS NOT NULL THEN pm.current_stage
          ELSE uh.stage
        END as stage
      FROM 
        user_history uh
      JOIN 
        users u ON uh.user_id = u.id
      LEFT JOIN 
        project_members pm ON uh.id = pm.project_id AND pm.user_id = ?      WHERE 
        uh.id IN (${idPlaceholders})
        AND uh.status NOT IN ('Archived')
    `;

    const queryParams = [userId, ...ids];

    connection.query(projectsQuery, queryParams, (err, projects) => {
      if (err) {
        console.error('Error getting projects:', err);
        return res.status(500).json({ error: 'Database error' });
      }
      
      // Include all projects, even if progress_status is "Not Started"
      // We'll handle visibility in the client
      const processedProjects = projects.map(project => {
        return {
          ...project,
          // Add a flag to indicate if this project is visible to the user
          visible: project.progress_status !== 'Not Started'
        };
      });
      
      res.status(200).json({ projects: processedProjects });
    });
  });
});

// Endpoint to fetch carbon emissions data for the last two days
app.get('/carbon-emissions', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `
    SELECT SUM(carbon_emit) as total_emissions, DATE(created_at) as date
    FROM user_history
    WHERE user_id = ? AND created_at >= CURDATE() - INTERVAL 2 DAY
    GROUP BY DATE(created_at)
  `;

  console.log('Executing query:', query);
  console.log('With parameters:', [userId]);

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    console.log('Query results:', results);

    // Calculate highest and lowest emissions
    if (results.length > 0) {
      const emissions = results.map(r => r.total_emissions);
      const highestEmission = Math.max(...emissions);
      const lowestEmission = Math.min(...emissions);
      res.status(200).json({ emissions: results, highestEmission, lowestEmission });
    } else {
      res.status(200).json({ emissions: results, highestEmission: null, lowestEmission: null });
    }
  });
});

// Endpoint to add a new device
app.post('/addDevice', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { device, cpu, gpu, ram, capacity, motherboard, psu } = req.body;

  if (!device || !cpu || !gpu || !ram || !capacity || !motherboard || !psu) {
    return res.status(400).json({ error: 'All fields are required' });
  }

  const query = `
    INSERT INTO user_devices (user_id, device, cpu, gpu, ram, capacity, motherboard, psu)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `;

  connection.query(query, [userId, device, cpu, gpu, ram, capacity, motherboard, psu], (err, results) => {
    if (err) {
      console.error('Error inserting data into the user_devices table:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ message: 'Device added successfully' });
  });
});

// Endpoint to set the current device for the user
app.put('/setCurrentDevice', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const { deviceId } = req.body;

  const query = `
    UPDATE users
    SET current_device_id = ?
    WHERE id = ?
  `;

  connection.query(query, [deviceId, userId], (err, results) => {
    if (err) {
      console.error('Error updating current device:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ message: 'Current device updated successfully' });
  });
});

// Endpoint to fetch user's devices
app.get('/user_devices', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `
    SELECT id, device, cpu, gpu, ram, capacity, motherboard, psu
    FROM user_devices
    WHERE user_id = ?
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const currentDeviceQuery = `
      SELECT current_device_id
      FROM users
      WHERE id = ?
    `;

    connection.query(currentDeviceQuery, [userId], (err, deviceResults) => {
      if (err) {
        console.error('Error querying the database:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      const currentDeviceId = deviceResults.length > 0 ? deviceResults[0].current_device_id : null;
      res.status(200).json({ devices: results, currentDeviceId });
    });
  });
});

// ALL admin endpoints

// View all the users projects
app.get('/all_user_projects_admin', authenticateAdmin, (req, res) => {
  const query = `
    SELECT 
      uh.id, 
      uh.organization, 
      uh.project_name, 
      uh.project_description, 
      uh.session_duration, 
      uh.carbon_emit, 
      uh.stage, 
      uh.status, 
      uh.created_at,
      uh.stage_duration,
      uh.stage_start_date,
      uh.stage_due_date,
      uh.project_start_date,
      uh.project_due_date,
      u.email AS owner
    FROM user_history uh
    JOIN users u ON uh.user_id = u.id
    ORDER BY uh.created_at DESC
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching projects:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // Format dates to ISO string format for consistent handling
    const formattedResults = results.map(project => ({
      ...project,
      stage_start_date: project.stage_start_date ? project.stage_start_date.toISOString().split('T')[0] : null,
      stage_due_date: project.stage_due_date ? project.stage_due_date.toISOString().split('T')[0] : null,
      project_start_date: project.project_start_date ? project.project_start_date.toISOString().split('T')[0] : null,
      project_due_date: project.project_due_date ? project.project_due_date.toISOString().split('T')[0] : null,
      created_at: project.created_at ? project.created_at.toISOString() : null
    }));

    res.status(200).json({ projects: formattedResults });
  });
});

// Endpoint to get user's organization by email
app.get('/user_organization/:email', authenticateAdmin, (req, res) => {
  const { email } = req.params;
  
  const query = 'SELECT organization FROM users WHERE email = ?';
  
  connection.query(query, [email], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }
    
    if (results.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }
    
    res.status(200).json({ organization: results[0].organization });
  });
});

// Endpoint to create a new project with members
app.post('/admin/create_project', authenticateAdmin, (req, res) => {
  const { 
    project_name, 
    project_description, 
    status, 
    stage, 
    owner_email,       // Changed from owner to owner_email for clarity
    leader_email,      // Added new field for project leader
    members, 
    organization,
    stage_duration = 14,
    stage_start_date = new Date().toISOString().split('T')[0],
    stage_due_date,
    project_start_date = stage_start_date,
    project_due_date 
  } = req.body;

  // Calculate default due dates
  const defaultStageDueDate = new Date(stage_start_date);
  defaultStageDueDate.setDate(defaultStageDueDate.getDate() + stage_duration);
  const finalStageDueDate = stage_due_date || defaultStageDueDate.toISOString().split('T')[0];

  const defaultProjectDueDate = new Date(project_start_date);
  defaultProjectDueDate.setDate(defaultProjectDueDate.getDate() + 42);
  const finalProjectDueDate = project_due_date || defaultProjectDueDate.toISOString().split('T')[0];

  connection.beginTransaction(err => {
    if (err) {
      console.error('Error starting transaction:', err);
      return res.status(500).json({ error: 'Transaction start failed' });
    }

    // Find the owner's user ID
    const findOwnerQuery = 'SELECT id FROM users WHERE email = ?';
    
    connection.query(findOwnerQuery, [owner_email], (err, ownerResults) => {
      if (err || ownerResults.length === 0) {
        return connection.rollback(() => {
          res.status(404).json({ error: 'Owner user not found' });
        });
      }

      const ownerId = ownerResults[0].id;

      // Find the leader's user ID
      const findLeaderQuery = 'SELECT id FROM users WHERE email = ?';

      connection.query(findLeaderQuery, [leader_email], (err, leaderResults) => {
        if (err || (leader_email && leaderResults.length === 0)) {
          return connection.rollback(() => {
            res.status(404).json({ error: 'Leader user not found' });
          });
        }

        const leaderId = leader_email ? leaderResults[0].id : null;

        // Create the project
        const createProjectQuery = `
          INSERT INTO user_history (
            user_id, organization, project_name, project_description, 
            status, stage, stage_duration, stage_start_date, stage_due_date,
            project_start_date, project_due_date, session_duration, carbon_emit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, 0)
        `;

        connection.query(createProjectQuery, 
          [ownerId, organization, project_name, project_description, 
           status, stage, stage_duration, stage_start_date, finalStageDueDate,
           project_start_date, finalProjectDueDate],
          (err, projectResult) => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).json({ error: 'Failed to create project' });
              });
            }

            const projectId = projectResult.insertId;
            
            // Update the project_id field to be the same as the project's ID
            const updateProjectIdQuery = `
              UPDATE user_history 
              SET project_id = ? 
              WHERE id = ?
            `;
            
            connection.query(updateProjectIdQuery, [projectId, projectId], (err) => {
              if (err) {
                return connection.rollback(() => {
                  res.status(500).json({ error: 'Failed to update project ID' });
                });
              }
              
              // Add project owner role
              const addOwnerQuery = `
                INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status, joined_at)
                VALUES (?, ?, 'project_owner', ?, NULL, NOW())
              `;

              connection.query(addOwnerQuery, [projectId, ownerId, stage], (err) => {
                if (err) {
                  return connection.rollback(() => {
                    res.status(500).json({ error: 'Failed to add project owner' });
                  });
                }

                // Add project leader role
                const addLeaderQuery = `
                  INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status, joined_at)
                  VALUES (?, ?, 'project_leader', ?, 'In Progress', NOW())
                `;

                // Only add leader if one was specified
                if (leaderId) {
                  connection.query(addLeaderQuery, [projectId, leaderId, stage], (err) => {
                    if (err) {
                      return connection.rollback(() => {
                        res.status(500).json({ error: 'Failed to add project leader' });
                      });
                    }
                    
                    // Process additional members if present
                    if (members && members.length > 0) {
                      // Find user IDs for all members
                      const placeholders = members.map(() => '?').join(',');
                      const findMembersQuery = `SELECT email, id FROM users WHERE email IN (${placeholders})`;
                      
                      connection.query(findMembersQuery, members, (err, memberResults) => {
                        if (err) {
                          return connection.rollback(() => {
                            res.status(500).json({ error: 'Failed to find project members' });
                          });
                        }
                        
                        // Create array of values for batch insert
                        const memberValues = memberResults.map(member => [
                          projectId,
                          member.id,
                          'member',
                          stage,  // Set the current_stage to the project's initial stage
                          'In Progress'
                        ]);
                        
                        if (memberValues.length === 0) {
                          // No valid members to add, commit transaction
                          return connection.commit(err => {
                            if (err) {
                              return connection.rollback(() => {
                                res.status(500).json({ error: 'Failed to commit transaction' });
                              });
                            }
                            
                            res.status(200).json({
                              id: projectId,
                              project_id: projectId, // Include project_id in the response
                              project_name,
                              project_description,
                              status,
                              stage,
                              carbon_emit: 0,
                              session_duration: 0,
                              owner: owner_email,
                              leader: leader_email,
                              organization,
                              members,
                              stage_duration,
                              stage_start_date,
                              stage_due_date: finalStageDueDate,
                              project_start_date,
                              project_due_date: finalProjectDueDate,
                              created_at: new Date().toISOString()
                            });
                          });
                        }
                        
                        // Add all members at once
                        const addMembersQuery = `
                          INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
                          VALUES ?
                        `;

                        connection.query(addMembersQuery, [memberValues], (err) => {
                          if (err) {
                            return connection.rollback(() => {
                              res.status(500).json({ error: 'Failed to add project members' });
                            });
                          }

                          connection.commit(err => {
                            if (err) {
                              return connection.rollback(() => {
                                res.status(500).json({ error: 'Failed to commit transaction' });
                              });
                            }

                            res.status(200).json({
                              id: projectId,
                              project_id: projectId, // Include project_id in the response
                              project_name,
                              project_description,
                              status,
                              stage,
                              carbon_emit: 0,
                              session_duration: 0,
                              owner: owner_email,
                              leader: leader_email,
                              organization,
                              members,
                              stage_duration,
                              stage_start_date,
                              stage_due_date: finalStageDueDate,
                              project_start_date,
                              project_due_date: finalProjectDueDate,
                              created_at: new Date().toISOString()
                            });
                          });
                        });
                      });
                    } else {
                      // No additional members, commit transaction
                      connection.commit(err => {
                        if (err) {
                          return connection.rollback(() => {
                            res.status(500).json({ error: 'Failed to commit transaction' });
                          });
                        }

                        res.status(200).json({
                          id: projectId,
                          project_id: projectId, // Include project_id in the response
                          project_name,
                          project_description,
                          status,
                          stage,
                          carbon_emit: 0,
                          session_duration: 0,
                          owner: owner_email,
                          leader: leader_email,
                          organization,
                          members: [],
                          stage_duration,
                          stage_start_date,
                          stage_due_date: finalStageDueDate,
                          project_start_date,
                          project_due_date: finalProjectDueDate,
                          created_at: new Date().toISOString()
                        });
                      });
                    }
                  });
                } else {
                  // No leader specified, commit transaction
                  connection.commit(err => {
                    if (err) {
                      return connection.rollback(() => {
                        res.status(500).json({ error: 'Failed to commit transaction' });
                      });
                    }

                    res.status(200).json({
                      id: projectId,
                      project_id: projectId, // Include project_id in the response
                      project_name,
                      project_description,
                      status,
                      stage,
                      carbon_emit: 0,
                      session_duration: 0,
                      owner: owner_email,
                      leader: null,
                      organization,
                      members: [],
                      stage_duration,
                      stage_start_date,
                      stage_due_date: finalStageDueDate,
                      project_start_date,
                      project_due_date: finalProjectDueDate,
                      created_at: new Date().toISOString()
                    });
                  });
                }
              });
            });
          }
        );
      });
    });
  });
});

// Endpoint to get all users Admin only
app.get('/all_users', authenticateAdmin, (req, res) => {
  const query = 'SELECT id, name, email, organization FROM users';

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ users: results });
  });
});

// Endpoint to create an admin token
app.post('/admin_login', (req, res) => {
  const { email, password } = req.body;

  const query = `
    SELECT id, name, email FROM admin WHERE email = ? AND password = ?
  `;

  connection.query(query, [email, password], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length > 0) {
      const admin = results[0]; // Get the first admin record
      const token = jwt.sign({ email: admin.email, id: admin.id, role: 'admin' }, JWT_SECRET, { expiresIn: '7d' });
      res.status(200).json({ message: 'Admin login successful', token, adminId: admin.id, name: admin.name, email: admin.email });
    } else {
      res.status(401).json({ error: 'Invalid credentials' });
    }
  });
});

// Endpoint to delete a project by ID (admin only)
// Endpoint to delete a project by ID (admin only)
app.delete('/admin/delete_project/:id', authenticateAdmin, (req, res) => {
  const projectId = req.params.id;

  // Begin transaction to ensure atomic operations
  connection.beginTransaction(err => {
    if (err) return res.status(500).json({ error: 'Transaction error' });

    // 1. Delete related notifications
    connection.query(
      `DELETE FROM notifications WHERE project_id = ?`,
      [projectId],
      (err, notifResults) => {
        if (err) {
          return connection.rollback(() => {
            res.status(500).json({ error: 'Error deleting notifications' });
          });
        }

        // 2. Delete related project members
        connection.query(
          `DELETE FROM project_members WHERE project_id = ?`,
          [projectId],
          (err, memberResults) => {
            if (err) {
              return connection.rollback(() => {
                res.status(500).json({ error: 'Error deleting project members' });
              });
            }

            // 3. Finally delete the project
            connection.query(
              `DELETE FROM user_history WHERE id = ?`,
              [projectId],
              (err, projectResults) => {
                if (err) {
                  return connection.rollback(() => {
                    res.status(500).json({ error: 'Error deleting project' });
                  });
                }

                // Commit the transaction
                connection.commit(err => {
                  if (err) {
                    return connection.rollback(() => {
                      res.status(500).json({ error: 'Transaction commit error' });
                    });
                  }

                  if (projectResults.affectedRows > 0) {
                    res.status(200).json({ message: 'Project deleted successfully' });
                  } else {
                    res.status(404).json({ error: 'Project not found' });
                  }
                });
              }
            );
          }
        );
      }
    );
  });
});

// Endpoint to fetch emission data for admin view
app.get('/emission_data', authenticateAdmin, (req, res) => {
  const viewBy = req.query.viewBy || 'organization';

  let query;
  if (viewBy === 'individual') {
    query = `
      SELECT u.name, u.email AS user, u.organization, SUM(uh.carbon_emit) AS total_carbon_emit
      FROM user_history uh
      JOIN users u ON uh.user_id = u.id
      GROUP BY u.name, u.email, u.organization
    `;
  } else {
    query = `
      SELECT u.organization, u.name, u.email AS user, SUM(uh.carbon_emit) AS total_carbon_emit
      FROM user_history uh
      JOIN users u ON uh.user_id = u.id
      GROUP BY u.organization, u.name, u.email
    `;
  }

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ emissionData: results });
  });
});

// Endpoint to delete a user by ID (admin only)
app.delete('/delete_user/:id', authenticateAdmin, (req, res) => {
  const userId = req.params.id;

  connection.beginTransaction(err => {
    if (err) {
      return res.status(500).json({ error: 'Transaction initiation failed' });
    }
    connection.query("DELETE FROM user_devices WHERE user_id = ?", [userId], (err, result) => {
      if (err) {
        return connection.rollback(() => res.status(500).json({ error: 'Failed to delete user devices' }));
      }
      connection.query("DELETE FROM user_history WHERE user_id = ?", [userId], (err, result) => {
        if (err) {
          return connection.rollback(() => res.status(500).json({ error: 'Failed to delete user history' }));
        }
        connection.query("DELETE FROM users WHERE id = ?", [userId], (err, result) => {
          if (err) {
            return connection.rollback(() => res.status(500).json({ error: 'Failed to delete user' }));
          }
          connection.commit(err => {
            if (err) {
              return connection.rollback(() => res.status(500).json({ error: 'Transaction commit failed' }));
            }
            res.status(200).json({ message: 'User and related projects deleted successfully' });
          });
        });
      });
    });
  });
});

// Endpoint to fetch project members for each project (admin only)
app.get('/project_members/:projectId', authenticateAdmin, (req, res) => {
  const projectId = req.params.projectId;

  const query = `
    SELECT u.name, u.email, pm.role, pm.joined_at
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `;

  connection.query(query, [projectId], (err, results) => {
    if (err) {
      console.error('Error querying the database:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ members: results });
  });
});

// Device Maintenance Admin Endpoints

// Desktop CPUs endpoints
app.get('/admin/cpus', authenticateAdmin, (req, res) => {
  const query = 'SELECT * FROM cpus ORDER BY manufacturer, series, model';
  
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching CPUs:', err);
      return res.status(500).json({ error: 'Failed to fetch CPUs' });
    }
    res.json(results);
  });
});

app.post('/admin/cpus', authenticateAdmin, (req, res) => {
  const { manufacturer, series, model, generation, avg_watt_usage } = req.body;
  
  const query = `
    INSERT INTO cpus (manufacturer, series, model, generation, avg_watt_usage)
    VALUES (?, ?, ?, ?, ?)
  `;
  
  connection.query(query, [manufacturer, series, model, generation, avg_watt_usage], (err, results) => {
    if (err) {
      console.error('Error adding CPU:', err);
      return res.status(500).json({ error: 'Failed to add CPU' });
    }
    res.json({ message: 'CPU added successfully', id: results.insertId });
  });
});

app.put('/admin/cpus/:id', authenticateAdmin, (req, res) => {
  const cpuId = req.params.id;
  const { manufacturer, series, model, generation, avg_watt_usage } = req.body;
  
  const query = `
    UPDATE cpus 
    SET manufacturer = ?, series = ?, model = ?, generation = ?, avg_watt_usage = ?
    WHERE id = ?
  `;
  
  connection.query(query, [manufacturer, series, model, generation, avg_watt_usage, cpuId], (err, results) => {
    if (err) {
      console.error('Error updating CPU:', err);
      return res.status(500).json({ error: 'Failed to update CPU' });
    }
    res.json({ message: 'CPU updated successfully' });
  });
});

app.delete('/admin/cpus/:id', authenticateAdmin, (req, res) => {
  const cpuId = req.params.id;
  
  const query = 'DELETE FROM cpus WHERE id = ?';
  
  connection.query(query, [cpuId], (err, results) => {
    if (err) {
      console.error('Error deleting CPU:', err);
      return res.status(500).json({ error: 'Failed to delete CPU' });
    }
    res.json({ message: 'CPU deleted successfully' });
  });
});

// Mobile CPUs endpoints
app.get('/admin/cpus-mobile', authenticateAdmin, (req, res) => {
  const query = 'SELECT * FROM cpusm ORDER BY generation, model';
  
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching mobile CPUs:', err);
      return res.status(500).json({ error: 'Failed to fetch mobile CPUs' });
    }
    res.json(results);
  });
});

app.post('/admin/cpus-mobile', authenticateAdmin, (req, res) => {
  const { generation, model, cpu_watts } = req.body;
  
  const query = `
    INSERT INTO cpusm (generation, model, cpu_watts)
    VALUES (?, ?, ?)
  `;
  
  connection.query(query, [generation, model, cpu_watts], (err, results) => {
    if (err) {
      console.error('Error adding mobile CPU:', err);
      return res.status(500).json({ error: 'Failed to add mobile CPU' });
    }
    res.json({ message: 'Mobile CPU added successfully', id: results.insertId });
  });
});

app.put('/admin/cpus-mobile/:id', authenticateAdmin, (req, res) => {
  const cpuId = req.params.id;
  const { generation, model, cpu_watts } = req.body;
  
  const query = `
    UPDATE cpusm 
    SET generation = ?, model = ?, cpu_watts = ?
    WHERE id = ?
  `;
  
  connection.query(query, [generation, model, cpu_watts, cpuId], (err, results) => {
    if (err) {
      console.error('Error updating mobile CPU:', err);
      return res.status(500).json({ error: 'Failed to update mobile CPU' });
    }
    res.json({ message: 'Mobile CPU updated successfully' });
  });
});

app.delete('/admin/cpus-mobile/:id', authenticateAdmin, (req, res) => {
  const cpuId = req.params.id;
  
  const query = 'DELETE FROM cpusm WHERE id = ?';
  
  connection.query(query, [cpuId], (err, results) => {
    if (err) {
      console.error('Error deleting mobile CPU:', err);
      return res.status(500).json({ error: 'Failed to delete mobile CPU' });
    }
    res.json({ message: 'Mobile CPU deleted successfully' });
  });
});

// Desktop GPUs endpoints
app.get('/admin/gpus', authenticateAdmin, (req, res) => {
  const query = 'SELECT * FROM gpus ORDER BY manufacturer, series, model';
  
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching GPUs:', err);
      return res.status(500).json({ error: 'Failed to fetch GPUs' });
    }
    res.json(results);
  });
});

app.post('/admin/gpus', authenticateAdmin, (req, res) => {
  const { manufacturer, series, model, generation, avg_watt_usage } = req.body;
  
  const query = `
    INSERT INTO gpus (manufacturer, series, model, generation, avg_watt_usage)
    VALUES (?, ?, ?, ?, ?)
  `;
  
  connection.query(query, [manufacturer, series, model, generation, avg_watt_usage], (err, results) => {
    if (err) {
      console.error('Error adding GPU:', err);
      return res.status(500).json({ error: 'Failed to add GPU' });
    }
    res.json({ message: 'GPU added successfully', id: results.insertId });
  });
});

app.put('/admin/gpus/:id', authenticateAdmin, (req, res) => {
  const gpuId = req.params.id;
  const { manufacturer, series, model, generation, avg_watt_usage } = req.body;
  
  const query = `
    UPDATE gpus 
    SET manufacturer = ?, series = ?, model = ?, generation = ?, avg_watt_usage = ?
    WHERE id = ?
  `;
  
  connection.query(query, [manufacturer, series, model, generation, avg_watt_usage, gpuId], (err, results) => {
    if (err) {
      console.error('Error updating GPU:', err);
      return res.status(500).json({ error: 'Failed to update GPU' });
    }
    res.json({ message: 'GPU updated successfully' });
  });
});

app.delete('/admin/gpus/:id', authenticateAdmin, (req, res) => {
  const gpuId = req.params.id;
  
  const query = 'DELETE FROM gpus WHERE id = ?';
  
  connection.query(query, [gpuId], (err, results) => {
    if (err) {
      console.error('Error deleting GPU:', err);
      return res.status(500).json({ error: 'Failed to delete GPU' });
    }
    res.json({ message: 'GPU deleted successfully' });
  });
});

// Mobile GPUs endpoints
app.get('/admin/gpus-mobile', authenticateAdmin, (req, res) => {
  const query = 'SELECT * FROM gpusm ORDER BY manufacturer, model';
  
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching mobile GPUs:', err);
      return res.status(500).json({ error: 'Failed to fetch mobile GPUs' });
    }
    res.json(results);
  });
});

app.post('/admin/gpus-mobile', authenticateAdmin, (req, res) => {
  const { manufacturer, model, gpu_watts } = req.body;
  
  const query = `
    INSERT INTO gpusm (manufacturer, model, gpu_watts)
    VALUES (?, ?, ?)
  `;
  
  connection.query(query, [manufacturer, model, gpu_watts], (err, results) => {
    if (err) {
      console.error('Error adding mobile GPU:', err);
      return res.status(500).json({ error: 'Failed to add mobile GPU' });
    }
    res.json({ message: 'Mobile GPU added successfully', id: results.insertId });
  });
});

app.put('/admin/gpus-mobile/:id', authenticateAdmin, (req, res) => {
  const gpuId = req.params.id;
  const { manufacturer, model, gpu_watts } = req.body;
  
  const query = `
    UPDATE gpusm 
    SET manufacturer = ?, model = ?, gpu_watts = ?
    WHERE id = ?
  `;
  
  connection.query(query, [manufacturer, model, gpu_watts, gpuId], (err, results) => {
    if (err) {
      console.error('Error updating mobile GPU:', err);
      return res.status(500).json({ error: 'Failed to update mobile GPU' });
    }
    res.json({ message: 'Mobile GPU updated successfully' });
  });
});

app.delete('/admin/gpus-mobile/:id', authenticateAdmin, (req, res) => {
  const gpuId = req.params.id;
  
  const query = 'DELETE FROM gpusm WHERE id = ?';
  
  connection.query(query, [gpuId], (err, results) => {
    if (err) {
      console.error('Error deleting mobile GPU:', err);
      return res.status(500).json({ error: 'Failed to delete mobile GPU' });
    }
    res.json({ message: 'Mobile GPU deleted successfully' });
  });
});

// RAM endpoints
app.get('/admin/rams', authenticateAdmin, (req, res) => {
  const query = 'SELECT * FROM ram ORDER BY ddr_generation';
  
  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching RAMs:', err);
      return res.status(500).json({ error: 'Failed to fetch RAMs' });
    }
    res.json(results);
  });
});

app.post('/admin/rams', authenticateAdmin, (req, res) => {
  const { ddr_generation, voltage, avg_watt_usage } = req.body;
  
  const query = `
    INSERT INTO ram (ddr_generation, voltage, avg_watt_usage)
    VALUES (?, ?, ?)
  `;
  
  connection.query(query, [ddr_generation, voltage, avg_watt_usage], (err, results) => {
    if (err) {
      console.error('Error adding RAM:', err);
      return res.status(500).json({ error: 'Failed to add RAM' });
    }
    res.json({ message: 'RAM added successfully', id: results.insertId });
  });
});

app.put('/admin/rams/:id', authenticateAdmin, (req, res) => {
  const ramId = req.params.id;
  const { ddr_generation, voltage, avg_watt_usage } = req.body;
  
  const query = `
    UPDATE ram 
    SET ddr_generation = ?, voltage = ?, avg_watt_usage = ?
    WHERE id = ?
  `;
  
  connection.query(query, [ddr_generation, voltage, avg_watt_usage, ramId], (err, results) => {
    if (err) {
      console.error('Error updating RAM:', err);
      return res.status(500).json({ error: 'Failed to update RAM' });
    }
    res.json({ message: 'RAM updated successfully' });
  });
});

app.delete('/admin/rams/:id', authenticateAdmin, (req, res) => {
  const ramId = req.params.id;
  
  const query = 'DELETE FROM ram WHERE id = ?';
  
  connection.query(query, [ramId], (err, results) => {
    if (err) {
      console.error('Error deleting RAM:', err);
      return res.status(500).json({ error: 'Failed to delete RAM' });
    }
    res.json({ message: 'RAM deleted successfully' });
  });
});

// Endpoints to fetch device maintenance data
app.get('/admin/device-maintenance', authenticateAdmin, (req, res) => {
  const query = `
    SELECT 
      ud.id, ud.device, ud.cpu, ud.gpu, ud.ram, ud.capacity, ud.motherboard, ud.psu,
      u.name as user_name, u.email as user_email, u.organization
    FROM user_devices ud
    JOIN users u ON ud.user_id = u.id
    ORDER BY u.organization, u.name
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching device maintenance data:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ devices: results });
  });
});

// Endpoint to get device details by ID
app.get('/admin/device-maintenance/:id', authenticateAdmin, (req, res) => {
  const deviceId = req.params.id;

  const query = `
    SELECT 
      ud.id, ud.device, ud.cpu, ud.gpu, ud.ram, ud.capacity, ud.motherboard, ud.psu,
      u.name as user_name, u.email as user_email, u.organization
    FROM user_devices ud
    JOIN users u ON ud.user_id = u.id
    WHERE ud.id = ?
  `;

  connection.query(query, [deviceId], (err, results) => {
    if (err) {
      console.error('Error fetching device details:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.length === 0) {
      return res.status(404).json({ error: 'Device not found' });
    }

    res.status(200).json({ device: results[0] });
  });
});

// Endpoint to update device details
app.put('/admin/device-maintenance/:id', authenticateAdmin, (req, res) => {
  const deviceId = req.params.id;
  const { device, cpu, gpu, ram, capacity, motherboard, psu } = req.body;

  const query = `
    UPDATE user_devices
    SET device = ?, cpu = ?, gpu = ?, ram = ?, capacity = ?, motherboard = ?, psu = ?
    WHERE id = ?
  `;

  connection.query(query, [device, cpu, gpu, ram, capacity, motherboard, psu, deviceId], (err, results) => {
    if (err) {
      console.error('Error updating device details:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ message: 'Device details updated successfully' });
  });
});

// Endpoint to delete a device
app.delete('/admin/device-maintenance/:id', authenticateAdmin, (req, res) => {
  const deviceId = req.params.id;

  const query = `
    DELETE FROM user_devices
    WHERE id = ?
  `;

  connection.query(query, [deviceId], (err, results) => {
    if (err) {
      console.error('Error deleting device:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ message: 'Device deleted successfully' });
  });
});

// Serve static files from uploads directory with proper headers
app.use('/uploads', (req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
  next();
}, express.static(path.join(__dirname, 'uploads')));

// Endpoint to initialize timeline dates for existing records
app.post('/initialize_timeline_dates', authenticateAdmin, (req, res) => {
  const updateQuery = `
    UPDATE user_history 
    SET stage_start_date = created_at,
        project_start_date = created_at 
    WHERE stage_start_date IS NULL OR project_start_date IS NULL
  `;

  connection.query(updateQuery, (err, results) => {
    if (err) {
      console.error('Error updating timeline dates:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ 
      message: 'Timeline dates initialized successfully',
      recordsUpdated: results.affectedRows 
    });
  });
});

// Endpoint to add a project member
app.post('/add_project_member', authenticateAdmin, async (req, res) => {
  const { projectId, userEmail, role } = req.body;

  // Validate required fields
  if (!projectId || !userEmail || !role) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  try {
    // First find the user ID from email
    const findUserQuery = 'SELECT id FROM users WHERE email = ?';
    
    connection.query(findUserQuery, [userEmail], (err, userResults) => {
      if (err) {
        console.error('Error finding user:', err);
        return res.status(500).json({ error: 'Database error while finding user' });
      }

      if (userResults.length === 0) {
        return res.status(404).json({ error: 'User not found with the provided email' });
      }

      const userId = userResults[0].id;

      // Check if user is already a member of the project
      const checkMemberQuery = 'SELECT * FROM project_members WHERE project_id = ? AND user_id = ?';
      
      connection.query(checkMemberQuery, [projectId, userId], (err, memberResults) => {
        if (err) {
          console.error('Error checking existing member:', err);
          return res.status(500).json({ error: 'Database error while checking existing member' });
        }

        if (memberResults.length > 0) {
          return res.status(400).json({ error: 'User is already a member of this project' });
        }

        // Add the new project member
        const addMemberQuery = `
          INSERT INTO project_members (project_id, user_id, role, joined_at)
          VALUES (?, ?, ?, NOW())
        `;

        connection.query(addMemberQuery, [projectId, userId, role], (err, results) => {
          if (err) {
            console.error('Error adding project member:', err);
            return res.status(500).json({ error: 'Database error while adding member' });
          }

          // Fetch updated members list
          const getMembersQuery = `
            SELECT u.name, u.email
            FROM project_members pm
            JOIN users u ON pm.user_id = u.id
            WHERE pm.project_id = ?
          `;

          connection.query(getMembersQuery, [projectId], (err, membersList) => {
            if (err) {
              console.error('Error fetching updated members list:', err);
              return res.status(500).json({ error: 'Database error while fetching members' });
            }

            res.status(200).json({ 
              message: 'Member added successfully',
              members: membersList.map(member => ({ name: member.name, email: member.email }))
            });
          });
        });
      });
    });
  } catch (error) {
    console.error('Error in add_project_member:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Endpoint to remove a project member
app.delete('/remove_project_member', authenticateAdmin, (req, res) => {
  const { projectId, userId } = req.body;

  const query = `
    DELETE FROM project_members
    WHERE project_id = ? AND user_id = ?
  `;

  connection.query(query, [projectId, userId], (err, results) => {
    if (err) {
      console.error('Error removing project member:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ message: 'Project member removed successfully' });
  });
});

// Endpoint to fetch project members
app.get('/project_members/:projectId', authenticateToken, (req, res) => {
  const projectId = req.params.projectId;

  const query = `
    SELECT u.name, u.email, u.profile_image, pm.role, pm.joined_at
    FROM project_members pm
    JOIN users u ON pm.user_id = u.id
    WHERE pm.project_id = ?
  `;

  connection.query(query, [projectId], (err, results) => {
    if (err) {
      console.error('Error fetching project members:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    const members = results.map(member => ({
      ...member,
      profile_image: member.profile_image 
        ? `https://emissionserver.vercel.app//uploads/${member.profile_image}`
        : null,
      roleTitle: member.role === 'project_owner' ? 'Project Owner (Client)'
               : member.role === 'project_leader' ? 'Project Leader (Team Manager)'
               : 'Team Member'
    }));

    res.json({ members });
  });
});

// Endpoint to validate if a user email exists
app.get('/validate_user_email/:email', authenticateToken, (req, res) => {
  const { email } = req.params;

  // Check if email exists in the database
  const query = 'SELECT * FROM users WHERE email = ?';
  
  connection.query(query, [email], (err, results) => {
    if (err) {
      console.error('Error validating user email:', err);
      return res.status(500).json({ error: 'Internal server error' });
    }

    // Return whether the email exists
    res.json({ exists: results.length > 0 });
  });
});

// Endpoint to update a project (admin only)
app.put('/admin/update_project/:id', authenticateAdmin, (req, res) => {
  const projectId = req.params.id;
  const {
    projectName,
    projectDescription,
    status,
    stage_start_date,
    stage_due_date,
    project_due_date
  } = req.body;

  // Convert dates to YYYY-MM-DD format
  const formattedStageStartDate = stage_start_date ? new Date(stage_start_date).toISOString().split('T')[0] : null;
  const formattedStageDueDate = stage_due_date ? new Date(stage_due_date).toISOString().split('T')[0] : null;
  const formattedProjectDueDate = project_due_date ? new Date(project_due_date).toISOString().split('T')[0] : null;

  // Updated query to also update timeline fields
  const query = `
    UPDATE user_history 
    SET project_name = ?,
        project_description = ?,
        status = ?,
        stage_start_date = ?,
        stage_due_date = ?,
        project_due_date = ?
    WHERE id = ?
  `;

  connection.query(query, [
    projectName,
    projectDescription,
    status,
    formattedStageStartDate,
    formattedStageDueDate,
    formattedProjectDueDate,
    projectId
  ], (err, results) => {
    if (err) {
      console.error('Database error:', err);
      return res.status(500).json({ error: 'Database error', details: err.message });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Project not found' });
    }

    console.log('Update successful:', results);
    res.status(200).json({ 
      message: 'Project updated successfully',
      projectId: projectId,
      affectedRows: results.affectedRows
    });
  });
});

// Create temporary user for project owner
app.post('/create_temp_user', authenticateAdmin, (req, res) => {
  const { email, organization } = req.body;

  // Check if user already exists
  const checkUserQuery = 'SELECT id FROM users WHERE email = ?';
  
  connection.query(checkUserQuery, [email], (err, results) => {
    if (err) {
      console.error('Error checking existing user:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    // If user exists, return their ID
    if (results.length > 0) {
      return res.status(200).json({ 
        userId: results[0].id,
        message: 'User already exists',
        isExisting: true 
      });
    }

    // Create new temporary user
    const createUserQuery = `
      INSERT INTO users (name, email, password, organization, created_at)
      VALUES (?, ?, 'temporary_password', ?, NOW())
    `;

    const userName = email.split('@')[0]; // Use part before @ as temporary name

    connection.query(createUserQuery, [userName, email, organization], (err, result) => {
      if (err) {
        console.error('Error creating temporary user:', err);
        return res.status(500).json({ error: 'Failed to create temporary user' });
      }

      res.status(201).json({ 
        userId: result.insertId,
        message: 'Temporary user created successfully',
        isExisting: false
      });
    });
  });
});

// Project Request Endpoints

// Submit new project request (for users)
app.post('/project-requests', authenticateToken, (req, res) => {
  const userId = req.user.id;
  const {
    title,
    description,
    project_stage,
    organization,
    stage_duration,
    stage_start_date,
    stage_due_date,
    project_start_date,
    project_due_date
  } = req.body;

  // Validate required fields
  if (!title || !description) {
    return res.status(400).json({ error: 'Title and description are required' });
  }

  const query = `
    INSERT INTO project_requests (
      user_id, title, description, project_stage, organization,
      stage_duration, stage_start_date, stage_due_date,
      project_start_date, project_due_date, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
  `;

  connection.query(
    query,
    [
      userId, title, description, project_stage, organization,
      stage_duration, stage_start_date, stage_due_date,
      project_start_date, project_due_date
    ],
    (err, results) => {
      if (err) {
        console.error('Error creating project request:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(201).json({
        message: 'Project request submitted successfully',
        requestId: results.insertId
      });
    }
  );
});

// Get all project requests (for admins)
app.get('/admin/project-requests', authenticateAdmin, (req, res) => {
  const query = `
    SELECT pr.*, u.name as user_name, u.email as user_email
    FROM project_requests pr
    JOIN users u ON pr.user_id = u.id
    ORDER BY pr.created_at DESC
  `;

  connection.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching project requests:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ requests: results });
  });
});

// Get user's own project requests
app.get('/user/project-requests', authenticateToken, (req, res) => {
  const userId = req.user.id;

  const query = `
    SELECT *
    FROM project_requests
    WHERE user_id = ?
    ORDER BY created_at DESC
  `;

  connection.query(query, [userId], (err, results) => {
    if (err) {
      console.error('Error fetching user project requests:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    res.status(200).json({ requests: results });
  });
});

// Approve project request (admin only)
app.put('/admin/project-requests/:id/approve', authenticateAdmin, (req, res) => {
  const requestId = req.params.id;
  const reviewerId = req.user.id;
  const { review_notes } = req.body;

  // Start a transaction
  connection.beginTransaction(err => {
    if (err) {
      console.error('Error starting transaction:', err);
      return res.status(500).json({ error: 'Transaction error' });
    }

    // First, update the request status
    const updateQuery = `
      UPDATE project_requests
      SET status = 'approved', reviewer_id = ?, review_notes = ?
      WHERE id = ?
    `;

    connection.query(updateQuery, [reviewerId, review_notes, requestId], (err, results) => {
      if (err) {
        return connection.rollback(() => {
          console.error('Error updating request:', err);
          res.status(500).json({ error: 'Database error' });
        });
      }

      if (results.affectedRows === 0) {
        return connection.rollback(() => {
          res.status(404).json({ error: 'Request not found' });
        });
      }

      // Get the request details to create the project
      const getRequestQuery = `
        SELECT * FROM project_requests WHERE id = ?
      `;

      connection.query(getRequestQuery, [requestId], (err, requests) => {
        if (err) {
          return connection.rollback(() => {
            console.error('Error fetching request:', err);
            res.status(500).json({ error: 'Database error' });
          });
        }

        if (requests.length === 0) {
          return connection.rollback(() => {
            res.status(404).json({ error: 'Request not found' });
          });
        }

        const request = requests[0];

        // Create the project based on the request with explicit 0 values for session_duration and carbon_emit
        const createProjectQuery = `
          INSERT INTO user_history (
            user_id, project_name, project_description, stage,
            organization, stage_duration, stage_start_date, stage_due_date,
            project_start_date, project_due_date, status, session_duration, carbon_emit
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, 0)
        `;

        const projectValues = [
          request.user_id,
          request.title,
          request.description,
          request.project_stage,
          request.organization,
          request.stage_duration,
          request.stage_start_date,
          request.stage_due_date,
          request.project_start_date,
          request.project_due_date
        ];

        connection.query(createProjectQuery, projectValues, (err, projectResult) => {
          if (err) {
            return connection.rollback(() => {
              console.error('Error creating project:', err);
              res.status(500).json({ error: 'Database error' });
            });
          }

          const projectId = projectResult.insertId;
          
          // Update the project_id field to be the same as the project's ID
          const updateProjectIdQuery = `
            UPDATE user_history 
            SET project_id = ? 
            WHERE id = ?
          `;
            connection.query(updateProjectIdQuery, [projectId, projectId], (err) => {
            if (err) {
              return connection.rollback(() => {
                console.error('Error updating project ID:', err);
                res.status(500).json({ error: 'Failed to update project ID' });
              });
            }
            
            // Add the user as both project_owner and project_leader in the project_members table
            const addOwnerQuery = `
              INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
              VALUES (?, ?, 'project_owner', ?, 'In Progress')
            `;
            
            connection.query(addOwnerQuery, [projectId, request.user_id, request.project_stage], (err) => {
              if (err) {
                return connection.rollback(() => {
                  console.error('Error adding project owner:', err);
                  res.status(500).json({ error: 'Failed to add project owner' });
                });
              }
              
              // Add the same user as project_leader
              const addLeaderQuery = `
                INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
                VALUES (?, ?, 'project_leader', ?, 'In Progress')
              `;
              
              connection.query(addLeaderQuery, [projectId, request.user_id, request.project_stage], (err) => {
                if (err) {
                  return connection.rollback(() => {
                    console.error('Error adding project leader:', err);
                    res.status(500).json({ error: 'Failed to add project leader' });
                  });
                }
                
                // If everything was successful, commit the transaction
                connection.commit(err => {
                  if (err) {
                    return connection.rollback(() => {
                      console.error('Error committing transaction:', err);
                      res.status(500).json({ error: 'Transaction error' });
                    });
                  }
                  
                  res.status(200).json({
                    message: 'Project request approved and project created successfully',
                    projectId: projectId
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

// Reject project request (admin only)
app.put('/admin/project-requests/:id/reject', authenticateAdmin, (req, res) => {
  const requestId = req.params.id;
  const reviewerId = req.user.id;
  const { review_notes } = req.body;

  const query = `
    UPDATE project_requests
    SET status = 'rejected', reviewer_id = ?, review_notes = ?
    WHERE id = ?
  `;

  connection.query(query, [reviewerId, review_notes, requestId], (err, results) => {
    if (err) {
      console.error('Error rejecting project request:', err);
      return res.status(500).json({ error: 'Database error' });
    }

    if (results.affectedRows === 0) {
      return res.status(404).json({ error: 'Request not found' });
    }

    res.status(200).json({ message: 'Project request rejected successfully' });
  });
});