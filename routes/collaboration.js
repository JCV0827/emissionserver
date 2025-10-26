const express = require('express');
const router = express.Router();
const nodemailer = require('nodemailer');

module.exports = (queryDatabase, authenticateToken, authenticateAdmin) => {
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS,
    },
  });

  // Send project invitation
  router.post('/send-invitation', authenticateToken, (req, res) => {
    const { project_id, invitee_email, role } = req.body;
    const inviterId = req.user.id;

    // Check if invitee exists
    const checkUserQuery = 'SELECT id FROM users WHERE email = ?';
    queryDatabase(checkUserQuery, [invitee_email], (err, results) => {
      if (err) {
        console.error('Error checking invitee:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      const inviteeId = results[0].id;

      // Create invitation notification
      const insertNotificationQuery = `
        INSERT INTO notifications (project_id, type, related_user_id, invitee_id, role, is_read)
        VALUES (?, 'invitation', ?, ?, ?, false)
      `;

      queryDatabase(insertNotificationQuery, [project_id, inviterId, inviteeId, role], (notifErr, notifResults) => {
        if (notifErr) {
          console.error('Error creating notification:', notifErr);
          return res.status(500).json({ error: 'Error creating invitation' });
        }

        // Send email notification
        const mailOptions = {
          from: process.env.EMAIL_USER,
          to: invitee_email,
          subject: 'Project Invitation',
          html: `<p>You have been invited to join a project. Check your dashboard for details.</p>`,
        };

        transporter.sendMail(mailOptions, (mailErr) => {
          if (mailErr) {
            console.error('Error sending email:', mailErr);
          }

          res.status(201).json({ message: 'Invitation sent successfully' });
        });
      });
    });
  });

  // Get notifications
  router.get('/notifications', authenticateToken, (req, res) => {
    const userId = req.user.id;

    const query = `
      SELECT * FROM notifications 
      WHERE invitee_id = ?
      ORDER BY created_at DESC
    `;

    queryDatabase(query, [userId], (err, results) => {
      if (err) {
        console.error('Error fetching notifications:', err);
        return res.status(500).json({ error: 'Error fetching notifications' });
      }

      res.status(200).json({ notifications: results });
    });
  });

  // Mark notification as read
  router.put('/notifications/:id/read', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const query = 'UPDATE notifications SET is_read = true WHERE id = ? AND invitee_id = ?';

    queryDatabase(query, [id, userId], (err, results) => {
      if (err) {
        console.error('Error marking notification as read:', err);
        return res.status(500).json({ error: 'Error updating notification' });
      }

      res.status(200).json({ message: 'Notification marked as read' });
    });
  });

  // Respond to project invitation
  router.put('/invitations/:id/respond', authenticateToken, (req, res) => {
    const { id } = req.params;
    const { response } = req.body;
    const userId = req.user.id;

    if (response !== 'accepted' && response !== 'rejected') {
      return res.status(400).json({ error: 'Invalid response' });
    }

    const getNotificationQuery = 'SELECT project_id, role FROM notifications WHERE id = ? AND invitee_id = ?';

    queryDatabase(getNotificationQuery, [id, userId], (err, results) => {
      if (err) {
        console.error('Error fetching notification:', err);
        return res.status(500).json({ error: 'Database error' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'Invitation not found' });
      }

      const { project_id, role } = results[0];

      if (response === 'accepted') {
        const addMemberQuery = `
          INSERT INTO project_members (project_id, user_id, role, progress_status)
          VALUES (?, ?, ?, 'In Progress')
        `;

        queryDatabase(addMemberQuery, [project_id, userId, role], (memberErr) => {
          if (memberErr) {
            console.error('Error adding project member:', memberErr);
            return res.status(500).json({ error: 'Error accepting invitation' });
          }

          const updateNotificationQuery = 'UPDATE notifications SET is_read = true WHERE id = ?';
          queryDatabase(updateNotificationQuery, [id], (updateErr) => {
            if (updateErr) {
              console.error('Error updating notification:', updateErr);
              return res.status(500).json({ error: 'Error updating notification' });
            }

            res.status(200).json({ message: 'Invitation accepted' });
          });
        });
      } else {
        const deleteNotificationQuery = 'DELETE FROM notifications WHERE id = ?';
        queryDatabase(deleteNotificationQuery, [id], (deleteErr) => {
          if (deleteErr) {
            console.error('Error deleting notification:', deleteErr);
            return res.status(500).json({ error: 'Error rejecting invitation' });
          }

          res.status(200).json({ message: 'Invitation rejected' });
        });
      }
    });
  });

  // Get project members
  router.get('/project/:id/members', authenticateToken, (req, res) => {
    const { id } = req.params;
    const userId = req.user.id;

    const accessQuery = `
      SELECT uh.id FROM user_history uh
      LEFT JOIN project_members pm ON pm.project_id = uh.id AND pm.user_id = ?
      WHERE uh.id = ? AND (uh.user_id = ? OR pm.user_id IS NOT NULL)
    `;

    queryDatabase(accessQuery, [userId, id, userId], (accessErr, accessResults) => {
      if (accessErr) {
        console.error('Error checking access:', accessErr);
        return res.status(500).json({ error: 'Error checking access' });
      }

      if (accessResults.length === 0) {
        return res.status(403).json({ error: 'No access to this project' });
      }

      const query = `
        SELECT pm.id, pm.user_id, pm.role, pm.progress_status, u.name, u.email
        FROM project_members pm
        JOIN users u ON pm.user_id = u.id
        WHERE pm.project_id = ?
      `;

      queryDatabase(query, [id], (err, results) => {
        if (err) {
          console.error('Error fetching members:', err);
          return res.status(500).json({ error: 'Error fetching members' });
        }

        res.status(200).json({ members: results });
      });
    });
  });

  // Remove project member
  router.delete('/remove_project_member', authenticateAdmin, (req, res) => {
    const { project_id, user_id } = req.body;

    const query = 'DELETE FROM project_members WHERE project_id = ? AND user_id = ?';

    queryDatabase(query, [project_id, user_id], (err, results) => {
      if (err) {
        console.error('Error removing member:', err);
        return res.status(500).json({ error: 'Error removing member' });
      }

      res.status(200).json({ message: 'Member removed successfully' });
    });
  });

  // Validate user email
  router.get('/validate_user_email/:email', authenticateToken, (req, res) => {
    const { email } = req.params;

    const query = 'SELECT id, name FROM users WHERE email = ?';

    queryDatabase(query, [email], (err, results) => {
      if (err) {
        console.error('Error validating email:', err);
        return res.status(500).json({ error: 'Error validating email' });
      }

      if (results.length === 0) {
        return res.status(404).json({ error: 'User not found' });
      }

      res.status(200).json({ user: results[0] });
    });
  });

  return router;
};
