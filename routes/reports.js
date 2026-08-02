const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Reports dashboard
router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    let activitiesQuery, activitiesParams = [];

    if (user.role === 'superadmin') {
      activitiesQuery = 'SELECT id, name FROM activities ORDER BY name';
    } else if (user.role === 'coordinator') {
      activitiesQuery = `
        SELECT a.id, a.name 
        FROM activities a
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY a.name
      `;
      activitiesParams = [user.id];
    } else {
      activitiesQuery = `
        SELECT DISTINCT a.id, a.name
        FROM activities a
        JOIN groups g ON a.id = g.activity_id
        WHERE g.facilitator_id = $1
        ORDER BY a.name
      `;
      activitiesParams = [user.id];
    }

    const { rows: activities } = await pool.query(activitiesQuery, activitiesParams);
    res.render('reports/index', { title: 'Laporan Absensi', activities });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat halaman laporan');
    res.redirect('/dashboard');
  }
});

// Activity Report
router.get('/activity', async (req, res) => {
    try {
        const { activity_id, start_date, end_date } = req.query;
        if (!activity_id) return res.redirect('/reports');

        const user = req.session.user;

        // Security check (simplified for now, ideally check if user has access to this activity)

        let query = `
            SELECT 
                g.name as group_name,
                p.full_name as participant_name,
                COUNT(s.id) as total_sessions,
                SUM(CASE WHEN a.present = true THEN 1 ELSE 0 END) as present_count,
                ROUND((SUM(CASE WHEN a.present = true THEN 1 ELSE 0 END)::numeric / NULLIF(COUNT(s.id), 0)) * 100, 2) as attendance_percentage
            FROM groups g
            JOIN group_participants gp ON g.id = gp.group_id
            JOIN participants p ON gp.participant_id = p.id
            LEFT JOIN sessions s ON g.id = s.group_id
            LEFT JOIN attendances a ON s.id = a.session_id AND p.id = a.participant_id
            WHERE g.activity_id = $1
        `;
        let params = [activity_id];

        if (start_date && end_date) {
            query += ` AND s.session_date BETWEEN $2 AND $3`;
            params.push(start_date, end_date);
        }

        query += ` GROUP BY g.id, p.id ORDER BY g.name, p.full_name`;

        const { rows: reportData } = await pool.query(query, params);
        const { rows: activity } = await pool.query('SELECT name FROM activities WHERE id = $1', [activity_id]);

        res.render('reports/activity', { 
            title: `Laporan Kegiatan - ${activity[0]?.name}`, 
            reportData, 
            activity: activity[0],
            filters: { activity_id, start_date, end_date }
        });

    } catch (e) {
        console.error(e);
        req.flash('error', 'Gagal memuat laporan');
        res.redirect('/reports');
    }
});

module.exports = router;
