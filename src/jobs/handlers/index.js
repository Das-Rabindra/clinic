import { reminder, followUp } from './reminders.js';
import { syncReviews } from './reviews-sync.js';

/** kind -> handler. Adding a job type means adding one entry here. */
export const handlers = {
  reminder,
  follow_up: followUp,
  sync_reviews: syncReviews,
};
