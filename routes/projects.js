const express = require('express');
const router = express.Router();

const CANONICAL_STAGES = [
  'Design: Creating the software architecture',
  'Development: Writing the actual code',
  'Testing: Ensuring the software works as expected'
];

module.exports = (queryDatabase, authenticateToken, checkAndUpdateProjectCompletion) => {
  // Fetch user profile
  router.get('/user', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const userQuery = `
      SELECT id, name, email, organization, region, profile_image
      FROM users 
      WHERE id = ?
    `;

    queryDatabase(userQuery, [userId], (err, userResults) => {
      if (err) {
        console.error('Error fetching user:', err);
        return res.status(500).json({ error: 'Error fetching user data' });
      }

      if (userResults.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json({ user: userResults[0] });
    });
  });

  // Add project history
  router.post('/user_history', authenticateToken, (req, res) => {
    const { organization, projectName, projectDescription, sessionDuration, carbonEmit, projectStage, status } = req.body;
    const userId = req.user.id;

    const now = new Date();
    const stage_start_date = req.body.stage_start_date || now.toISOString().split('T')[0];
    const stage_duration = req.body.stage_duration || 14;
    
    const due_date = new Date(stage_start_date);
    due_date.setDate(due_date.getDate() + stage_duration);
    const stage_due_date = req.body.stage_due_date || due_date.toISOString().split('T')[0];
    
    const project_start_date = req.body.project_start_date || stage_start_date;
    const project_due_date = req.body.project_due_date || stage_due_date;

    const dates = [stage_start_date, stage_due_date, project_start_date, project_due_date];
    for (const date of dates) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD.' });
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

    queryDatabase(query, [
      userId, organization, projectName, projectDescription, 
      sessionDuration, carbonEmit, projectStage, status,
      stage_duration, stage_start_date, stage_due_date,
      project_start_date, project_due_date
    ], (err, results) => {
      if (err) {
        console.error('Error inserting project history:', err);
        return res.status(500).json({ error: 'Error creating project' });
      }

      res.status(201).json({ message: 'Project created successfully', projectId: results.insertId });
    });
  });

  // Get user's projects
  router.get('/user_projects', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
      SELECT id, organization, project_name, project_description, session_duration, carbon_emit, stage, status 
      FROM user_history 
      WHERE user_id = ? AND status <> 'Complete'
    `;

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching user projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Get all user projects grouped by name
  router.get('/all_user_projects', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
      SELECT project_name, SUM(carbon_emit) as total_emissions
      FROM user_history
      WHERE user_id = ?
      GROUP BY project_name
    `;

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching all user projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Get projects for profile display
  router.get('/profile_display_projects', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
      SELECT id, organization, project_name, project_description, session_duration, carbon_emit, stage, status, created_at 
      FROM user_history 
      WHERE user_id = ?
      ORDER BY created_at DESC
    `;

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching profile projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Get user's active projects
  router.get('/user_project_display', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
      SELECT id, organization, project_name, project_description, session_duration, carbon_emit, stage, status 
      FROM user_history 
      WHERE user_id = ? AND status
    `;

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching active projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Update project
  router.put('/update_project/:id', authenticateToken, (req, res) => {
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

    const formattedStageStartDate = stage_start_date ? new Date(stage_start_date).toISOString().split('T')[0] : null;
    const formattedProjectDueDate = project_due_date ? new Date(project_due_date).toISOString().split('T')[0] : null;

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

    queryDatabase(query, [
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
        console.error('Error updating project:', err);
        return res.status(500).json({ error: 'Error updating project' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Project not found or unauthorized' });
      }

      res.status(200).json({ message: 'Project updated successfully' });
    });
  });

  // Update project quick edit
  router.post('/user_Update', authenticateToken, (req, res) => {
    const { projectName, projectDescription, sessionDuration, carbonEmissions, projectStage, projectId } = req.body;
    const userId = req.user.id;

    const query = `
      UPDATE user_history 
      SET session_duration = ?, carbon_emit = ?, stage = ?
      WHERE id = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?)) AND project_name = ? AND project_description = ? AND status <> 'Complete'
    `;

    queryDatabase(
      query,
      [sessionDuration, carbonEmissions, projectStage, projectId, userId, userId, projectName, projectDescription],
      (err, results) => {
        if (err) {
          console.error('Error updating project:', err);
          return res.status(500).json({ error: 'Error updating project' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }

        res.status(200).json({ message: 'Project updated successfully' });
      }
    );
  });

  // Delete project
  router.delete('/delete_project/:id', authenticateToken, (req, res) => {
    const projectId = req.params.id;
    const userId = req.user.id;

    const deleteNotificationsQuery = `DELETE FROM notifications WHERE project_id = ?;`;

    queryDatabase(deleteNotificationsQuery, [projectId], (err, results) => {
      if (err) {
        console.error('Error deleting notifications:', err);
        return res.status(500).json({ error: 'Error deleting project' });
      }

      const deleteProjectQuery = `
        DELETE FROM user_history 
        WHERE id = ? AND user_id = ?;
      `;

      queryDatabase(deleteProjectQuery, [projectId, userId], (err, results) => {
        if (err) {
          console.error('Error deleting project:', err);
          return res.status(500).json({ error: 'Error deleting project' });
        }

        if (results.affectedRows === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }

        res.status(200).json({ message: 'Project deleted successfully' });
      });
    });
  });

  // Archive project
  router.put('/archive_project/:id', authenticateToken, (req, res) => {
    const projectId = req.params.id;
    const userId = req.user.id;

    const archiveProjectQuery = `
      UPDATE user_history 
      SET status = 'Archived'
      WHERE id = ? AND user_id = ?;
    `;

    queryDatabase(archiveProjectQuery, [projectId, userId], (err, results) => {
      if (err) {
        console.error('Error archiving project:', err);
        return res.status(500).json({ error: 'Error archiving project' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }

      res.status(200).json({ message: 'Project archived successfully' });
    });
  });

  // Find project by name and description
  router.post('/find_project', authenticateToken, (req, res) => {
    const { projectName, projectDescription } = req.body;
    const userId = req.user.id;

    const query = `
      SELECT session_duration, id, status
      FROM user_history
      WHERE project_name = ? AND project_description = ? AND (user_id = ? OR id IN (SELECT project_id FROM project_members WHERE user_id = ?)) AND status <> 'Complete'
    `;

    queryDatabase(query, [projectName, projectDescription, userId, userId], (err, results) => {
      if (err) {
        console.error('Error finding project:', err);
        return res.status(500).json({ error: 'Error finding project' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }

      res.status(200).json({ project: results[0] });
    });
  });

  // Check if project name exists
  router.post('/check_existing_projectname', authenticateToken, (req, res) => {
    const { projectName } = req.body;
    const userId = req.user.id;

    const query = `
      SELECT id
      FROM user_history
      WHERE project_name = ? AND user_id = ?
    `;

    queryDatabase(query, [projectName, userId], (err, results) => {
      if (err) {
        console.error('Error checking project name:', err);
        return res.status(500).json({ error: 'Error checking project name' });
      }

      if (results.length > 0) {
        return res.status(409).json({ exists: true, projectId: results[0].id });
      }

      res.status(200).json({ exists: false });
    });
  });

  // Complete project stage
  router.post('/complete_project/:id', authenticateToken, (req, res) => {
    const projectId = req.params.id;
    const userId = req.user.id;
    const { nextStage, currentStage } = req.body;

    const projectStages = CANONICAL_STAGES;

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

    queryDatabase(getCurrentProjectQuery, [projectId], (err, results) => {
      if (err) {
        console.error('Error fetching project:', err);
        return res.status(500).json({ error: 'Error fetching project' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const project = results[0];

      if (project.owner_id !== userId) {
        return res.status(403).json({ error: 'Only project owner can complete stages' });
      }

      const stageIndex = projectStages.indexOf(currentStage);
      const nextStageIndex = projectStages.indexOf(nextStage);

      if (nextStageIndex === -1) {
        return res.status(400).json({ error: 'Invalid next stage' });
      }

      if (nextStageIndex <= stageIndex) {
        return res.status(400).json({ error: 'Cannot go to previous or same stage' });
      }

      const updateProjectQuery = `
        UPDATE user_history 
        SET stage = ? 
        WHERE id = ?
      `;

      queryDatabase(updateProjectQuery, [nextStage, projectId], (err, updateResults) => {
        if (err) {
          console.error('Error updating project stage:', err);
          return res.status(500).json({ error: 'Error updating project' });
        }

        checkAndUpdateProjectCompletion(projectId, (completionErr) => {
          if (completionErr) {
            console.error('Error checking project completion:', completionErr);
            return res.status(500).json({ error: 'Error completing stage' });
          }

          res.status(200).json({ message: 'Project stage completed successfully' });
        });
      });
    });
  });

  // Get combined project display
  router.get('/user_project_display_combined', authenticateToken, (req, res) => {
    const userId = req.user.id;

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
        u.name as owner_name,
        u.profile_image as owner_image,
        (SELECT COUNT(*) FROM project_members WHERE project_id = uh.id) as member_count
      FROM user_history uh
      LEFT JOIN users u ON uh.user_id = u.id
      WHERE uh.user_id = ? OR uh.id IN (SELECT project_id FROM project_members WHERE user_id = ?)
      ORDER BY uh.created_at DESC
    `;

    queryDatabase(query, [userId, userId], (err, results) => {
      if (err) {
        console.error('Error fetching combined projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  // Get only user's projects
  router.get('/user_projects_only', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
      SELECT id, project_name, project_description, session_duration, carbon_emit, status, stage
      FROM user_history
      WHERE user_id = ?
    `;

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching user projects:', err);
        return res.status(500).json({ error: 'Error fetching projects' });
      }

      res.status(200).json({ projects: results });
    });
  });

  return router;
};
