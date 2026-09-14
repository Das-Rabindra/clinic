/** Session resolution, route protection and role checks. */
import { config } from '../config/env.js';
import { resolveSession } from '../services/auth.service.js';
import { ROLE_RANK } from '../config/constants.js';

/** Populates req.user / req.session when a valid cookie is present. */
export async function loadSession(req, _res, next) {
  try {
    const token = req.cookies?.[config.session.cookieName];
    const session = token ? await resolveSession(token) : null;
    if (session) {
      req.user = session.user;
      req.session = { id: session.sessionId, csrfToken: session.csrfToken, token };
    }
    next();
  } catch (err) {
    // A database hiccup must not make every page 500; treat it as signed out.
    console.error('[auth] session lookup failed:', err.message);
    next();
  }
}

/** API guard: 401 JSON. */
export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
  next();
}

/** Page guard: redirect to the login screen. */
export function requireAuthPage(req, res, next) {
  if (!req.user) {
    const next_ = encodeURIComponent(req.originalUrl || '/admin');
    return res.redirect(`/admin/login?next=${next_}`);
  }
  next();
}

/** Minimum role. Roles are ranked so 'owner' satisfies 'admin' and 'staff'. */
export function requireRole(minRole) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required.', code: 'UNAUTHENTICATED' });
    if ((ROLE_RANK[req.user.role] || 0) < (ROLE_RANK[minRole] || 99)) {
      return res.status(403).json({ error: 'You do not have permission to do that.', code: 'FORBIDDEN' });
    }
    next();
  };
}
