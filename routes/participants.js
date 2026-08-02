const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');

router.use(requireLogin);

// List participants
router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    let query, params = [];
    
    if (user.role === 'superadmin') {
      query = `SELECT * FROM participants ORDER BY full_name`;
    } else if (user.role === 'coordinator') {
      // Get participants in activities coordinated by this user
      query = `
        SELECT DISTINCT p.* 
        FROM participants p
        JOIN group_participants gp ON p.id = gp.participant_id
        JOIN groups g ON gp.group_id = g.id
        JOIN coordinator_activities ca ON g.activity_id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY p.full_name
      `;
      params = [user.id];
    } else {
      // Facilitators see participants in their groups
      query = `
        SELECT DISTINCT p.* 
        FROM participants p
        JOIN group_participants gp ON p.id = gp.participant_id
        JOIN groups g ON gp.group_id = g.id
        WHERE g.facilitator_id = $1
        ORDER BY p.full_name
      `;
      params = [user.id];
    }
    
    const { rows } = await pool.query(query, params);
    res.render('participants/index', { title: 'Daftar Peserta', participants: rows });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data peserta');
    res.redirect('/dashboard');
  }
});

// Search participant by name
router.get('/search', async (req, res) => {
  try {
    const { q } = req.query;
    if (!q) return res.json([]);
    const { rows } = await pool.query(`
      SELECT id, full_name, nickname FROM participants 
      WHERE full_name ILIKE $1 OR nickname ILIKE $1
      ORDER BY full_name LIMIT 10
    `, [`%${q}%`]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Search failed' });
  }
});

// Create form
router.get('/create', async (req, res) => {
  try {
    const user = req.session.user;
    let groupsQuery, groupsParams = [];
    
    if (user.role === 'superadmin') {
      groupsQuery = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        ORDER BY a.name, g.name
      `;
    } else if (user.role === 'coordinator') {
      groupsQuery = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY a.name, g.name
      `;
      groupsParams = [user.id];
    } else {
      groupsQuery = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        WHERE g.facilitator_id = $1
        ORDER BY a.name, g.name
      `;
      groupsParams = [user.id];
    }
    
    const { rows: groups } = await pool.query(groupsQuery, groupsParams);
    res.render('participants/form', { title: 'Tambah Peserta', p: null, groups, group_ids: [] });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat form');
    res.redirect('/participants');
  }
});

// Create
router.post('/', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { full_name, nickname, address, rt, rw, guardian_name, guardian_whatsapp, group_ids } = req.body;
    
    const r = await client.query(`
      INSERT INTO participants (full_name, nickname, address, rt, rw, guardian_name, guardian_whatsapp)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
    `, [full_name, nickname || null, address || null, rt || null, rw || null, guardian_name || null, guardian_whatsapp || null]);
    
    const participantId = r.rows[0].id;
    
    if (group_ids) {
      const gids = Array.isArray(group_ids) ? group_ids : [group_ids];
      for (const gid of gids) {
        await client.query('INSERT INTO group_participants (group_id, participant_id) VALUES ($1, $2)', [gid, participantId]);
      }
    }
    
    await client.query('COMMIT');
    req.flash('success', 'Peserta berhasil ditambahkan');
    res.redirect('/participants');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    req.flash('error', 'Gagal menambah peserta');
    res.redirect('/participants/create');
  } finally {
    client.release();
  }
});

// Detail
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM participants WHERE id=$1', [req.params.id]);
    if (!rows.length) {
      req.flash('error', 'Peserta tidak ditemukan');
      return res.redirect('/participants');
    }
    
    // Get groups
    const gr = await pool.query(`
      SELECT g.*, a.name as activity_name 
      FROM group_participants gp
      JOIN groups g ON gp.group_id = g.id
      JOIN activities a ON g.activity_id = a.id
      WHERE gp.participant_id = $1
    `, [req.params.id]);
    
    res.render('participants/detail', { title: 'Detail Peserta', p: rows[0], groups: gr.rows });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data');
    res.redirect('/participants');
  }
});

// Edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM participants WHERE id=$1', [req.params.id]);
    if (!rows.length) {
      req.flash('error', 'Peserta tidak ditemukan');
      return res.redirect('/participants');
    }
    
    const user = req.session.user;
    let groupsQuery, groupsParams = [];
    
    if (user.role === 'superadmin') {
      groupsQuery = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        ORDER BY a.name, g.name
      `;
    } else if (user.role === 'coordinator') {
      groupsQuery = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        JOIN coordinator_activities ca ON a.id = ca.activity_id
        WHERE ca.user_id = $1
        ORDER BY a.name, g.name
      `;
      groupsParams = [user.id];
    } else {
      groupsQuery = `
        SELECT g.*, a.name as activity_name 
        FROM groups g JOIN activities a ON g.activity_id = a.id 
        WHERE g.facilitator_id = $1
        ORDER BY a.name, g.name
      `;
      groupsParams = [user.id];
    }
    
    const { rows: groups } = await pool.query(groupsQuery, groupsParams);
    const { rows: gp } = await pool.query('SELECT group_id FROM group_participants WHERE participant_id=$1', [req.params.id]);
    const group_ids = gp.map(r => r.group_id);
    
    res.render('participants/form', { title: 'Edit Peserta', p: rows[0], groups, group_ids });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat form');
    res.redirect('/participants');
  }
});

// Update
router.post('/:id', async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { full_name, nickname, address, rt, rw, guardian_name, guardian_whatsapp, group_ids } = req.body;
    
    await client.query(`
      UPDATE participants 
      SET full_name=$1, nickname=$2, address=$3, rt=$4, rw=$5, guardian_name=$6, guardian_whatsapp=$7, updated_at=NOW()
      WHERE id=$8
    `, [full_name, nickname || null, address || null, rt || null, rw || null, guardian_name || null, guardian_whatsapp || null, req.params.id]);
    
    // Only modify groups that the current user has access to
    const user = req.session.user;
    let allowedGroupIds = [];
    if (user.role === 'superadmin') {
      const r = await client.query('SELECT id FROM groups');
      allowedGroupIds = r.rows.map(row => row.id);
    } else if (user.role === 'coordinator') {
      const r = await client.query(`
        SELECT g.id FROM groups g
        JOIN coordinator_activities ca ON g.activity_id = ca.activity_id
        WHERE ca.user_id = $1
      `, [user.id]);
      allowedGroupIds = r.rows.map(row => row.id);
    } else {
      const r = await client.query('SELECT id FROM groups WHERE facilitator_id = $1', [user.id]);
      allowedGroupIds = r.rows.map(row => row.id);
    }

    const gids = group_ids ? (Array.isArray(group_ids) ? group_ids.map(Number) : [Number(group_ids)]) : [];
    
    // Remove from allowed groups that are not in the new selection
    const placeholders = allowedGroupIds.map((_, i) => '$' + (i + 2)).join(',');
    if (allowedGroupIds.length > 0) {
      await client.query(`
        DELETE FROM group_participants 
        WHERE participant_id = $1 AND group_id IN (${placeholders})
      `, [req.params.id, ...allowedGroupIds]);
      
      // Add to selected groups (only if they are in allowedGroupIds)
      for (const gid of gids) {
        if (allowedGroupIds.includes(gid)) {
          await client.query('INSERT INTO group_participants (group_id, participant_id) VALUES ($1, $2)', [gid, req.params.id]);
        }
      }
    }
    
    await client.query('COMMIT');
    req.flash('success', 'Peserta berhasil diupdate');
    res.redirect('/participants');
  } catch (e) {
    await client.query('ROLLBACK');
    console.error(e);
    req.flash('error', 'Gagal update peserta');
    res.redirect(`/participants/${req.params.id}/edit`);
  } finally {
    client.release();
  }
});

// Delete
router.post('/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM participants WHERE id=$1', [req.params.id]);
    req.flash('success', 'Peserta berhasil dihapus');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal menghapus peserta');
  }
  res.redirect('/participants');
});

module.exports = router;
