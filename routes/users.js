const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/role');

router.use(requireLogin, requireAdmin);

// List users
router.get('/', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users ORDER BY role, full_name');
    res.render('users/index', { title: 'Kelola User', users: rows });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data user');
    res.redirect('/dashboard');
  }
});

// Create form
router.get('/create', async (req, res) => {
  const acts = await pool.query('SELECT * FROM activities WHERE active=true ORDER BY name');
  res.render('users/form', { title: 'Tambah User', u: null, activities: acts.rows });
});

// Create
router.post('/', async (req, res) => {
  try {
    const { username, password, full_name, phone, role, activity_ids } = req.body;
    const hash = await bcrypt.hash(password, 10);
    const r = await pool.query(
      'INSERT INTO users (username, password_hash, full_name, phone, role) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [username, hash, full_name, phone || null, role]
    );
    // Assign coordinator activities
    if (role === 'coordinator' && activity_ids) {
      const aids = Array.isArray(activity_ids) ? activity_ids : [activity_ids];
      for (const aid of aids) {
        await pool.query('INSERT INTO coordinator_activities (user_id, activity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [r.rows[0].id, aid]);
      }
    }
    req.flash('success', 'User berhasil ditambahkan');
    res.redirect('/users');
  } catch (e) {
    console.error(e);
    req.flash('error', e.code === '23505' ? 'Username sudah digunakan' : 'Gagal menambah user');
    res.redirect('/users/create');
  }
});

// Edit form
router.get('/:id/edit', async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE id=$1', [req.params.id]);
    if (!rows.length) { req.flash('error', 'User tidak ditemukan'); return res.redirect('/users'); }
    const acts = await pool.query('SELECT * FROM activities WHERE active=true ORDER BY name');
    const ca = await pool.query('SELECT activity_id FROM coordinator_activities WHERE user_id=$1', [req.params.id]);
    const u = rows[0];
    u.coordinator_activity_ids = ca.rows.map(r => r.activity_id);
    res.render('users/form', { title: 'Edit User', u, activities: acts.rows });
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal memuat data');
    res.redirect('/users');
  }
});

// Update
router.post('/:id', async (req, res) => {
  try {
    const { username, password, full_name, phone, role, activity_ids } = req.body;
    if (password && password.trim()) {
      const hash = await bcrypt.hash(password, 10);
      await pool.query('UPDATE users SET username=$1, password_hash=$2, full_name=$3, phone=$4, role=$5, updated_at=NOW() WHERE id=$6',
        [username, hash, full_name, phone || null, role, req.params.id]);
    } else {
      await pool.query('UPDATE users SET username=$1, full_name=$2, phone=$3, role=$4, updated_at=NOW() WHERE id=$5',
        [username, full_name, phone || null, role, req.params.id]);
    }
    // Update coordinator activities
    await pool.query('DELETE FROM coordinator_activities WHERE user_id=$1', [req.params.id]);
    if (role === 'coordinator' && activity_ids) {
      const aids = Array.isArray(activity_ids) ? activity_ids : [activity_ids];
      for (const aid of aids) {
        await pool.query('INSERT INTO coordinator_activities (user_id, activity_id) VALUES ($1,$2) ON CONFLICT DO NOTHING', [req.params.id, aid]);
      }
    }
    req.flash('success', 'User berhasil diupdate');
    res.redirect('/users');
  } catch (e) {
    console.error(e);
    req.flash('error', e.code === '23505' ? 'Username sudah digunakan' : 'Gagal update user');
    res.redirect(`/users/${req.params.id}/edit`);
  }
});

// Delete
router.post('/:id/delete', async (req, res) => {
  try {
    if (parseInt(req.params.id) === req.session.user.id) {
      req.flash('error', 'Tidak bisa menghapus diri sendiri');
      return res.redirect('/users');
    }
    await pool.query('DELETE FROM users WHERE id=$1', [req.params.id]);
    req.flash('success', 'User berhasil dihapus');
    res.redirect('/users');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal menghapus user');
    res.redirect('/users');
  }
});

module.exports = router;
