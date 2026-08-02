function requireLogin(req, res, next) {
  if (!req.session.user) {
    req.flash('error', 'Silakan login terlebih dahulu');
    return res.redirect('/auth/login');
  }
  next();
}

module.exports = { requireLogin };
