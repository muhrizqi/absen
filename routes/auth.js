const router = require('express').Router();
const bcrypt = require('bcryptjs');
const { pool } = require('../config/database');

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect('/dashboard');
  res.render('auth/login', { title: 'Login', layout: false });
});

router.post('/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    const { rows } = await pool.query('SELECT * FROM users WHERE username=$1', [username]);
    if (!rows.length || !(await bcrypt.compare(password, rows[0].password_hash))) {
      req.flash('error', 'Username atau password salah');
      return res.redirect('/auth/login');
    }
    const u = rows[0];
    req.session.user = { id: u.id, username: u.username, full_name: u.full_name, role: u.role };
    res.redirect('/dashboard');
  } catch (e) {
    console.error(e);
    req.flash('error', 'Terjadi kesalahan');
    res.redirect('/auth/login');
  }
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

// Also support GET for convenience
router.get('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/auth/login'));
});

module.exports = router;
