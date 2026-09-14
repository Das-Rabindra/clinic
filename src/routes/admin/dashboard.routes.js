import { Router } from 'express';
import * as apptRepo from '../../repositories/appointments.repo.js';
import * as patientsRepo from '../../repositories/patients.repo.js';
import * as contentRepo from '../../repositories/content.repo.js';
import * as notifRepo from '../../repositories/notifications.repo.js';
import * as reviewsRepo from '../../repositories/reviews.repo.js';
import * as mediaRepo from '../../repositories/media.repo.js';
import * as galleryRepo from '../../repositories/gallery.repo.js';
import * as settingsRepo from '../../repositories/settings.repo.js';
import * as notifications from '../../services/notification/index.js';
import { todayIn, addDays, minTo12h } from '../../utils/time.js';

const router = Router();

router.get('/dashboard', async (_req, res) => {
  const tz = (await settingsRepo.get()).timezone || 'Asia/Kolkata';
  const today = todayIn(tz);

  const todays = (await apptRepo.onDate(today)).map(a => ({
    id: a.id, ref: a.ref, time: minTo12h(a.start_min), start_min: a.start_min,
    patient: a.patient_name, phone: a.patient_phone,
    service: a.service_name, status: a.status, doctor: a.doctor_name,
  }));

  const counts = Object.fromEntries((await apptRepo.statusCounts()).map(r => [r.status, r.c]));
  const todayCounts = Object.fromEntries((await apptRepo.statusCounts(today, today)).map(r => [r.status, r.c]));

  res.json({
    today,
    today_appointments: todays,
    today_patient_count: new Set((await apptRepo.onDate(today))
      .filter(a => !['cancelled', 'no_show'].includes(a.status))
      .map(a => a.patient_id)).size,
    upcoming: (await apptRepo.upcoming(addDays(today, 1), 8)).map(a => ({
      id: a.id, ref: a.ref, date: a.date, time: minTo12h(a.start_min),
      patient: a.patient_name, service: a.service_name, status: a.status,
    })),
    counts: {
      pending: counts.pending || 0,
      confirmed: counts.confirmed || 0,
      completed: counts.completed || 0,
      cancelled: counts.cancelled || 0,
      no_show: counts.no_show || 0,
      today_total: Object.values(todayCounts).reduce((a, b) => a + b, 0),
    },
    new_enquiries: await contentRepo.newEnquiryCount(),
    recent_enquiries: await contentRepo.listEnquiries({ status: 'new', limit: 5 }),
    recent_reviews: await reviewsRepo.recent(5),
    recent_uploads: await mediaRepo.recentCount(7),
    recent_gallery: (await galleryRepo.listAdmin({})).slice(0, 6).map(g => ({
      id: g.id, title: g.title, thumb_url: g.thumb_url || g.image_url,
      is_published: g.is_published === 1, category: g.category,
    })),
    patients_total: await patientsRepo.count(),
    notifications: {
      unread: await notifRepo.unreadAdminCount(),
      failed: await notifRepo.failedCount(),
      providers: await notifications.status(),
    },
  });
});

router.get('/alerts', async (_req, res) => {
  res.json({
    unread: await notifRepo.unreadAdminCount(),
    items: await notifRepo.listAdmin(30),
  });
});

router.post('/alerts/:id/read', async (req, res) => {
  await notifRepo.markAdminRead(Number(req.params.id));
  res.json({ ok: true });
});

router.post('/alerts/read-all', async (_req, res) => {
  const n = await notifRepo.markAllAdminRead();
  res.json({ ok: true, marked: n });
});

export default router;
