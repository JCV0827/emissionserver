const express = require('express');
const router = express.Router();

module.exports = (queryDatabase, authenticateToken) => {
  // Get CPU options for desktop
  router.get('/cpu-options', (req, res) => {
    const query = 'SELECT manufacturer, series, model FROM cpus';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching CPU options:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ cpus: results });
    });
  });

  // Get GPU options for desktop
  router.get('/gpu-options', (req, res) => {
    const query = 'SELECT manufacturer, series, model FROM gpus';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching GPU options:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ gpus: results });
    });
  });

  // Get CPU options for mobile
  router.get('/cpu-options-mobile', (req, res) => {
    const query = 'SELECT generation, model FROM cpusm';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching mobile CPU options:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ cpus: results });
    });
  });

  // Get GPU options for mobile
  router.get('/gpu-options-mobile', (req, res) => {
    const query = 'SELECT manufacturer, model FROM gpusm';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching mobile GPU options:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ gpus: results });
    });
  });

  // Get RAM options
  router.get('/ram-options', (req, res) => {
    const query = 'SELECT ddr_generation FROM ram';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching RAM options:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      res.status(200).json({ rams: results });
    });
  });

  // Get hardware wattage for Python analyzer
  router.post('/get-hardware-wattage', authenticateToken, async (req, res) => {
    const { cpu, gpu, ram, psu, deviceType } = req.body;
    const userId = req.user.id;

    try {
      let cpuWatts = 0;
      let gpuWatts = 0;
      let ramWatts = 0;

      // Fetch CPU wattage
      const getCPUQuery = deviceType === 'mobile' 
        ? 'SELECT cpu_watts FROM cpusm WHERE model = ?'
        : 'SELECT avg_watt_usage FROM cpus WHERE model = ?';

      cpuWatts = await new Promise((resolve, reject) => {
        queryDatabase(getCPUQuery, [cpu], (err, results) => {
          if (err) reject(err);
          const columnName = deviceType === 'mobile' ? 'cpu_watts' : 'avg_watt_usage';
          resolve(results[0]?.[columnName] || (deviceType === 'mobile' ? 10 : 65));
        });
      });

      // Fetch GPU wattage
      const getGPUQuery = deviceType === 'mobile'
        ? 'SELECT gpu_watts FROM gpusm WHERE model = ?'
        : 'SELECT avg_watt_usage FROM gpus WHERE model = ?';

      gpuWatts = await new Promise((resolve, reject) => {
        queryDatabase(getGPUQuery, [gpu], (err, results) => {
          if (err) reject(err);
          const columnName = deviceType === 'mobile' ? 'gpu_watts' : 'avg_watt_usage';
          resolve(results[0]?.[columnName] || (deviceType === 'mobile' ? 5 : 150));
        });
      });

      // Fetch RAM wattage if provided
      if (ram) {
        ramWatts = await new Promise((resolve, reject) => {
          queryDatabase('SELECT avg_watt_usage FROM ram WHERE ddr_generation = ?', [ram], (err, results) => {
            if (err) reject(err);
            resolve(results[0]?.avg_watt_usage || 3);
          });
        });
      }

      const totalWatts = cpuWatts + gpuWatts + ramWatts;

      res.status(200).json({
        cpu_watts: cpuWatts,
        gpu_watts: gpuWatts,
        ram_watts: ramWatts,
        total_watts: totalWatts,
      });
    } catch (error) {
      console.error('Error fetching hardware wattage:', error);
      res.status(500).json({ error: 'Error fetching hardware wattage' });
    }
  });

  // Display user desktop info
  router.get('/displayuser', authenticateToken, (req, res) => {
    const { email } = req.user;

    const userQuery = `
      SELECT id, name, email, organization, region, profile_image, current_device_id
      FROM users 
      WHERE email = ?
    `;

    queryDatabase(userQuery, [email], (err, userResults) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).json({ error: 'Error fetching user' });
      }

      if (userResults.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResults[0];

      if (!user.current_device_id) {
        return res.status(200).json({ user, device: null });
      }

      const deviceQuery = 'SELECT * FROM devices WHERE id = ? AND device_type = ?';
      queryDatabase(deviceQuery, [user.current_device_id, 'personal_computer'], (deviceErr, deviceResults) => {
        if (deviceErr) {
          console.error('Error fetching device:', deviceErr);
          return res.status(500).json({ error: 'Error fetching device' });
        }

        res.status(200).json({ user, device: deviceResults[0] || null });
      });
    });
  });

  // Display user mobile/laptop info
  router.get('/displayuserM', authenticateToken, (req, res) => {
    const { email } = req.user;

    const userQuery = `
      SELECT id, name, email, profile_image, current_device_id
      FROM users 
      WHERE email = ?
    `;

    queryDatabase(userQuery, [email], (err, userResults) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).json({ error: 'Error fetching user' });
      }

      if (userResults.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const user = userResults[0];

      if (!user.current_device_id) {
        return res.status(200).json({ user, device: null });
      }

      const deviceQuery = 'SELECT * FROM devices WHERE id = ? AND device_type IN (?, ?)';
      queryDatabase(deviceQuery, [user.current_device_id, 'laptop', 'mobile'], (deviceErr, deviceResults) => {
        if (deviceErr) {
          console.error('Error fetching device:', deviceErr);
          return res.status(500).json({ error: 'Error fetching device' });
        }

        res.status(200).json({ user, device: deviceResults[0] || null });
      });
    });
  });

  // Check device type
  router.get('/checkDeviceType', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const getCurrentDeviceIdQuery = `SELECT current_device_id FROM users WHERE id = ?`;

    queryDatabase(getCurrentDeviceIdQuery, [userId], (err, result) => {
      if (err) {
        console.error('Error fetching current device:', err);
        return res.status(500).json({ error: 'Error fetching device' });
      }

      if (result.length === 0 || !result[0].current_device_id) {
        return res.status(200).json({ deviceType: null });
      }

      const deviceId = result[0].current_device_id;

      const getDeviceTypeQuery = `SELECT device_type FROM devices WHERE id = ?`;
      queryDatabase(getDeviceTypeQuery, [deviceId], (typeErr, typeResult) => {
        if (typeErr) {
          console.error('Error fetching device type:', typeErr);
          return res.status(500).json({ error: 'Error fetching device type' });
        }

        if (typeResult.length === 0) {
          return res.status(200).json({ deviceType: null });
        }

        res.status(200).json({ deviceType: typeResult[0].device_type });
      });
    });
  });

  // Add device
  router.post('/addDevice', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { device_type, cpu, gpu, ram, psu, storage, screen_size, model } = req.body;

    const query = `
      INSERT INTO devices (user_id, device_type, cpu, gpu, ram, psu, storage, screen_size, model)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    queryDatabase(query, [userId, device_type, cpu || null, gpu || null, ram || null, psu || null, storage || null, screen_size || null, model || null], (err, results) => {
      if (err) {
        console.error('Error adding device:', err);
        return res.status(500).json({ error: 'Error adding device' });
      }

      res.status(201).json({ message: 'Device added successfully', deviceId: results.insertId });
    });
  });

  // Set current device
  router.put('/setCurrentDevice', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { deviceId } = req.body;

    const query = 'UPDATE users SET current_device_id = ? WHERE id = ?';

    queryDatabase(query, [deviceId, userId], (err, results) => {
      if (err) {
        console.error('Error setting current device:', err);
        return res.status(500).json({ error: 'Error setting device' });
      }

      res.status(200).json({ message: 'Current device updated successfully' });
    });
  });

  // Get user devices
  router.get('/user_devices', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = 'SELECT * FROM devices WHERE user_id = ?';

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching user devices:', err);
        return res.status(500).json({ error: 'Error fetching devices' });
      }

      res.status(200).json({ devices: results });
    });
  });

  // Compare devices
  router.get('/compare_devices', authenticateToken, async (req, res) => {
    const userId = req.user.id;

    try {
      const userQuery = 'SELECT region, current_device_id FROM users WHERE id = ?';
      const userResult = await new Promise((resolve, reject) => {
        queryDatabase(userQuery, [userId], (err, results) => {
          if (err) reject(err);
          resolve(results[0]);
        });
      });

      if (!userResult) {
        return res.status(404).json({ error: 'User not found' });
      }

      const devicesQuery = 'SELECT * FROM devices WHERE user_id = ?';
      const devices = await new Promise((resolve, reject) => {
        queryDatabase(devicesQuery, [userId], (err, results) => {
          if (err) reject(err);
          resolve(results);
        });
      });

      const comparison = devices.map(device => ({
        ...device,
        current: device.id === userResult.current_device_id,
      }));

      res.status(200).json({ devices: comparison });
    } catch (error) {
      console.error('Error comparing devices:', error);
      res.status(500).json({ error: 'Error comparing devices' });
    }
  });

  return router;
};
