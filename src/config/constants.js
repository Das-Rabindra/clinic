/** Domain enums shared by the schema, services and UI. */

export const ROLES = Object.freeze({ OWNER: 'owner', ADMIN: 'admin', STAFF: 'staff' });
/** Higher number = more authority. Used by requireRole(). */
export const ROLE_RANK = Object.freeze({ staff: 1, admin: 2, owner: 3 });

export const APPOINTMENT_STATUS = Object.freeze({
  PENDING: 'pending',
  CONFIRMED: 'confirmed',
  RESCHEDULED: 'rescheduled',
  CHECKED_IN: 'checked_in',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
  NO_SHOW: 'no_show',
});
export const APPOINTMENT_STATUSES = Object.values(APPOINTMENT_STATUS);

/** Statuses that still occupy a slot. Cancelled/no-show release it. */
export const BLOCKING_STATUSES = Object.freeze([
  'pending', 'confirmed', 'rescheduled', 'checked_in', 'in_progress', 'completed',
]);

export const GALLERY_CATEGORIES = Object.freeze([
  'clinic', 'reception', 'treatment_room', 'exterior', 'equipment',
  'waiting_area', 'team', 'doctor', 'treatment',
]);
/** Categories that depict patient work and therefore require recorded consent. */
export const CONSENT_REQUIRED_CATEGORIES = Object.freeze(['treatment']);

export const ENQUIRY_STATUS = Object.freeze(['new', 'contacted', 'converted', 'archived']);

export const NOTIFICATION_CHANNELS = Object.freeze(['whatsapp', 'email', 'admin']);
export const NOTIFICATION_STATUS = Object.freeze([
  'queued', 'sending', 'sent', 'failed', 'skipped', 'not_configured',
]);

export const TEMPLATES = Object.freeze({
  BOOKING_RECEIVED: 'booking_received',
  APPOINTMENT_CONFIRMED: 'appointment_confirmed',
  REMINDER_24H: 'reminder_24h',
  REMINDER_2H: 'reminder_2h',
  RESCHEDULED: 'rescheduled',
  CANCELLED: 'cancelled',
  FOLLOW_UP: 'follow_up',
  NEW_APPOINTMENT_ADMIN: 'new_appointment_admin',
  CANCELLED_ADMIN: 'cancelled_admin',
  NEW_ENQUIRY_ADMIN: 'new_enquiry_admin',
});

export const WEEKDAYS = Object.freeze([
  'Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday',
]);
