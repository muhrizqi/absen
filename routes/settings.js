const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// View settings
router.get('/', async (req, res) => {
    try {
        const user = req.session.user;
        let templates;

        if (user.role === 'superadmin') {
            const { rows } = await pool.query('SELECT * FROM message_templates WHERE user_id IS NULL');
            templates = rows;
        } else {
            const { rows } = await pool.query('SELECT * FROM message_templates WHERE user_id = $1', [user.id]);
            templates = rows;
        }

        const tplAttendance = templates.find(t => t.type === 'attendance')?.template_text || '';
        const tplSessionEnd = templates.find(t => t.type === 'session_end')?.template_text || '';

        res.render('settings/index', { 
            title: 'Pengaturan', 
            tplAttendance, 
            tplSessionEnd 
        });
    } catch (e) {
        console.error(e);
        req.flash('error', 'Gagal memuat pengaturan');
        res.redirect('/dashboard');
    }
});

// Update settings
router.post('/', async (req, res) => {
    try {
        const user = req.session.user;
        const { tpl_attendance, tpl_session_end } = req.body;
        const userIdVal = user.role === 'superadmin' ? null : user.id;

        // Upsert attendance template
        if (tpl_attendance) {
            if (userIdVal === null) {
                await pool.query(`
                    INSERT INTO message_templates (user_id, type, template_text) 
                    VALUES (NULL, 'attendance', $1)
                    ON CONFLICT (type) WHERE user_id IS NULL DO UPDATE SET template_text = EXCLUDED.template_text, updated_at = NOW()
                `, [tpl_attendance]);
            } else {
                await pool.query(`
                    INSERT INTO message_templates (user_id, type, template_text) 
                    VALUES ($1, 'attendance', $2)
                    ON CONFLICT (user_id, type) WHERE user_id IS NOT NULL DO UPDATE SET template_text = EXCLUDED.template_text, updated_at = NOW()
                `, [userIdVal, tpl_attendance]);
            }
        }

        // Upsert session end template
        if (tpl_session_end) {
             if (userIdVal === null) {
                await pool.query(`
                    INSERT INTO message_templates (user_id, type, template_text) 
                    VALUES (NULL, 'session_end', $1)
                    ON CONFLICT (type) WHERE user_id IS NULL DO UPDATE SET template_text = EXCLUDED.template_text, updated_at = NOW()
                `, [tpl_session_end]);
            } else {
                await pool.query(`
                    INSERT INTO message_templates (user_id, type, template_text) 
                    VALUES ($1, 'session_end', $2)
                    ON CONFLICT (user_id, type) WHERE user_id IS NOT NULL DO UPDATE SET template_text = EXCLUDED.template_text, updated_at = NOW()
                `, [userIdVal, tpl_session_end]);
            }
        }

        req.flash('success', 'Pengaturan berhasil disimpan');
        res.redirect('/settings');
    } catch (e) {
        console.error(e);
        req.flash('error', 'Gagal menyimpan pengaturan');
        res.redirect('/settings');
    }
});

module.exports = router;
