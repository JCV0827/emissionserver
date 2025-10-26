const express = require('express');

module.exports = function createProjectRequestRoutes(queryDatabase, authenticateToken, authenticateAdmin, executeTransaction) {
  const router = express.Router();

  // Endpoint to fetch project members
  router.get('/project/:id/members/details', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // First check if user is a member of this project
    queryDatabase(
      `SELECT pm.user_id, pm.stage FROM project_members pm 
       WHERE pm.project_id = ? AND pm.user_id = ?`,
      [id, userId],
      (err, results) => {
        if (err) {
          console.error('Error checking project membership:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
          return res.status(403).json({ error: 'Not a member of this project' });
        }

        // Fetch all members of this project
        queryDatabase(
          `SELECT pm.user_id, pm.stage, pm.joined_date, u.name, u.email, u.organization 
           FROM project_members pm
           LEFT JOIN users u ON pm.user_id = u.id
           WHERE pm.project_id = ?
           ORDER BY pm.joined_date ASC`,
          [id],
          (err, members) => {
            if (err) {
              console.error('Error fetching project members:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            // Fetch base project info
            queryDatabase(
              `SELECT id, name, description, owner_id FROM projects WHERE id = ?`,
              [id],
              (err, projectData) => {
                if (err) {
                  console.error('Error fetching project info:', err);
                  return res.status(500).json({ error: 'Database error' });
                }

                if (projectData.length === 0) {
                  return res.status(404).json({ error: 'Project not found' });
                }

                const project = projectData[0];
                const isOwner = project.owner_id === userId;

                res.json({
                  project: {
                    id: project.id,
                    name: project.name,
                    description: project.description,
                    owner_id: project.owner_id,
                    isOwner
                  },
                  members
                });
              }
            );
          }
        );
      }
    );
  });

  // Endpoint to request to join a project (by code or direct request)
  router.post('/request-join-project', authenticateToken, (req, res) => {
    const { projectId, projectCode } = req.body;
    const userId = req.user.id;

    if (!projectId && !projectCode) {
      return res.status(400).json({ error: 'Project ID or code required' });
    }

    // First validate the project exists
    const query = projectId
      ? 'SELECT id, owner_id FROM projects WHERE id = ?'
      : 'SELECT id, owner_id FROM projects WHERE project_code = ?';
    
    const params = projectId ? [projectId] : [projectCode];

    queryDatabase(query, params, (err, results) => {
      if (err) {
        console.error('Error validating project:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Project not found' });
      }

      const project = results[0];
      const projectId_actual = project.id;

      // Check if user is already a member
      queryDatabase(
        'SELECT id FROM project_members WHERE project_id = ? AND user_id = ?',
        [projectId_actual, userId],
        (err, memberResults) => {
          if (err) {
            console.error('Error checking membership:', err);
            return res.status(500).json({ error: 'Database error' });
          }

          if (memberResults.length > 0) {
            return res.status(400).json({ error: 'User is already a member of this project' });
          }

          // Check if request already exists
          queryDatabase(
            'SELECT id FROM project_join_requests WHERE project_id = ? AND user_id = ? AND status = "pending"',
            [projectId_actual, userId],
            (err, requestResults) => {
              if (err) {
                console.error('Error checking existing request:', err);
                return res.status(500).json({ error: 'Database error' });
              }

              if (requestResults.length > 0) {
                return res.status(400).json({ error: 'Request already pending' });
              }

              // Create join request
              queryDatabase(
                'INSERT INTO project_join_requests (project_id, user_id, status, requested_date) VALUES (?, ?, "pending", NOW())',
                [projectId_actual, userId],
                (err) => {
                  if (err) {
                    console.error('Error creating join request:', err);
                    return res.status(500).json({ error: 'Failed to create join request' });
                  }

                  res.status(201).json({ message: 'Join request submitted successfully' });
                }
              );
            }
          );
        }
      );
    });
  });

  // Endpoint to fetch pending join requests for a project (owner only)
  router.get('/project/:id/join-requests', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    // Check if user is the owner
    queryDatabase(
      'SELECT owner_id FROM projects WHERE id = ?',
      [id],
      (err, results) => {
        if (err) {
          console.error('Error checking project ownership:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }

        if (results[0].owner_id !== userId) {
          return res.status(403).json({ error: 'Only project owner can view join requests' });
        }

        // Fetch pending requests
        queryDatabase(
          `SELECT pjr.id, pjr.user_id, pjr.requested_date, u.name, u.email 
           FROM project_join_requests pjr
           LEFT JOIN users u ON pjr.user_id = u.id
           WHERE pjr.project_id = ? AND pjr.status = "pending"
           ORDER BY pjr.requested_date ASC`,
          [id],
          (err, requests) => {
            if (err) {
              console.error('Error fetching join requests:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            res.json({ requests });
          }
        );
      }
    );
  });

  // Endpoint to respond to join request (owner only)
  router.put('/project/:id/join-requests/:requestId/respond', authenticateToken, (req, res) => {
    const { id, requestId } = req.params;
    const { action } = req.body; // 'approve' or 'reject'
    const userId = req.user.id;

    if (!['approve', 'reject'].includes(action)) {
      return res.status(400).json({ error: 'Invalid action. Use "approve" or "reject"' });
    }

    // Check if user is the owner
    queryDatabase(
      'SELECT owner_id FROM projects WHERE id = ?',
      [id],
      (err, results) => {
        if (err) {
          console.error('Error checking project ownership:', err);
          return res.status(500).json({ error: 'Database error' });
        }

        if (results.length === 0) {
          return res.status(404).json({ error: 'Project not found' });
        }

        if (results[0].owner_id !== userId) {
          return res.status(403).json({ error: 'Only project owner can respond to join requests' });
        }

        // Get the request details
        queryDatabase(
          'SELECT user_id FROM project_join_requests WHERE id = ? AND project_id = ?',
          [requestId, id],
          (err, requestResults) => {
            if (err) {
              console.error('Error fetching join request:', err);
              return res.status(500).json({ error: 'Database error' });
            }

            if (requestResults.length === 0) {
              return res.status(404).json({ error: 'Join request not found' });
            }

            const requestUserId = requestResults[0].user_id;

            if (action === 'approve') {
              // Add user to project_members
              executeTransaction((connection) => {
                // First add to project_members
                connection.query(
                  'INSERT INTO project_members (project_id, user_id, stage, joined_date) VALUES (?, ?, ?, NOW())',
                  [id, requestUserId, 'Design: Creating the software architecture'],
                  (err) => {
                    if (err) {
                      return connection.rollback(() => {
                        console.error('Error adding project member:', err);
                        res.status(500).json({ error: 'Failed to approve join request' });
                      });
                    }

                    // Update request status
                    connection.query(
                      'UPDATE project_join_requests SET status = "approved" WHERE id = ?',
                      [requestId],
                      (err) => {
                        if (err) {
                          return connection.rollback(() => {
                            console.error('Error updating request status:', err);
                            res.status(500).json({ error: 'Failed to approve join request' });
                          });
                        }

                        connection.commit((err) => {
                          if (err) {
                            return connection.rollback(() => {
                              console.error('Error committing transaction:', err);
                              res.status(500).json({ error: 'Failed to approve join request' });
                            });
                          }

                          res.json({ message: 'Join request approved successfully' });
                        });
                      }
                    );
                  }
                );
              });
            } else {
              // Reject: just update status
              queryDatabase(
                'UPDATE project_join_requests SET status = "rejected" WHERE id = ?',
                [requestId],
                (err) => {
                  if (err) {
                    console.error('Error rejecting join request:', err);
                    return res.status(500).json({ error: 'Failed to reject join request' });
                  }

                  res.json({ message: 'Join request rejected successfully' });
                }
              );
            }
          }
        );
      }
    );
  });

  return router;
};
