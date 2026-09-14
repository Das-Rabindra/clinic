/** Periodic Google Reviews refresh. Failure is recorded, never fatal. */
import * as reviews from '../../services/google/reviews.service.js';
import * as notifRepo from '../../repositories/notifications.repo.js';

export async function syncReviews() {
  const result = await reviews.sync();
  if (result.ok) {
    if (result.synced > 0) {
      await notifRepo.pushAdmin({
        type: 'reviews.sync',
        title: 'Google reviews synced',
        body: `${result.synced} review(s) updated${result.average ? ` · average ${result.average}` : ''}`,
        link: '/admin/reviews', severity: 'success',
      });
    }
  } else {
    await notifRepo.pushAdmin({
      type: 'reviews.sync_failed',
      title: 'Google review sync failed',
      body: result.error,
      link: '/admin/reviews', severity: 'error',
    });
  }
  return result;
}
