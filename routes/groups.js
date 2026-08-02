const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');
const { requireAdminOrCoordinator } = require('../middleware/role');

router.use(requireLogin);

// List groups (filtered by role)
router.get('/', async (req, res) => {
  try {
    const user = req.session.user;
    let rows;
    if (user.role === 'superadmin') {
      ({ rows } = await pool.query(`
        SELECT g.*, a.name as activity_name, u.full_name as facilitator_name,
          (SELECT COUNT(*)::int FROM group_participants WHERE group_id=g.id) as member_count
        FROM groups g JOIN activities a ON g.activity_id=a.id LEFT JOIN users u ON g.facilitator_id=u.id
        ORDER BY a.name, g.name
      `));
    } else if (user.role === 'coordinator') {
      ({ rows } = await pool.query(`
        SELECT g.*, a.name as activity_name, u.full_name as facilitator_name,
          (SELECT COUNT(*)::int FROM group_participants WHERE group_id=g.id) as member_count
        FROM groups g JOIN activities a ON g.activity_id=a.id LEFT JOIN users u ON g.facilitator_id=u.id
        JOIN coordinator_activities ca ON a.id=ca.activity_id
        WHERE ca.user_id=$1 ORDER BY a.name, g.name
      `, [user.id]));
    } else {
      ({ rows } = await pool.query(`
        SELECT g.*, a.name as activity_name, u.full_name as facilitator_name,
          (SELECT COUNT(*)::int FROM group_participants WHERE group_id=g.id) as member_count
        FROM groups g JOIN activities a ON g.activity_id=a.id LEFT JOIN users u ON g.facilitator_id=u.id
        WHERE g.facilitator_id=$1 ORDER BY a.name, g.name
      `, [user.id]));
    }
    res.render('groups/index', { title: 'Kelola Kelompok', groups: rows });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data');
    res.redirect('/dashboard');
  }
});

// Create form (admin/coordinator)
router.get('/create', requireAdminOrCoordinator, async (req, res) => {
  const user = req.session.user;
  let activities, facilitators;
  if (user.role === 'superadmin') {
    activities = (await pool.query('SELECT * FROM activities WHERE active=true ORDER BY name')).rows;
  } else {
    activities = (await pool.query(`
      SELECT a.* FROM activities a JOIN coordinator_activities ca ON a.id=ca.activity_id
      WHERE ca.user_id=$1 AND a.active=true ORDER BY name
    `, [user.id])).rows;
  }
  facilitators = (await pool.query("SELECT id, full_name FROM users WHERE role='facilitator' ORDER BY full_name")).rows;
  res.render('groups/form', { title: 'Tambah Kelompok', group: null, activities, facilitators });
});

// Create
router.post('/', requireAdminOrCoordinator, async (req, res) => {
  try {
    const { name, activity_id, facilitator_id } = req.body;
    await pool.query('INSERT INTO groups (name, activity_id, facilitator_id) VALUES ($1,$2,$3)',
      [name, activity_id, facilitator_id || null]);
    req.flash('success', 'Kelompok berhasil ditambahkan');
    res.redirect('/groups');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal menambah kelompok');
    res.redirect('/groups/create');
  }
});

// Edit form
router.get('/:id/edit', requireAdminOrCoordinator, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM groups WHERE id=$1', [req.params.id]);
    if (!rows.length) { req.flash('error', 'Kelompok tidak ditemukan'); return res.redirect('/groups'); }
    const user = req.session.user;
    let activities;
    if (user.role === 'superadmin') {
      activities = (await pool.query('SELECT * FROM activities WHERE active=true ORDER BY name')).rows;
    } else {
      activities = (await pool.query(`
        SELECT a.* FROM activities a JOIN coordinator_activities ca ON a.id=ca.activity_id
        WHERE ca.user_id=$1 AND a.active=true ORDER BY name
      `, [user.id])).rows;
    }
    const facilitators = (await pool.query("SELECT id, full_name FROM users WHERE role='facilitator' ORDER BY full_name")).rows;
    res.render('groups/form', { title: 'Edit Kelompok', group: rows[0], activities, facilitators });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data');
    res.redirect('/groups');
  }
});

// Update
router.post('/:id', requireAdminOrCoordinator, async (req, res) => {
  try {
    const { name, activity_id, facilitator_id } = req.body;
    await pool.query('UPDATE groups SET name=$1, activity_id=$2, facilitator_id=$3 WHERE id=$4',
      [name, activity_id, facilitator_id || null, req.params.id]);
    req.flash('success', 'Kelompok berhasil diupdate');
    res.redirect('/groups');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal update kelompok');
    res.redirect(`/groups/${req.params.id}/edit`);
  }
});

// Delete
router.post('/:id/delete', requireAdminOrCoordinator, async (req, res) => {
  try {
    await pool.query('DELETE FROM groups WHERE id=$1', [req.params.id]);
    req.flash('success', 'Kelompok berhasil dihapus');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal menghapus kelompok');
  }
  res.redirect('/groups');
});

module.exports = router;
