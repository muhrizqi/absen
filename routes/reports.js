const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// Reports dashboard (with selectors for all 4 report types)
router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    let activitiesQuery, activitiesParams = [];
    let participantsQuery, participantsParams = [];
    let sessionsQuery, sessionsParams = [];
    let facilitatorsQuery, facilitatorsParams = [];

    if (user.role === 'superadmin') {
      activitiesQuery = 'SELECT id, name FROM activities ORDER BY name';

      participantsQuery = 'SELECT id, full_name, nickname FROM participants ORDER BY full_name';

      sessionsQuery = `
        SELECT s.id, s.session_date, g.name as group_name, a.name as activity_name
        FROM sessions s
        JOIN groups g ON s.group_id = g.id
        JOIN activities a ON g.activity_id = a.id
        ORDER BY s.session_date DESC, s.started_at DESC
        LIMIT 300
      `;

      facilitatorsQuery = `SELECT id, full_name FROM users WHERE role = 'facilitator' ORDER BY full_name`;
    } else if (user.role === 'coordinator') {
      activitiesQuery = `
        SELECT a.id, a.name 
        FROM activities a
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY a.name
      `;
      activitiesParams = [user.id];

      participantsQuery = `
        SELECT DISTINCT p.id, p.full_name, p.nickname
        FROM participants p
        JOIN group_participants gp ON p.id = gp.participant_id
        JOIN groups g ON gp.group_id = g.id
        JOIN coordinator_activities ca ON g.activity_id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY p.full_name
      `;
      participantsParams = [user.id];

      sessionsQuery = `
        SELECT s.id, s.session_date, g.name as group_name, a.name as activity_name
        FROM sessions s
        JOIN groups g ON s.group_id = g.id
        JOIN activities a ON g.activity_id = a.id
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY s.session_date DESC, s.started_at DESC
        LIMIT 300
      `;
      sessionsParams = [user.id];

      facilitatorsQuery = `
        SELECT DISTINCT u.id, u.full_name
        FROM users u
        JOIN groups g ON g.facilitator_id = u.id
        JOIN coordinator_activities ca ON g.activity_id = ca.activity_id
        WHERE ca.user_id = $1 AND u.role = 'facilitator'
        ORDER BY u.full_name
      `;
      facilitatorsParams = [user.id];
    } else {
      activitiesQuery = `
        SELECT DISTINCT a.id, a.name
        FROM activities a
        JOIN groups g ON a.id = g.activity_id
        WHERE g.facilitator_id = $1
        ORDER BY a.name
      `;
      activitiesParams = [user.id];

      participantsQuery = `
        SELECT DISTINCT p.id, p.full_name, p.nickname
        FROM participants p
        JOIN group_participants gp ON p.id = gp.participant_id
        JOIN groups g ON gp.group_id = g.id
        WHERE g.facilitator_id = $1
        ORDER BY p.full_name
      `;
      participantsParams = [user.id];

      sessionsQuery = `
        SELECT s.id, s.session_date, g.name as group_name, a.name as activity_name
        FROM sessions s
        JOIN groups g ON s.group_id = g.id
        JOIN activities a ON g.activity_id = a.id
        WHERE g.facilitator_id = $1
        ORDER BY s.session_date DESC, s.started_at DESC
        LIMIT 300
      `;
      sessionsParams = [user.id];

      facilitatorsQuery = `SELECT id, full_name FROM users WHERE id = $1`;
      facilitatorsParams = [user.id];
    }

    const { rows: activities } = await pool.query(activitiesQuery, activitiesParams);
    const { rows: participants } = await pool.query(participantsQuery, participantsParams);
    const { rows: sessionsList } = await pool.query(sessionsQuery, sessionsParams);
    const { rows: facilitators } = await pool.query(facilitatorsQuery, facilitatorsParams);

    res.render('reports/index', {
      title: 'Laporan Absensi',
      activities,
      participants,
      sessionsList,
      facilitators
    });
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

// Participant Report — attendance history for a single participant across all their activities/groups
router.get('/participant', async (req, res) => {
    try {
        const { participant_id, start_date, end_date } = req.query;
        if (!participant_id) return res.redirect('/reports');

        let query = `
            SELECT s.id as session_id, s.session_date, s.status,
                   at.present, at.wa_sent,
                   g.name as group_name, act.name as activity_name
            FROM attendances at
            JOIN sessions s ON at.session_id = s.id
            JOIN groups g ON s.group_id = g.id
            JOIN activities act ON g.activity_id = act.id
            WHERE at.participant_id = $1
        `;
        let params = [participant_id];

        if (start_date && end_date) {
            query += ` AND s.session_date BETWEEN $2 AND $3`;
            params.push(start_date, end_date);
        }

        query += ` ORDER BY s.session_date DESC, s.started_at DESC`;

        const { rows: reportData } = await pool.query(query, params);
        const { rows: participantRows } = await pool.query('SELECT * FROM participants WHERE id = $1', [participant_id]);

        if (!participantRows.length) {
            req.flash('error', 'Peserta tidak ditemukan');
            return res.redirect('/reports');
        }

        const totalSessions = reportData.length;
        const presentCount = reportData.filter(r => r.present).length;
        const percentage = totalSessions > 0 ? Math.round((presentCount / totalSessions) * 10000) / 100 : 0;

        // Monthly trend (perkembangan kehadiran per bulan) for the progress chart
        let trendQuery = `
            SELECT TO_CHAR(s.session_date, 'YYYY-MM') as month,
                   COUNT(*) as total,
                   SUM(CASE WHEN at.present THEN 1 ELSE 0 END) as present_count
            FROM attendances at
            JOIN sessions s ON at.session_id = s.id
            WHERE at.participant_id = $1
        `;
        let trendParams = [participant_id];
        if (start_date && end_date) {
            trendQuery += ` AND s.session_date BETWEEN $2 AND $3`;
            trendParams.push(start_date, end_date);
        }
        trendQuery += ` GROUP BY TO_CHAR(s.session_date, 'YYYY-MM') ORDER BY month`;

        const { rows: trendRows } = await pool.query(trendQuery, trendParams);
        const trend = trendRows.map(r => {
            const total = Number(r.total);
            const present = Number(r.present_count);
            return {
                month: r.month,
                percentage: total > 0 ? Math.round((present / total) * 10000) / 100 : 0
            };
        });

        res.render('reports/participant', {
            title: `Laporan Peserta - ${participantRows[0].full_name}`,
            reportData,
            participant: participantRows[0],
            summary: { totalSessions, presentCount, percentage },
            trend,
            filters: { participant_id, start_date, end_date }
        });
    } catch (e) {
        console.error(e);
        req.flash('error', 'Gagal memuat laporan peserta');
        res.redirect('/reports');
    }
});

// Session Report — full attendance detail + guardian contact for a single session
router.get('/session', async (req, res) => {
    try {
        const { session_id } = req.query;
        if (!session_id) return res.redirect('/reports');

        const { rows: sessionRows } = await pool.query(`
            SELECT s.*, g.name as group_name, act.name as activity_name, u.full_name as facilitator_name
            FROM sessions s
            JOIN groups g ON s.group_id = g.id
            JOIN activities act ON g.activity_id = act.id
            LEFT JOIN users u ON g.facilitator_id = u.id
            WHERE s.id = $1
        `, [session_id]);

        if (!sessionRows.length) {
            req.flash('error', 'Sesi tidak ditemukan');
            return res.redirect('/reports');
        }

        const { rows: reportData } = await pool.query(`
            SELECT p.full_name, p.nickname, p.guardian_name, p.guardian_whatsapp,
                   at.present, at.wa_sent, at.marked_at
            FROM attendances at
            JOIN participants p ON at.participant_id = p.id
            WHERE at.session_id = $1
            ORDER BY p.full_name
        `, [session_id]);

        const totalCount = reportData.length;
        const presentCount = reportData.filter(r => r.present).length;

        res.render('reports/session', {
            title: `Laporan Sesi - ${sessionRows[0].group_name}`,
            session: sessionRows[0],
            reportData,
            summary: { totalCount, presentCount }
        });
    } catch (e) {
        console.error(e);
        req.flash('error', 'Gagal memuat laporan sesi');
        res.redirect('/reports');
    }
});

// Facilitator Report — sessions run + attendance rate per group for a facilitator
router.get('/facilitator', async (req, res) => {
    try {
        const { facilitator_id, start_date, end_date } = req.query;
        if (!facilitator_id) return res.redirect('/reports');

        const user = req.session.user;
        // Facilitators may only view their own report
        if (user.role === 'facilitator' && String(user.id) !== String(facilitator_id)) {
            req.flash('error', 'Akses ditolak');
            return res.redirect('/reports');
        }

        let query = `
            SELECT g.id as group_id, g.name as group_name, act.name as activity_name,
                   COUNT(DISTINCT s.id) as total_sessions,
                   COUNT(at.id) as total_attendance_rows,
                   SUM(CASE WHEN at.present THEN 1 ELSE 0 END) as present_count
            FROM groups g
            JOIN activities act ON g.activity_id = act.id
            LEFT JOIN sessions s ON s.group_id = g.id
        `;
        let params = [facilitator_id];

        if (start_date && end_date) {
            query += ` AND s.session_date BETWEEN $2 AND $3`;
            params.push(start_date, end_date);
        }

        query += `
            LEFT JOIN attendances at ON at.session_id = s.id
            WHERE g.facilitator_id = $1
            GROUP BY g.id, act.name
            ORDER BY act.name, g.name
        `;

        const { rows: reportData } = await pool.query(query, params);
        const { rows: facilitatorRows } = await pool.query('SELECT id, full_name FROM users WHERE id = $1', [facilitator_id]);

        if (!facilitatorRows.length) {
            req.flash('error', 'Fasilitator tidak ditemukan');
            return res.redirect('/reports');
        }

        const totalSessions = reportData.reduce((sum, r) => sum + Number(r.total_sessions || 0), 0);
        const totalAttendanceRows = reportData.reduce((sum, r) => sum + Number(r.total_attendance_rows || 0), 0);
        const totalPresent = reportData.reduce((sum, r) => sum + Number(r.present_count || 0), 0);
        const overallPercentage = totalAttendanceRows > 0 ? Math.round((totalPresent / totalAttendanceRows) * 10000) / 100 : 0;

        // Monthly trend (perkembangan sesi & kehadiran per bulan) for the progress chart
        let trendQuery = `
            SELECT TO_CHAR(s.session_date, 'YYYY-MM') as month,
                   COUNT(DISTINCT s.id) as sessions_count,
                   COUNT(at.id) as total_rows,
                   SUM(CASE WHEN at.present THEN 1 ELSE 0 END) as present_count
            FROM sessions s
            JOIN groups g ON s.group_id = g.id
            LEFT JOIN attendances at ON at.session_id = s.id
            WHERE g.facilitator_id = $1
        `;
        let trendParams = [facilitator_id];
        if (start_date && end_date) {
            trendQuery += ` AND s.session_date BETWEEN $2 AND $3`;
            trendParams.push(start_date, end_date);
        }
        trendQuery += ` GROUP BY TO_CHAR(s.session_date, 'YYYY-MM') ORDER BY month`;

        const { rows: trendRows } = await pool.query(trendQuery, trendParams);
        const trend = trendRows.map(r => {
            const totalRows = Number(r.total_rows);
            const present = Number(r.present_count);
            return {
                month: r.month,
                sessions: Number(r.sessions_count),
                percentage: totalRows > 0 ? Math.round((present / totalRows) * 10000) / 100 : 0
            };
        });

        res.render('reports/facilitator', {
            title: `Laporan Fasilitator - ${facilitatorRows[0].full_name}`,
            reportData,
            facilitator: facilitatorRows[0],
            summary: { totalSessions, totalAttendanceRows, totalPresent, overallPercentage },
            trend,
            filters: { facilitator_id, start_date, end_date }
        });
    } catch (e) {
        console.error(e);
        req.flash('error', 'Gagal memuat laporan fasilitator');
        res.redirect('/reports');
    }
});

module.exports = router;
