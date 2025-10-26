const express = require('express');
const router = express.Router();

const CANONICAL_STAGES = [
  'Design: Creating the software architecture',
  'Development: Writing the actual code',
  'Testing: Ensuring the software works as expected'
];

module.exports = (queryDatabase, authenticateAdmin, authenticateToken) => {
  // Create project with members (admin only)
  router.post('/admin/create_project', authenticateAdmin, (req, res) => {
    const {
      project_name,
      project_description,
      organization,
      project_leader_email,
      team_members_emails,
      stage,
      stage_duration,
      stage_start_date,
      stage_due_date,
      project_start_date,
      project_due_date
    } = req.body;

    // Get project leader ID
    const getLeaderQuery = 'SELECT id FROM users WHERE email = ?';
    queryDatabase(getLeaderQuery, [project_leader_email], (err, results) => {
      if (err) {
        console.error('Error fetching project leader:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Project leader not found' });
      }

      const leaderId = results[0].id;

      // Create project
      const createProjectQuery = `
        INSERT INTO user_history (
          user_id, organization, project_name, project_description,
          stage, stage_duration, stage_start_date, stage_due_date,
          project_start_date, project_due_date, status, session_duration, carbon_emit
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, 0)
      `;

      queryDatabase(createProjectQuery, [
        leaderId, organization, project_name, project_description,
        stage || CANONICAL_STAGES[0], stage_duration || 14,
        stage_start_date, stage_due_date, project_start_date, project_due_date
      ], (createErr, createResults) => {
        if (createErr) {
          console.error('Error creating project:', createErr);
          return res.status(500).json({ error: 'Error creating project' });
        }

        const projectId = createResults.insertId;

        // Update project_id to be same as id
        const updateProjectIdQuery = 'UPDATE user_history SET project_id = ? WHERE id = ?';
        queryDatabase(updateProjectIdQuery, [projectId, projectId], (updateErr) => {
          if (updateErr) {
            console.error('Error updating project ID:', updateErr);
            return res.status(500).json({ error: 'Error updating project' });
          }

          // Add project leader as owner
          const addLeaderQuery = `
            INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
            VALUES (?, ?, 'project_leader', ?, 'In Progress')
          `;

          queryDatabase(addLeaderQuery, [projectId, leaderId, stage || CANONICAL_STAGES[0]], (leaderErr) => {
            if (leaderErr) {
              console.error('Error adding project leader:', leaderErr);
              return res.status(500).json({ error: 'Error adding project leader' });
            }

            if (!team_members_emails || team_members_emails.length === 0) {
              return res.status(201).json({ message: 'Project created successfully', projectId });
            }

            // Add team members
            let addedCount = 0;
            let errorCount = 0;

            team_members_emails.forEach((email) => {
              const getMemberQuery = 'SELECT id FROM users WHERE email = ?';
              queryDatabase(getMemberQuery, [email], (memberErr, memberResults) => {
                if (memberErr) {
                  console.error('Error fetching member:', memberErr);
                  errorCount++;
                  return;
                }

                if (memberResults.length === 0) {
                  errorCount++;
                  return;
                }

                const memberId = memberResults[0].id;
                const addMemberQuery = `
                  INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
                  VALUES (?, ?, 'team_member', ?, 'In Progress')
                `;

                queryDatabase(addMemberQuery, [projectId, memberId, stage || CANONICAL_STAGES[0]], (addErr) => {
                  if (addErr) {
                    console.error('Error adding member:', addErr);
                    errorCount++;
                  } else {
                    addedCount++;
                  }

                  if (addedCount + errorCount === team_members_emails.length) {
                    res.status(201).json({
                      message: 'Project created successfully',
                      projectId,
                      membersAdded: addedCount,
                      membersFailed: errorCount
                    });
                  }
                });
              });
            });
          });
        });
      });
    });
  });

  // Delete project (admin only)
  router.delete('/admin/delete_project/:id', authenticateAdmin, (req, res) => {
    const projectId = req.params.id;

    // Delete related notifications
    const deleteNotificationsQuery = 'DELETE FROM notifications WHERE project_id = ?';

    queryDatabase(deleteNotificationsQuery, [projectId], (err) => {
      if (err) {
        console.error('Error deleting notifications:', err);
        return res.status(500).json({ error: 'Error deleting project' });
      }

      // Delete project members
      const deleteMembersQuery = 'DELETE FROM project_members WHERE project_id = ?';

      queryDatabase(deleteMembersQuery, [projectId], (err) => {
        if (err) {
          console.error('Error deleting members:', err);
          return res.status(500).json({ error: 'Error deleting project' });
        }

        // Delete project
        const deleteProjectQuery = 'DELETE FROM user_history WHERE id = ?';

        queryDatabase(deleteProjectQuery, [projectId], (err, results) => {
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
  });

  // Update project (admin only)
  router.put('/admin/update_project/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { project_name, project_description, stage, stage_duration, stage_start_date, stage_due_date, project_due_date } = req.body;

    const query = `
      UPDATE user_history
      SET project_name = ?, project_description = ?, stage = ?, 
          stage_duration = ?, stage_start_date = ?, stage_due_date = ?, project_due_date = ?
      WHERE id = ?
    `;

    queryDatabase(query, [
      project_name, project_description, stage,
      stage_duration, stage_start_date, stage_due_date, project_due_date, id
    ], (err, results) => {
      if (err) {
        console.error('Error updating project:', err);
        return res.status(500).json({ error: 'Error updating project' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }

      res.status(200).json({ message: 'Project updated successfully' });
    });
  });

  // Add project member (admin only)
  router.post('/add_project_member', authenticateAdmin, async (req, res) => {
    const { project_id, user_email, role } = req.body;

    try {
      // Get user ID from email
      const userQuery = 'SELECT id FROM users WHERE email = ?';
      const userId = await new Promise((resolve, reject) => {
        queryDatabase(userQuery, [user_email], (err, results) => {
          if (err) reject(err);
          if (results.length === 0) reject(new Error('User not found'));
          resolve(results[0].id);
        });
      });

      // Check if already a member
      const checkMemberQuery = 'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?';
      const existingMember = await new Promise((resolve, reject) => {
        queryDatabase(checkMemberQuery, [project_id, userId], (err, results) => {
          if (err) reject(err);
          resolve(results[0]);
        });
      });

      if (existingMember) {
        return res.status(409).json({ error: 'User is already a member of this project' });
      }

      // Get current stage from project
      const getStageQuery = 'SELECT stage FROM user_history WHERE id = ?';
      const currentStage = await new Promise((resolve, reject) => {
        queryDatabase(getStageQuery, [project_id], (err, results) => {
          if (err) reject(err);
          if (results.length === 0) reject(new Error('Project not found'));
          resolve(results[0].stage);
        });
      });

      // Add member
      const addMemberQuery = `
        INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
        VALUES (?, ?, ?, ?, 'In Progress')
      `;

      queryDatabase(addMemberQuery, [project_id, userId, role, currentStage], (err, results) => {
        if (err) {
          console.error('Error adding project member:', err);
          return res.status(500).json({ error: 'Error adding member' });
        }

        res.status(201).json({ message: 'Member added successfully' });
      });
    } catch (error) {
      console.error('Error adding project member:', error);
      res.status(500).json({ error: error.message });
    }
  });

  // Submit project request (user)
  router.post('/project-requests', authenticateToken, (req, res) => {
    const userId = req.user.id;
    const { title, description, project_stage, stage_duration, stage_start_date, stage_due_date, project_start_date, project_due_date } = req.body;

    if (!title || !description) {
      return res.status(400).json({ error: 'Title and description are required' });
    }

    const query = `
      INSERT INTO project_requests (
        user_id, title, description, project_stage, stage_duration,
        stage_start_date, stage_due_date, project_start_date, project_due_date, status
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')
    `;

    queryDatabase(query, [
      userId, title, description, project_stage || CANONICAL_STAGES[0],
      stage_duration || 14, stage_start_date, stage_due_date, project_start_date, project_due_date
    ], (err, results) => {
      if (err) {
        console.error('Error creating project request:', err);
        return res.status(500).json({ error: 'Error creating request' });
      }

      res.status(201).json({ message: 'Project request submitted successfully', requestId: results.insertId });
    });
  });

  // Get all project requests (admin)
  router.get('/admin/project-requests', authenticateAdmin, (req, res) => {
    const query = `
      SELECT pr.*, u.name as user_name, u.email as user_email
      FROM project_requests pr
      JOIN users u ON pr.user_id = u.id
      WHERE pr.status = 'pending'
      ORDER BY pr.created_at DESC
    `;

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching project requests:', err);
        return res.status(500).json({ error: 'Error fetching requests' });
      }

      res.status(200).json({ requests: results });
    });
  });

  // Get user's project requests
  router.get('/user/project-requests', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = 'SELECT * FROM project_requests WHERE user_id = ? ORDER BY created_at DESC';

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching user requests:', err);
        return res.status(500).json({ error: 'Error fetching requests' });
      }

      res.status(200).json({ requests: results });
    });
  });

  // Approve project request (admin)
  router.put('/admin/project-requests/:id/approve', authenticateAdmin, (req, res) => {
    const requestId = req.params.id;
    const reviewerId = req.user.id;
    const { review_notes } = req.body;

    // Update request status
    const updateQuery = `
      UPDATE project_requests
      SET status = 'approved', reviewer_id = ?, review_notes = ?
      WHERE id = ?
    `;

    queryDatabase(updateQuery, [reviewerId, review_notes, requestId], (err, results) => {
      if (err) {
        console.error('Error updating request:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Request not found' });
      }

      // Get request details
      const getRequestQuery = 'SELECT * FROM project_requests WHERE id = ?';

      queryDatabase(getRequestQuery, [requestId], (err, requests) => {
        if (err) {
          console.error('Error fetching request:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (requests.length === 0) {
          return res.status(404).json({ error: 'Request not found' });
        }

        const request = requests[0];

        // Get leader's organization
        const getLeaderOrgQuery = 'SELECT organization FROM users WHERE id = ?';
        queryDatabase(getLeaderOrgQuery, [request.user_id], (orgErr, orgResults) => {
          if (orgErr) {
            console.error('Error fetching leader organization:', orgErr);
            return res.status(500).json({ error: 'Database error' });
          }

          const leaderOrganization = (orgResults && orgResults.length > 0 && orgResults[0].organization)
            ? orgResults[0].organization
            : 'External';

          // Create project
          const createProjectQuery = `
            INSERT INTO user_history (
              user_id, project_name, project_description, stage,
              organization, stage_duration, stage_start_date, stage_due_date,
              project_start_date, project_due_date, status, session_duration, carbon_emit
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'In Progress', 0, 0)
          `;

          queryDatabase(createProjectQuery, [
            request.user_id, request.title, request.description, request.project_stage,
            leaderOrganization, request.stage_duration, request.stage_start_date,
            request.stage_due_date, request.project_start_date, request.project_due_date
          ], (err, projectResult) => {
            if (err) {
              console.error('Error creating project:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            const projectId = projectResult.insertId;

            // Update project_id
            const updateProjectIdQuery = 'UPDATE user_history SET project_id = ? WHERE id = ?';
            queryDatabase(updateProjectIdQuery, [projectId, projectId], (err) => {
              if (err) {
                console.error('Error updating project ID:', err);
                return res.status(500).json({ error: 'Failed to update project ID' });
              }

              // Add project owner
              const addOwnerQuery = `
                INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
                VALUES (?, ?, 'project_owner', ?, 'In Progress')
              `;

              queryDatabase(addOwnerQuery, [projectId, request.user_id, request.project_stage], (err) => {
                if (err) {
                  console.error('Error adding project owner:', err);
                  return res.status(500).json({ error: 'Failed to add project owner' });
                }

                // Add as project leader
                const addLeaderQuery = `
                  INSERT INTO project_members (project_id, user_id, role, current_stage, progress_status)
                  VALUES (?, ?, 'project_leader', ?, 'In Progress')
                `;

                queryDatabase(addLeaderQuery, [projectId, request.user_id, request.project_stage], (err) => {
                  if (err) {
                    console.error('Error adding project leader:', err);
                    return res.status(500).json({ error: 'Failed to add project leader' });
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

  // Reject project request
  router.put('/admin/project-requests/:id/reject', authenticateAdmin, (req, res) => {
    const requestId = req.params.id;
    const reviewerId = req.user.id;
    const { review_notes } = req.body;

    const query = `
      UPDATE project_requests
      SET status = 'rejected', reviewer_id = ?, review_notes = ?
      WHERE id = ?
    `;

    queryDatabase(query, [reviewerId, review_notes, requestId], (err, results) => {
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

  // Initialize timeline dates for existing records (admin)
  router.post('/initialize_timeline_dates', authenticateAdmin, (req, res) => {
    const now = new Date().toISOString().split('T')[0];

    const query = `
      UPDATE user_history
      SET
        stage_start_date = COALESCE(stage_start_date, ?),
        stage_duration = COALESCE(stage_duration, 14),
        stage_due_date = COALESCE(stage_due_date, DATE_ADD(COALESCE(stage_start_date, ?), INTERVAL 14 DAY)),
        project_start_date = COALESCE(project_start_date, ?),
        project_due_date = COALESCE(project_due_date, DATE_ADD(COALESCE(stage_start_date, ?), INTERVAL 42 DAY))
      WHERE stage_start_date IS NULL OR stage_due_date IS NULL
    `;

    queryDatabase(query, [now, now, now, now], (err, results) => {
      if (err) {
        console.error('Error initializing timeline dates:', err);
        return res.status(500).json({ error: 'Error initializing dates' });
      }

      res.status(200).json({ message: 'Timeline dates initialized', updated: results.affectedRows });
    });
  });

  // Device maintenance endpoints
  router.get('/admin/device-maintenance', authenticateAdmin, (req, res) => {
    const query = 'SELECT * FROM devices';

    queryDatabase(query, (err, results) => {
      if (err) {
        console.error('Error fetching devices:', err);
        return res.status(500).json({ error: 'Error fetching devices' });
      }

      res.status(200).json({ devices: results });
    });
  });

  router.get('/admin/device-maintenance/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'SELECT * FROM devices WHERE id = ?';

    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error fetching device:', err);
        return res.status(500).json({ error: 'Error fetching device' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      res.status(200).json({ device: results[0] });
    });
  });

  router.put('/admin/device-maintenance/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;
    const { device_type, cpu, gpu, ram, psu, storage, screen_size, model } = req.body;

    const query = 'UPDATE devices SET device_type = ?, cpu = ?, gpu = ?, ram = ?, psu = ?, storage = ?, screen_size = ?, model = ? WHERE id = ?';

    queryDatabase(query, [device_type, cpu, gpu, ram, psu, storage, screen_size, model, id], (err, results) => {
      if (err) {
        console.error('Error updating device:', err);
        return res.status(500).json({ error: 'Error updating device' });
      }

      res.status(200).json({ message: 'Device updated successfully' });
    });
  });

  router.delete('/admin/device-maintenance/:id', authenticateAdmin, (req, res) => {
    const { id } = req.params;

    const query = 'DELETE FROM devices WHERE id = ?';

    queryDatabase(query, [id], (err, results) => {
      if (err) {
        console.error('Error deleting device:', err);
        return res.status(500).json({ error: 'Error deleting device' });
      }

      if (results.affectedRows === 0) {
        return res.status(404).json({ error: 'Device not found' });
      }

      res.status(200).json({ message: 'Device deleted successfully' });
    });
  });

  return router;
};
