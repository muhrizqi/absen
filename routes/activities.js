const router = require('express').Router();
const { pool } = require('../config/database');
const { requireLogin } = require('../middleware/auth');
const { requireAdmin } = require('../middleware/role');

router.use(requireLogin, requireAdmin);

router.get('/', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM activities ORDER BY name');
  res.render('activities/index', { title: 'Kelola Kegiatan', activities: rows });
});

router.get('/create', (req, res) => {
  res.render('activities/form', { title: 'Tambah Kegiatan', activity: null });
});

router.post('/', async (req, res) => {
  try {
    const { name, description, schedule_info } = req.body;
    await pool.query('INSERT INTO activities (name, description, schedule_info) VALUES ($1,$2,$3)',
      [name, description || null, schedule_info || null]);
    req.flash('success', 'Kegiatan berhasil ditambahkan');
    res.redirect('/activities');
  } catch (e) {
    console.error(e);
    req.flash('error', e.code === '23505' ? 'Nama kegiatan sudah ada' : 'Gagal menambah kegiatan');
    res.redirect('/activities/create');
  }
});

router.get('/:id/edit', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM activities WHERE id=$1', [req.params.id]);
  if (!rows.length) { req.flash('error', 'Kegiatan tidak ditemukan'); return res.redirect('/activities'); }
  res.render('activities/form', { title: 'Edit Kegiatan', activity: rows[0] });
});

router.post('/:id', async (req, res) => {
  try {
    const { name, description, schedule_info, active } = req.body;
    await pool.query('UPDATE activities SET name=$1, description=$2, schedule_info=$3, active=$4 WHERE id=$5',
      [name, description || null, schedule_info || null, active === 'on', req.params.id]);
    req.flash('success', 'Kegiatan berhasil diupdate');
    res.redirect('/activities');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal update kegiatan');
    res.redirect(`/activities/${req.params.id}/edit`);
  }
});

router.post('/:id/delete', async (req, res) => {
  try {
    await pool.query('DELETE FROM activities WHERE id=$1', [req.params.id]);
    req.flash('success', 'Kegiatan berhasil dihapus');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Gagal menghapus. Mungkin masih ada kelompok terkait.');
  }
  res.redirect('/activities');
});

module.exports = router;
