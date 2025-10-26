const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'your_secret_key';

module.exports = (queryDatabase, authenticateAdmin) => {
  // Admin login
  router.post('/admin_login', (req, res) => {
    const { email, password } = req.body;

    const adminQuery = 'SELECT id, email FROM admins WHERE email = ? AND password = ?';
    queryDatabase(adminQuery, [email, password], (err, results) => {
      if (err) {
        console.error('Error logging in admin:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(401).json({ error: 'Invalid email or password' });
      }

      const admin = results[0];
      const token = jwt.sign({ id: admin.id, email: admin.email, isAdmin: true }, JWT_SECRET, { expiresIn: '24h' });

      res.status(200).json({
        message: 'Admin login successful',
        token,
        admin: {
          id: admin.id,
          email: admin.email,
        },
      });
    });
  });

  // Get all users
  router.get('/all_users', authenticateAdmin, (req, res) => {
    const query = 'SELECT id, name, email, organization, region FROM users';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching users:', err);
        return res.status(500).json({ error: 'Error fetching users' });
      }

      res.status(200).json({ users: results });
    });
  });

  // Get user's organization
  router.get('/user_organization/:email', authenticateAdmin, (req, res) => {
    const { email } = req.params;

    const query = 'SELECT organization FROM users WHERE email = ?';
    queryDatabase(query, [email], (err, results) => {
      if (err) {
        console.error('Error fetching user organization:', err);
        return res.status(500).json({ error: 'Error fetching organization' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json({ organization: results[0].organization });
    });
  });

  // Get all users' projects
  router.get('/all_user_projects_admin', authenticateAdmin, (req, res) => {
    const query = `
      SELECT uh.id, uh.user_id, uh.project_name, uh.project_description, uh.carbon_emit, uh.status, u.name, u.email
      FROM user_history uh
      JOIN users u ON uh.user_id = u.id
    `;

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching all projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Get emission data
  router.get('/emission_data', authenticateAdmin, (req, res) => {
    const query = `
      SELECT uh.project_name, SUM(uh.carbon_emit) as total_emissions, u.name as user_name
      FROM user_history uh
      JOIN users u ON uh.user_id = u.id
      GROUP BY uh.project_name, u.name
    `;

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching emission data:', err);
        return res.status(500).json({ error: 'Error fetching emission data' });
      }

      res.status(200).json({ emissions: results });
    });
  });

  // Get organization projects
  router.get('/organization_projects', authenticateAdmin, (req, res) => {
    const { organization } = req.query;

    const query = `
      SELECT uh.id, uh.project_name, uh.project_description, uh.session_duration, uh.carbon_emit, uh.status, uh.stage, u.name AS owner
      FROM user_history uh
      JOIN users u ON uh.user_id = u.id
      WHERE uh.organization = ?
    `;

    queryDatabase(query, [organization], (err, results) => {
      if (err) {
        console.error('Error fetching organization projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Delete user
  router.delete('/delete_user/:id', authenticateAdmin, (req, res) => {
    const userId = req.params.id;

    const deleteQuery = 'DELETE FROM users WHERE id = ?';

    queryDatabase(deleteQuery, [userId], (err, results) => {
      if (err) {
        console.error('Error deleting user:', err);
        return res.status(500).json({ error: 'Error deleting user' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json({ message: 'User deleted successfully' });
    });
  });

  // Get project members
  router.get('/project_members/:projectId', authenticateAdmin, (req, res) => {
    const { projectId } = req.params;

    const query = `
      SELECT pm.id, pm.user_id, pm.role, u.name, u.email
      FROM project_members pm
      JOIN users u ON pm.user_id = u.id
      WHERE pm.project_id = ?
    `;

    queryDatabase(query, [projectId], (err, results) => {
      if (err) {
        console.error('Error fetching project members:', err);
        return res.status(500).json({ error: 'Error fetching members' });
      }

      res.status(200).json({ members: results });
    });
  });

  // Desktop CPUs management
  router.get('/admin/cpus', authenticateAdmin, (req, res) => {
    const query = 'SELECT * FROM cpus';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching CPUs:', err);
        return res.status(500).json({ error: 'Error fetching CPUs' });
      }

      res.status(200).json({ cpus: results });
    });
  });

  router.post('/admin/cpus', authenticateAdmin, (req, res) => {
    const { manufacturer, series, model, avg_watt_usage } = req.body;

    const query = 'INSERT INTO cpus (manufacturer, series, model, avg_watt_usage) VALUES (?, ?, ?, ?)';
    queryDatabase(query, [manufacturer, series, model, avg_watt_usage], (err, results) => {
      if (err) {
        console.error('Error adding CPU:', err);
        return res.status(500).json({ error: 'Error adding CPU' });
      }

      res.status(201).json({ message: 'CPU added successfully', cpuId: results.insertId });
    });
  });

  router.put('/admin/cpus/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { manufacturer, series, model, avg_watt_usage } = req.body;

    const query = 'UPDATE cpus SET manufacturer = ?, series = ?, model = ?, avg_watt_usage = ? WHERE id = ?';
    queryDatabase(query, [manufacturer, series, model, avg_watt_usage, id], (err, results) => {
      if (err) {
        console.error('Error updating CPU:', err);
        return res.status(500).json({ error: 'Error updating CPU' });
      }

      res.status(200).json({ message: 'CPU updated successfully' });
    });
  });

  router.delete('/admin/cpus/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM cpus WHERE id = ?';
    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error deleting CPU:', err);
        return res.status(500).json({ error: 'Error deleting CPU' });
      }

      res.status(200).json({ message: 'CPU deleted successfully' });
    });
  });

  // Mobile CPUs management
  router.get('/admin/cpus-mobile', authenticateAdmin, (req, res) => {
    const query = 'SELECT * FROM cpusm';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching mobile CPUs:', err);
        return res.status(500).json({ error: 'Error fetching CPUs' });
      }

      res.status(200).json({ cpus: results });
    });
  });

  router.post('/admin/cpus-mobile', authenticateAdmin, (req, res) => {
    const { generation, model, cpu_watts } = req.body;

    const query = 'INSERT INTO cpusm (generation, model, cpu_watts) VALUES (?, ?, ?)';
    queryDatabase(query, [generation, model, cpu_watts], (err, results) => {
      if (err) {
        console.error('Error adding mobile CPU:', err);
        return res.status(500).json({ error: 'Error adding CPU' });
      }

      res.status(201).json({ message: 'CPU added successfully', cpuId: results.insertId });
    });
  });

  router.put('/admin/cpus-mobile/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { generation, model, cpu_watts } = req.body;

    const query = 'UPDATE cpusm SET generation = ?, model = ?, cpu_watts = ? WHERE id = ?';
    queryDatabase(query, [generation, model, cpu_watts, id], (err, results) => {
      if (err) {
        console.error('Error updating mobile CPU:', err);
        return res.status(500).json({ error: 'Error updating CPU' });
      }

      res.status(200).json({ message: 'CPU updated successfully' });
    });
  });

  router.delete('/admin/cpus-mobile/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM cpusm WHERE id = ?';
    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error deleting mobile CPU:', err);
        return res.status(500).json({ error: 'Error deleting CPU' });
      }

      res.status(200).json({ message: 'CPU deleted successfully' });
    });
  });

  // Desktop GPUs management
  router.get('/admin/gpus', authenticateAdmin, (req, res) => {
    const query = 'SELECT * FROM gpus';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching GPUs:', err);
        return res.status(500).json({ error: 'Error fetching GPUs' });
      }

      res.status(200).json({ gpus: results });
    });
  });

  router.post('/admin/gpus', authenticateAdmin, (req, res) => {
    const { manufacturer, series, model, avg_watt_usage } = req.body;

    const query = 'INSERT INTO gpus (manufacturer, series, model, avg_watt_usage) VALUES (?, ?, ?, ?)';
    queryDatabase(query, [manufacturer, series, model, avg_watt_usage], (err, results) => {
      if (err) {
        console.error('Error adding GPU:', err);
        return res.status(500).json({ error: 'Error adding GPU' });
      }

      res.status(201).json({ message: 'GPU added successfully', gpuId: results.insertId });
    });
  });

  router.put('/admin/gpus/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { manufacturer, series, model, avg_watt_usage } = req.body;

    const query = 'UPDATE gpus SET manufacturer = ?, series = ?, model = ?, avg_watt_usage = ? WHERE id = ?';
    queryDatabase(query, [manufacturer, series, model, avg_watt_usage, id], (err, results) => {
      if (err) {
        console.error('Error updating GPU:', err);
        return res.status(500).json({ error: 'Error updating GPU' });
      }

      res.status(200).json({ message: 'GPU updated successfully' });
    });
  });

  router.delete('/admin/gpus/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM gpus WHERE id = ?';
    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error deleting GPU:', err);
        return res.status(500).json({ error: 'Error deleting GPU' });
      }

      res.status(200).json({ message: 'GPU deleted successfully' });
    });
  });

  // Mobile GPUs management
  router.get('/admin/gpus-mobile', authenticateAdmin, (req, res) => {
    const query = 'SELECT * FROM gpusm';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching mobile GPUs:', err);
        return res.status(500).json({ error: 'Error fetching GPUs' });
      }

      res.status(200).json({ gpus: results });
    });
  });

  router.post('/admin/gpus-mobile', authenticateAdmin, (req, res) => {
    const { manufacturer, model, gpu_watts } = req.body;

    const query = 'INSERT INTO gpusm (manufacturer, model, gpu_watts) VALUES (?, ?, ?)';
    queryDatabase(query, [manufacturer, model, gpu_watts], (err, results) => {
      if (err) {
        console.error('Error adding mobile GPU:', err);
        return res.status(500).json({ error: 'Error adding GPU' });
      }

      res.status(201).json({ message: 'GPU added successfully', gpuId: results.insertId });
    });
  });

  router.put('/admin/gpus-mobile/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { manufacturer, model, gpu_watts } = req.body;

    const query = 'UPDATE gpusm SET manufacturer = ?, model = ?, gpu_watts = ? WHERE id = ?';
    queryDatabase(query, [manufacturer, model, gpu_watts, id], (err, results) => {
      if (err) {
        console.error('Error updating mobile GPU:', err);
        return res.status(500).json({ error: 'Error updating GPU' });
      }

      res.status(200).json({ message: 'GPU updated successfully' });
    });
  });

  router.delete('/admin/gpus-mobile/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM gpusm WHERE id = ?';
    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error deleting mobile GPU:', err);
        return res.status(500).json({ error: 'Error deleting GPU' });
      }

      res.status(200).json({ message: 'GPU deleted successfully' });
    });
  });

  // RAM management
  router.get('/admin/rams', authenticateAdmin, (req, res) => {
    const query = 'SELECT * FROM ram';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching RAM:', err);
        return res.status(500).json({ error: 'Error fetching RAM' });
      }

      res.status(200).json({ rams: results });
    });
  });

  router.post('/admin/rams', authenticateAdmin, (req, res) => {
    const { ddr_generation, avg_watt_usage } = req.body;

    const query = 'INSERT INTO ram (ddr_generation, avg_watt_usage) VALUES (?, ?)';
    queryDatabase(query, [ddr_generation, avg_watt_usage], (err, results) => {
      if (err) {
        console.error('Error adding RAM:', err);
        return res.status(500).json({ error: 'Error adding RAM' });
      }

      res.status(201).json({ message: 'RAM added successfully', ramId: results.insertId });
    });
  });

  router.put('/admin/rams/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { ddr_generation, avg_watt_usage } = req.body;

    const query = 'UPDATE ram SET ddr_generation = ?, avg_watt_usage = ? WHERE id = ?';
    queryDatabase(query, [ddr_generation, avg_watt_usage, id], (err, results) => {
      if (err) {
        console.error('Error updating RAM:', err);
        return res.status(500).json({ error: 'Error updating RAM' });
      }

      res.status(200).json({ message: 'RAM updated successfully' });
    });
  });

  router.delete('/admin/rams/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM ram WHERE id = ?';
    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error deleting RAM:', err);
        return res.status(500).json({ error: 'Error deleting RAM' });
      }

      res.status(200).json({ message: 'RAM deleted successfully' });
    });
  });

  return router;
};
