const express = require('express');
const router = express.Router();

const CANONICAL_STAGES = [
  'Design: Creating the software architecture',
  'Development: Writing the actual code',
  'Testing: Ensuring the software works as expected'
];

module.exports = (queryDatabase, authenticateToken) => {
  // Add code emission entry
  router.post('/add_code_emission', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { project_id, stage, emissions_gco2, energy_kwh, eco_score } = req.body;

    const checkQuery = `
      SELECT id FROM user_history WHERE id = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?))
    `;

    queryDatabase(checkQuery, [project_id, userId, userId], (err, results) => {
      if (err) {
        console.error('Error checking project access:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Project not found or no access' });
      }

      const insertQuery = `
        INSERT INTO user_history (
          user_id, organization, project_name, project_description,
          session_duration, carbon_emit, stage, status,
          stage_duration, stage_start_date, stage_due_date,
          project_start_date, project_due_date
        ) VALUES (
          (SELECT user_id FROM user_history WHERE id = ?),
          (SELECT organization FROM user_history WHERE id = ?),
          (SELECT project_name FROM user_history WHERE id = ?),
          (SELECT project_description FROM user_history WHERE id = ?),
          0, ?, ?, 'Calculated',
          (SELECT stage_duration FROM user_history WHERE id = ?),
          (SELECT stage_start_date FROM user_history WHERE id = ?),
          (SELECT stage_due_date FROM user_history WHERE id = ?),
          (SELECT project_start_date FROM user_history WHERE id = ?),
          (SELECT project_due_date FROM user_history WHERE id = ?)
        )
      `;

      queryDatabase(insertQuery, [
        project_id, project_id, project_id, project_id,
        emissions_gco2, stage, project_id, project_id, project_id, project_id, project_id
      ], (err, results) => {
        if (err) {
          console.error('Error inserting code emission:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        res.status(201).json({ message: 'Code emission added successfully', id: results.insertId });
      });
    });
  });

  // Add code analysis with validation and gating
  router.post('/add_code_calculated', authenticateToken, async (req, res) => {
    const userId = req.user.id;
    const { project_id, stage, emissions_gco2, energy_kwh, eco_score, time_complexity, space_complexity } = req.body;

    // Validate required fields
    if (!project_id || !stage) {
      return res.status(400).json({ error: 'Missing required fields: project_id and stage' });
    }

    if (emissions_gco2 == null) {
      return res.status(400).json({ error: 'Missing required field: emissions_gco2' });
    }

    if (!CANONICAL_STAGES.includes(stage)) {
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
          if (err) reject(err);
          resolve(rows && rows.length > 0 ? rows[0] : null);
        });
      });

      if (!accessCheck) {
        return res.status(404).json({ error: 'Project not found or no access' });
      }

      // Gating: requested stage must be reached (<= current stage)
      const currentStage = accessCheck.current_stage;
      if (!currentStage) {
        return res.status(400).json({ error: 'Unable to determine current project stage' });
      }

      const reqIdx = CANONICAL_STAGES.indexOf(stage);
      const curIdx = CANONICAL_STAGES.indexOf(currentStage);

      if (curIdx === -1) {
        return res.status(400).json({ error: 'Project current stage is not recognized' });
      }

      if (reqIdx > curIdx) {
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
          return res.status(404).json({ error: 'Project not found' });
        }

        const base = baseRows[0];

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

        queryDatabase(insertSql, params, (err, result) => {
          if (err) {
            console.error('Error inserting code analysis:', err);
            return res.status(500).json({
              error: 'Database error inserting code analysis',
              details: err.message
            });
          }

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

  // List code analyses for a project and stage
  router.get('/code_analyses/:projectId/:stage', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { projectId, stage } = req.params;

    const accessSql = `
      SELECT uh.id
      FROM user_history uh
      LEFT JOIN project_members pm ON pm.project_id = uh.id AND pm.user_id = ?
      WHERE uh.id = ? AND (uh.user_id = ? OR pm.user_id IS NOT NULL)
      LIMIT 1`;

    queryDatabase(accessSql, [userId, projectId, userId], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Project not found or no access' });

      const listSql = `
        SELECT ch.id, ch.project_id, ch.stage,
               ch.carbon_emit AS emissions_gco2, ch.energy_kwh, ch.eco_score, ch.time_complexity, ch.space_complexity,
               ch.created_at AS analysis_date, u.name AS user_name
        FROM user_history ch
        JOIN users u ON u.id = ch.user_id
        WHERE ch.project_id = ? AND ch.stage = ? AND ch.entry_type = 'code' AND ch.is_deleted = 0
        ORDER BY ch.created_at DESC`;

      queryDatabase(listSql, [projectId, stage], (err2, rows2) => {
        if (err2) return res.status(500).json({ error: 'Database error' });
        return res.status(200).json({ analyses: rows2 });
      });
    });
  });

  // Soft-delete a specific code analysis row
  router.delete('/code_analysis/:id', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { id } = req.params;

    const fetchSql = `
      SELECT id, project_id, entry_type, user_id
      FROM user_history
      WHERE id = ? AND entry_type = 'code' AND is_deleted = 0
      LIMIT 1`;

    queryDatabase(fetchSql, [id], (err, rows) => {
      if (err) return res.status(500).json({ error: 'Database error' });
      if (!rows || rows.length === 0) return res.status(404).json({ error: 'Code analysis not found' });

      const projectId = rows[0].project_id;

      const accessSql = `
        SELECT uh.id
        FROM user_history uh
        LEFT JOIN project_members pm ON pm.project_id = uh.id AND pm.user_id = ?
        WHERE uh.id = ? AND (uh.user_id = ? OR pm.user_id IS NOT NULL)
        LIMIT 1`;

      queryDatabase(accessSql, [userId, projectId, userId], (err2, rows2) => {
        if (err2) return res.status(500).json({ error: 'Database error' });
        if (!rows2 || rows2.length === 0) return res.status(403).json({ error: 'No permission to modify this project' });

        const delSql = `UPDATE user_history SET is_deleted = 1 WHERE id = ?`;
        queryDatabase(delSql, [id], (err3, result) => {
          if (err3) return res.status(500).json({ error: 'Database error' });
          return res.status(200).json({ message: 'Code analysis deleted' });
        });
      });
    });
  });

  return router;
};
