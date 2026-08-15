const { getAuth } = require('@clerk/express');

// Clerk's requireAuth() was deprecated so replacing it w this
function requireUser(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

module.exports = { requireUser };
