const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');
const whatsapp = require('../services/whatsapp');

router.use(requireLogin);

// List sessions
router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    let query, params = [];

    if (user.role === 'superadmin') {
      query = `
        SELECT s.*, g.name as group_name, a.name as activity_name, u.full_name as facilitator_name,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id AND present=true) as hadir,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id) as total
        FROM sessions s
        JOIN groups g ON s.group_id=g.id
        JOIN activities a ON g.activity_id=a.id
        LEFT JOIN users u ON g.facilitator_id=u.id
        ORDER BY s.session_date DESC, s.started_at DESC
      `;
    } else if (user.role === 'coordinator') {
      query = `
        SELECT s.*, g.name as group_name, a.name as activity_name, u.full_name as facilitator_name,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id AND present=true) as hadir,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id) as total
        FROM sessions s
        JOIN groups g ON s.group_id=g.id
        JOIN activities a ON g.activity_id=a.id
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        LEFT JOIN users u ON g.facilitator_id=u.id
        WHERE ca.user_id = $1
        ORDER BY s.session_date DESC, s.started_at DESC
      `;
      params = [user.id];
    } else {
      query = `
        SELECT s.*, g.name as group_name, a.name as activity_name,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id AND present=true) as hadir,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id) as total
        FROM sessions s
        JOIN groups g ON s.group_id=g.id
        JOIN activities a ON g.activity_id=a.id
        WHERE g.facilitator_id = $1
        ORDER BY s.session_date DESC, s.started_at DESC
      `;
      params = [user.id];
    }

    const { rows } = await pool.query(query, params);
    res.render('sessions/index', { title: 'Daftar Sesi', sessions: rows });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data sesi');
    res.redirect('/dashboard');
  }
});

// Create session form
router.get('/create', async (req, res) => {
  try {
    const user = req.session.user;
    let query, params = [];

    if (user.role === 'superadmin') {
      query = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        ORDER BY a.name, g.name
      `;
    } else if (user.role === 'coordinator') {
      query = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY a.name, g.name
      `;
      params = [user.id];
    } else {
      query = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        WHERE g.facilitator_id = $1
        ORDER BY a.name, g.name
      `;
      params = [user.id];
    }

    const { rows: groups } = await pool.query(query, params);
    res.render('sessions/form', { title: 'Buka Sesi Baru', groups });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat form');
    res.redirect('/sessions');
  }
});

// Create session
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { group_id, session_date, notes } = req.body;

    const r = await client.query(`
      INSERT INTO sessions (group_id, session_date, notes)
      VALUES ($1, $2, $3) RETURNING id
    `, [group_id, session_date || new Date(), notes || null]);

    const sessionId = r.rows[0].id;

    // Pre-populate attendances for all participants in the group
    await client.query(`
      INSERT INTO attendances (session_id, participant_id)
      SELECT $1, participant_id FROM group_participants WHERE group_id = $2
    `, [sessionId, group_id]);

    await client.query('COMMIT');
    req.flash('success', 'Sesi berhasil dibuka');
    res.redirect(`/sessions/${sessionId}/attendance`);
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    req.flash('error', 'Gagal membuka sesi');
    res.redirect('/sessions/create');
  } finally {
    client.release();
  }
});

// Attendance page
router.get('/:id/attendance', async (req, res) => {
  try {
    const { rows: sessions } = await pool.query(`
      SELECT s.*, g.name as group_name, g.facilitator_id, a.name as activity_name 
      FROM sessions s
      JOIN groups g ON s.group_id = g.id
      JOIN activities a ON g.activity_id = a.id
      WHERE s.id = $1
    `, [req.params.id]);

    if (!sessions.length) {
      req.flash('error', 'Sesi tidak ditemukan');
      return res.redirect('/sessions');
    }

    const session = sessions[0];
    const user = req.session.user;

    // Check access
    if (user.role === 'facilitator' && session.facilitator_id !== user.id) {
      req.flash('error', 'Akses ditolak');
      return res.redirect('/sessions');
    }

    const { rows: attendances } = await pool.query(`
      SELECT a.id, a.present, a.wa_sent, p.id as participant_id, p.full_name, p.nickname
      FROM attendances a
      JOIN participants p ON a.participant_id = p.id
      WHERE a.session_id = $1
      ORDER BY p.full_name
    `, [req.params.id]);

    res.render('sessions/attendance', { title: 'Absensi', session, attendances });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat halaman absensi');
    res.redirect('/sessions');
  }
});

// Mark attendance (AJAX)
router.post('/:id/mark', async (req, res) => {
  try {
    const { participant_id, present } = req.body;
    const isPresent = present === 'true' || present === true;
    
    // Get session and participant details
    const { rows: details } = await pool.query(`
      SELECT s.id as session_id, s.status, g.name as group_name, a.name as activity_name, 
             g.facilitator_id, p.*
      FROM sessions s
      JOIN groups g ON s.group_id = g.id
      JOIN activities a ON g.activity_id = a.id
      CROSS JOIN (SELECT * FROM participants WHERE id = $1) p
      WHERE s.id = $2
    `, [participant_id, req.params.id]);

    if (!details.length) {
      return res.status(404).json({ success: false, error: 'Not found' });
    }

    const detail = details[0];
    if (detail.status === 'closed') {
      return res.status(400).json({ success: false, error: 'Session is closed' });
    }

    // Update attendance
    await pool.query(`
      UPDATE attendances SET present = $1, marked_at = NOW()
      WHERE session_id = $2 AND participant_id = $3
    `, [isPresent, req.params.id, participant_id]);

    let waSent = false;
    // Send WA if present and not sent yet
    if (isPresent) {
      const { rows: att } = await pool.query('SELECT wa_sent FROM attendances WHERE session_id=$1 AND participant_id=$2', [req.params.id, participant_id]);
      if (att.length && !att[0].wa_sent) {
        waSent = await whatsapp.sendAttendance(detail.facilitator_id, detail, detail.activity_name, detail.group_name);
        if (waSent) {
          await pool.query('UPDATE attendances SET wa_sent = true WHERE session_id=$1 AND participant_id=$2', [req.params.id, participant_id]);
        }
      } else if (att.length && att[0].wa_sent) {
          waSent = true;
      }
    }

    res.json({ success: true, present: isPresent, wa_sent: waSent });
  } catch (e) {
    console.error(e);
    res.status(500).json({ success: false, error: 'Server error' });
  }
});

// Close session
router.post('/:id/close', async (req, res) => {
  try {
    const { rows: sessions } = await pool.query(`
      SELECT s.*, g.name as group_name, g.facilitator_id, a.name as activity_name 
      FROM sessions s
      JOIN groups g ON s.group_id = g.id
      JOIN activities a ON g.activity_id = a.id
      WHERE s.id = $1
    `, [req.params.id]);

    if (!sessions.length) {
      req.flash('error', 'Sesi tidak ditemukan');
      return res.redirect('/sessions');
    }

    const session = sessions[0];
    
    // Update status
    await pool.query('UPDATE sessions SET status = $1, ended_at = NOW() WHERE id = $2', ['closed', req.params.id]);

    // Send session end notifications to all present participants asynchronously
    const { rows: presentParticipants } = await pool.query(`
      SELECT p.*
      FROM attendances a
      JOIN participants p ON a.participant_id = p.id
      WHERE a.session_id = $1 AND a.present = true
    `, [req.params.id]);

    // Don't await in loop, let it run in background to avoid blocking response
    presentParticipants.forEach(async (p) => {
        try {
            await whatsapp.sendSessionEnd(session.facilitator_id, p, session.activity_name, session.group_name);
        } catch(err) {
            console.error(`Failed to send session end to ${p.full_name}:`, err.message);
        }
    });

    req.flash('success', 'Sesi berhasil ditutup');
    res.redirect(`/sessions/${req.params.id}/attendance`);
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal menutup sesi');
    res.redirect(`/sessions/${req.params.id}/attendance`);
  }
});

// Delete session (Admin/Coordinator)
router.post('/:id/delete', async (req, res) => {
    try {
        await pool.query('DELETE FROM sessions WHERE id=$1', [req.params.id]);
        req.flash('success', 'Sesi berhasil dihapus');
    } catch(e) {
        console.error(e);
        req.flash('error', 'Gagal menghapus sesi');
    }
    res.redirect('/sessions');
});

module.exports = router;
