function requireAdmin(req, res, next) {
  if (req.session.user?.role !== 'superadmin') {
    req.flash('error', 'Akses ditolak');
    return res.redirect('/dashboard');
  }
  next();
}

function requireAdminOrCoordinator(req, res, next) {
  const role = req.session.user?.role;
  if (role !== 'superadmin' && role !== 'coordinator') {
    req.flash('error', 'Akses ditolak');
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { requireAdmin, requireAdminOrCoordinator };
