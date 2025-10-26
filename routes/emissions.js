const express = require('express');
const router = express.Router();

module.exports = (queryDatabase, authenticateToken, resolveCarbonFactor, resolveCarbonFactorWithSource, getRegions) => {
  // Get carbon regions
  router.get('/regions', (req, res) => {
    try {
      const regions = getRegions();
      res.status(200).json({ regions });
    } catch (e) {
      console.error('Error fetching regions:', e);
      res.status(500).json({ error: 'Error fetching regions' });
    }
  });

  // Get carbon factor
  router.get('/carbon-factor', async (req, res) => {
    try {
      const { region, zone, lat, lon } = req.query;
      const result = await resolveCarbonFactorWithSource({ region, zone, lat: parseFloat(lat), lon: parseFloat(lon) });
      res.status(200).json(result);
    } catch (e) {
      console.error('Error fetching carbon factor:', e);
      res.status(500).json({ error: 'Error fetching carbon factor' });
    }
  });

  // Calculate emissions for personal computer
  router.post('/calculate_emissions', authenticateToken, async (req, res) => {
    const { sessionDuration, projectId } = req.body;
    const userId = req.user.id;

    try {
      const getProjectQuery = `SELECT region FROM users WHERE id = ?`;
      queryDatabase(getProjectQuery, [userId], async (err, userResults) => {
        if (err) {
          console.error('Error fetching user:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (userResults.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        const region = userResults[0].region;
        const carbonFactor = await resolveCarbonFactor({ region });

        const deviceQuery = `SELECT cpu, gpu, ram, psu FROM devices WHERE id = (SELECT current_device_id FROM users WHERE id = ?)`;
        queryDatabase(deviceQuery, [userId], async (err, deviceResults) => {
          if (err) {
            console.error('Error fetching device:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          if (deviceResults.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
          }

          const device = deviceResults[0];

          const getCPUQuery = `SELECT avg_watt_usage FROM cpus WHERE model = ?`;
          queryDatabase(getCPUQuery, [device.cpu], (cpuErr, cpuResults) => {
            if (cpuErr) {
              console.error('Error fetching CPU:', cpuErr);
              return res.status(500).json({ error: 'Database error' });
            }

            const cpuWatts = cpuResults[0]?.avg_watt_usage || 65;

            const getGPUQuery = `SELECT avg_watt_usage FROM gpus WHERE model = ?`;
            queryDatabase(getGPUQuery, [device.gpu], (gpuErr, gpuResults) => {
              if (gpuErr) {
                console.error('Error fetching GPU:', gpuErr);
                return res.status(500).json({ error: 'Database error' });
              }

              const gpuWatts = gpuResults[0]?.avg_watt_usage || 150;

              const totalWatts = cpuWatts + gpuWatts;
              const energyKwh = (totalWatts / 1000) * (sessionDuration / 60);
              const carbonEmissions = energyKwh * carbonFactor;

              res.status(200).json({
                sessionDuration,
                totalWatts,
                energyKwh: energyKwh.toFixed(4),
                carbonEmissions: carbonEmissions.toFixed(4),
                region,
                carbonFactor,
              });
            });
          });
        });
      });
    } catch (error) {
      console.error('Error calculating emissions:', error);
      res.status(500).json({ error: 'Error calculating emissions' });
    }
  });

  // Get CPU watt usage
  router.get('/cpu_usage', (req, res) => {
    const { model } = req.query;
    const query = 'SELECT avg_watt_usage FROM cpus WHERE model = ?';
    
    queryDatabase(query, [model], (err, results) => {
      if (err) {
        console.error('Error fetching CPU usage:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'CPU not found' });
      }

      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    });
  });

  // Get GPU watt usage
  router.get('/gpu_usage', (req, res) => {
    const { model } = req.query;
    const query = 'SELECT avg_watt_usage FROM gpus WHERE model = ?';
    
    queryDatabase(query, [model], (err, results) => {
      if (err) {
        console.error('Error fetching GPU usage:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'GPU not found' });
      }

      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    });
  });

  // Calculate emissions for mobile/laptop
  router.post('/calculate_emissionsM', authenticateToken, async (req, res) => {
    const { sessionDuration, projectId } = req.body;
    const userId = req.user.id;

    try {
      const getUserQuery = `SELECT region FROM users WHERE id = ?`;
      queryDatabase(getUserQuery, [userId], async (err, userResults) => {
        if (err) {
          console.error('Error fetching user:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (userResults.length === 0) {
          return res.status(404).json({ error: 'User not found' });
        }

        const region = userResults[0].region;
        const carbonFactor = await resolveCarbonFactor({ region });

        const getDeviceQuery = `SELECT cpu, gpu, ram FROM devices WHERE id = (SELECT current_device_id FROM users WHERE id = ?)`;
        queryDatabase(getDeviceQuery, [userId], (devErr, deviceResults) => {
          if (devErr) {
            console.error('Error fetching device:', devErr);
            return res.status(500).json({ error: 'Database error' });
          }

          if (deviceResults.length === 0) {
            return res.status(404).json({ error: 'Device not found' });
          }

          const device = deviceResults[0];

          const getCPUQuery = `SELECT cpu_watts FROM cpusm WHERE model = ?`;
          queryDatabase(getCPUQuery, [device.cpu], (cpuErr, cpuResults) => {
            if (cpuErr) {
              console.error('Error fetching CPU:', cpuErr);
              return res.status(500).json({ error: 'Database error' });
            }

            const cpuWatts = cpuResults[0]?.cpu_watts || 10;

            const getGPUQuery = `SELECT gpu_watts FROM gpusm WHERE model = ?`;
            queryDatabase(getGPUQuery, [device.gpu], (gpuErr, gpuResults) => {
              if (gpuErr) {
                console.error('Error fetching GPU:', gpuErr);
                return res.status(500).json({ error: 'Database error' });
              }

              const gpuWatts = gpuResults[0]?.gpu_watts || 5;

              const totalWatts = cpuWatts + gpuWatts;
              const energyKwh = (totalWatts / 1000) * (sessionDuration / 60);
              const carbonEmissions = energyKwh * carbonFactor;

              res.status(200).json({
                sessionDuration,
                totalWatts,
                energyKwh: energyKwh.toFixed(4),
                carbonEmissions: carbonEmissions.toFixed(4),
                region,
                carbonFactor,
              });
            });
          });
        });
      });
    } catch (error) {
      console.error('Error calculating emissions:', error);
      res.status(500).json({ error: 'Error calculating emissions' });
    }
  });

  // Get CPU watt usage for mobile
  router.get('/cpum_usage', (req, res) => {
    const { model } = req.query;
    const query = 'SELECT cpu_watts AS avg_watt_usage FROM cpusm WHERE model = ?';
    
    queryDatabase(query, [model], (err, results) => {
      if (err) {
        console.error('Error fetching CPU usage:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'CPU not found' });
      }

      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    });
  });

  // Get GPU watt usage for mobile
  router.get('/gpum_usage', (req, res) => {
    const { model } = req.query;
    const query = 'SELECT gpu_watts AS avg_watt_usage FROM gpusm WHERE model = ?';
    
    queryDatabase(query, [model], (err, results) => {
      if (err) {
        console.error('Error fetching GPU usage:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'GPU not found' });
      }

      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    });
  });

  // Get RAM watt usage
  router.get('/ram_usage', (req, res) => {
    const { model } = req.query;
    const query = 'SELECT avg_watt_usage FROM ram WHERE ddr_generation = ?';
    
    queryDatabase(query, [model], (err, results) => {
      if (err) {
        console.error('Error fetching RAM usage:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'RAM not found' });
      }

      res.status(200).json({ avg_watt_usage: results[0].avg_watt_usage });
    });
  });

  // Get carbon emissions data
  router.get('/carbon-emissions', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);

    const query = `
      SELECT DATE(created_at) as date, SUM(carbon_emit) as total_emissions
      FROM user_history
      WHERE user_id = ? AND created_at >= ?
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `;

    queryDatabase(query, [userId, twoDaysAgo], (err, results) => {
      if (err) {
        console.error('Error fetching carbon emissions:', err);
        return res.status(500).json({ error: 'Error fetching emissions' });
      }

      res.status(200).json({ emissions: results });
    });
  });

  return router;
};
