require('dotenv').config();
const express = require('express');
const session = require('express-session');
const PgSession = require('connect-pg-simple')(session);
const flash = require('connect-flash');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const path = require('path');
const expressLayouts = require('express-ejs-layouts');
const { pool, initDatabase } = require('./config/database');

const app = express();
const PORT = process.env.PORT || 3000;

// Security & performance
app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
app.use(compression());
app.use(morgan('tiny'));

// Body parsing
app.use(express.urlencoded({ extended: true, limit: '20mb' }));
app.use(express.json({ limit: '20mb' }));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// View engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(expressLayouts);
app.set('layout', 'layouts/main');

// Session
app.use(session({
  store: new PgSession({ pool, tableName: 'user_sessions', createTableIfMissing: true }),
  secret: process.env.SESSION_SECRET || 'rmj-jogokariyan-secret-2026',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    httpOnly: true,
    sameSite: 'lax'
  }
}));

// Flash messages
app.use(flash());

// Global variables for views
app.use((req, res, next) => {
  res.locals.user = req.session.user || null;
  res.locals.success = req.flash('success');
  res.locals.error = req.flash('error');
  res.locals.currentPath = req.path;
  next();
});

// Routes
app.use('/auth', require('./routes/auth'));
app.use('/', require('./routes/dashboard'));
app.use('/users', require('./routes/users'));
app.use('/activities', require('./routes/activities'));
app.use('/groups', require('./routes/groups'));
app.use('/participants', require('./routes/participants'));
app.use('/sessions', require('./routes/sessions'));
app.use('/reports', require('./routes/reports'));
app.use('/settings', require('./routes/settings'));

// 404 handler
app.use((req, res) => {
  res.status(404).render('error', {
    title: 'Halaman Tidak Ditemukan',
    message: 'Halaman yang Anda cari tidak ditemukan.',
    code: 404
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).render('error', {
    title: 'Kesalahan Server',
    message: 'Terjadi kesalahan pada server.',
    code: 500
  });
});

// Start
async function start() {
  try {
    await initDatabase();
    app.listen(PORT, '0.0.0.0', () => {
      console.log(`🕌 Absensi RMJ berjalan di port ${PORT}`);
    });
  } catch (err) {
    console.error('❌ Gagal start:', err);
    process.exit(1);
  }
}

start();
