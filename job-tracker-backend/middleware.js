const { getAuth } = require('@clerk/express');

// Clerk's requireAuth() was deprecated so replacing it w this
function requireUser(req, res, next) {
  const { userId } = getAuth(req);
  if (!userId) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

// Express 5 forwards rejected promises to the error handler on its own, but
// wrapping keeps the intent explicit and works the same if handlers move.
function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function errorHandler(error, _req, res, _next) {
  console.error('[error]', error);
  if (res.headersSent) return;
  const status = error.status || 500;
  res.status(status).json({ error: error.expose ? error.message : 'Something went wrong on the server' });
}

function httpError(status, message) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

module.exports = { requireUser, asyncHandler, errorHandler, httpError };
