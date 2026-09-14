/** Thin wrapper so every call site writes a consistent audit row. */
import * as auditRepo from '../repositories/audit.repo.js';
import { snap } from '../utils/format.js';

export function audit(ctx = {}, { action, entity, entity_id, summary, before, after }) {
  try {
    auditRepo.write({
      user_id: ctx.userId ?? null,
      user_email: ctx.userEmail ?? null,
      action, entity, entity_id, summary,
      before_json: snap(before), after_json: snap(after),
      ip: ctx.ip ?? null, user_agent: ctx.userAgent ?? null,
    });
  } catch (err) {
    // Auditing must never break the operation it is recording.
    console.error('[audit] failed to write entry:', err.message);
  }
}

/** Build an audit context from an Express request. */
export const ctxFrom = (req) => ({
  userId: req.user?.id ?? null,
  userEmail: req.user?.email ?? null,
  ip: req.ip,
  userAgent: String(req.get('user-agent') || '').slice(0, 300),
});
