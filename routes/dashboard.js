const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');

router.get('/', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.redirect('/auth/login');
});

router.get('/dashboard', requireLogin, async (req, res) => {
  const user = req.session.user;
  let stats = {};

  try {
    if (user.role === 'superadmin') {
      const [uc, pc, ac, ts] = await Promise.all([
        pool.query('SELECT COUNT(*)::int as c FROM users'),
        pool.query('SELECT COUNT(*)::int as c FROM participants'),
        pool.query('SELECT COUNT(*)::int as c FROM activities WHERE active=true'),
        pool.query("SELECT COUNT(*)::int as c FROM sessions WHERE session_date=CURRENT_DATE AND status='open'")
      ]);
      stats.users = uc.rows[0].c;
      stats.participants = pc.rows[0].c;
      stats.activities = ac.rows[0].c;
      stats.todaySessions = ts.rows[0].c;

      const rs = await pool.query(`
        SELECT s.*, g.name as group_name, a.name as activity_name, u.full_name as facilitator_name,
          (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id AND present=true) as hadir
        FROM sessions s
        JOIN groups g ON s.group_id=g.id JOIN activities a ON g.activity_id=a.id
        LEFT JOIN users u ON g.facilitator_id=u.id
        ORDER BY s.started_at DESC LIMIT 8
      `);
      stats.recentSessions = rs.rows;

    } else if (user.role === 'coordinator') {
      const ca = await pool.query(`
        SELECT a.* FROM activities a
        JOIN coordinator_activities ca ON a.id=ca.activity_id
        WHERE ca.user_id=$1 AND a.active=true
      `, [user.id]);
      stats.activities = ca.rows;
      const aids = ca.rows.map(a => a.id);

      if (aids.length) {
        const rs = await pool.query(`
          SELECT s.*, g.name as group_name, a.name as activity_name, u.full_name as facilitator_name,
            (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id AND present=true) as hadir
          FROM sessions s
          JOIN groups g ON s.group_id=g.id JOIN activities a ON g.activity_id=a.id
          LEFT JOIN users u ON g.facilitator_id=u.id
          WHERE a.id=ANY($1) ORDER BY s.started_at DESC LIMIT 10
        `, [aids]);
        stats.recentSessions = rs.rows;
        const pc = await pool.query(`
          SELECT COUNT(DISTINCT gp.participant_id)::int as c
          FROM group_participants gp JOIN groups g ON gp.group_id=g.id WHERE g.activity_id=ANY($1)
        `, [aids]);
        stats.participantCount = pc.rows[0].c;
      } else {
        stats.recentSessions = [];
        stats.participantCount = 0;
      }

    } else {
      const mg = await pool.query(`
        SELECT g.*, a.name as activity_name,
          (SELECT COUNT(*)::int FROM group_participants WHERE group_id=g.id) as participant_count
        FROM groups g JOIN activities a ON g.activity_id=a.id
        WHERE g.facilitator_id=$1
      `, [user.id]);
      stats.groups = mg.rows;
      const gids = mg.rows.map(g => g.id);

      if (gids.length) {
        const rs = await pool.query(`
          SELECT s.*, g.name as group_name, a.name as activity_name,
            (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id AND present=true) as hadir,
            (SELECT COUNT(*)::int FROM attendances WHERE session_id=s.id) as total
          FROM sessions s JOIN groups g ON s.group_id=g.id JOIN activities a ON g.activity_id=a.id
          WHERE g.id=ANY($1) ORDER BY s.started_at DESC LIMIT 8
        `, [gids]);
        stats.recentSessions = rs.rows;
      } else {
        stats.recentSessions = [];
      }
    }

    res.render('dashboard', { title: 'Dashboard', stats });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat dashboard');
    res.render('dashboard', { title: 'Dashboard', stats: {} });
  }
});

module.exports = router;
