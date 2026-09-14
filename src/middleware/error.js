/** Central error handling. Never leaks stack traces or SQL to clients. */
import { config } from '../config/env.js';

export function notFound(req, res) {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'Not found.', code: 'NOT_FOUND' });
  }
  res.status(404).render('public/404', { title: 'Page not found' });
}

export function errorHandler(err, req, res, _next) {
  const status = err.status || err.statusCode || 500;

  if (status >= 500) {
    console.error(`[error] ${req.method} ${req.originalUrl}:`, err);
  }

  // Multer / upload errors carry useful, safe messages.
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'That file is too large.', code: 'FILE_TOO_LARGE' });
  }

  if (req.path.startsWith('/api/') || req.get('accept')?.includes('application/json')) {
    return res.status(status).json({
      error: status >= 500 ? 'Something went wrong. Please try again.' : err.message,
      code: err.code || (status >= 500 ? 'INTERNAL' : 'ERROR'),
      ...(err.fields ? { fields: err.fields } : {}),
      ...(config.isProd ? {} : { detail: status >= 500 ? String(err.message) : undefined }),
    });
  }

  res.status(status).render('public/error', {
    title: status >= 500 ? 'Something went wrong' : 'Error',
    status,
    message: status >= 500 ? 'Something went wrong on our side. Please try again.' : err.message,
  });
}

/** Wrap async route handlers so rejections reach errorHandler. */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
