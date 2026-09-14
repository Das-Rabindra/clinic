/**
 * Seeds the database with the content that was previously hardcoded in the
 * original single-file site (CLINIC / SERVICES / GALLERY / FAQS), so the
 * migration loses nothing. That file is preserved at
 * legacy/index.original.html. Idempotent: safe to run on every boot.
 *
 * Nothing here invents clinical claims, prices or reviews - it is exactly the
 * content the original file shipped with, now editable from the admin panel.
 */
import { db, tx } from './index.js';
import { one, run } from '../repositories/base.js';
import * as usersRepo from '../repositories/users.repo.js';
import * as servicesRepo from '../repositories/services.repo.js';
import * as doctorsRepo from '../repositories/doctors.repo.js';
import * as settingsRepo from '../repositories/settings.repo.js';
import * as contentRepo from '../repositories/content.repo.js';
import { config } from '../config/env.js';

/* Content carried over verbatim from legacy/index.original.html */
const CLINIC = {
  name: 'Samal Dental Care',
  doctor_name: 'Dr. Sonali S. Samal',
  qualification: 'BDS, FRCD',
  institution: 'Kalinga Institute of Dental Science, Bhubaneswar',
  registration: 'Regd. No. 3209-A',
  phone: '9124839288',
  phone_intl: '+919124839288',
  whatsapp: '919124839288',
  address_line1: 'Annapurna Market Complex',
  address_line2: 'Housing Board, FCI',
  area: 'Vikrampur',
  postal_code: '759106',
  country: 'India',
};

const SERVICES = [
  ['General', 'General Dentistry', 'Routine check-ups and general oral healthcare.', 30],
  ['Preventive', 'Dental Cleaning', 'Professional cleaning to maintain healthy gums and teeth.', 30],
  ['Restorative', 'Dental Fillings', 'Treatment for cavities and minor tooth damage.', 45],
  ['Restorative', 'Root Canal Treatment', 'Treatment to save an infected or damaged tooth.', 60],
  ['Restorative', 'Crowns & Bridges', 'Restoring the shape, strength, and appearance of teeth.', 60],
  ['Surgical', 'Tooth Extraction', 'Safe removal of a damaged or problematic tooth.', 45],
  ['Cosmetic', 'Teeth Whitening', 'Brightening treatment for a more confident smile.', 60],
  ['Family', 'Pediatric Dentistry', 'Gentle dental care for younger patients.', 30],
];

const FAQS = [
  ['How can I book an appointment?',
    'Use the appointment booking on this website to pick a treatment, date and available time slot, or call the clinic or send a message on WhatsApp — whichever is most convenient for you.'],
  ['How can I contact the clinic?',
    'Call or WhatsApp {{phone}}, or use the booking form on this page.'],
  ['Where is Samal Dental Care located?', '{{address}}.'],
  ['Do I need to book before visiting?',
    'Booking ahead helps the clinic plan your visit. The website shows live availability, so you can see exactly which times are free and reserve one instantly.'],
  ['How can I get directions to the clinic?',
    'Use the "Get Directions" button in the location section to open the address in Google Maps.'],
];

/** Default weekly hours: open every day 08:00-21:00 with a 13:00-15:00 break. */
const DEFAULT_HOURS = [0, 1, 2, 3, 4, 5, 6].map(weekday => ({
  weekday, is_open: 1, open_min: 480, close_min: 1260,
  break_start_min: 780, break_end_min: 900,
}));

export function seed({ log = console.log } = {}) {
  tx(() => {
    /* Clinic settings singleton */
    if (!settingsRepo.get()) {
      run(
        `INSERT INTO clinic_settings (id, name, doctor_name, qualification, registration, institution,
           phone, phone_intl, whatsapp, address_line1, address_line2, area, postal_code, country,
           timezone, slot_interval_min, booking_lead_hours, booking_horizon_days)
         VALUES (1, @name, @doctor_name, @qualification, @registration, @institution,
           @phone, @phone_intl, @whatsapp, @address_line1, @address_line2, @area, @postal_code,
           @country, 'Asia/Kolkata', 30, 2, 60)`,
        CLINIC
      );
      settingsRepo.update({
        tagline: 'Modern dental care. Healthy smiles, confident you.',
        description: 'Samal Dental Care is led by Dr. Sonali S. Samal, BDS, FRCD, offering attentive, modern dental treatment close to home in Vikrampur.',
        hero_eyebrow: 'Vikrampur, Housing Board · FCI',
        hero_title: 'Modern dental care.\nHealthy smiles, confident you.',
        hero_lede: 'Samal Dental Care is led by Dr. Sonali S. Samal, BDS, FRCD, offering attentive, modern dental treatment close to home in Vikrampur.',
        hero_cta_label: 'Book an Appointment',
        hero_trust_text: 'Personalised care from a dentist you can talk to.',
        about_title: 'Care led by an experienced dentist',
        about_body: 'Dr. Sonali S. Samal holds a BDS and FRCD from Kalinga Institute of Dental Science, Bhubaneswar, and practises at Samal Dental Care in Vikrampur.',
        story_title: 'A calm, modern clinic',
        story_body: 'Samal Dental Care was set up to make quality dental treatment available close to home — with unhurried consultations, clear explanations, and modern equipment.',
        services_title: 'Dental services offered at the clinic',
        services_lede: 'Treatments currently offered at Samal Dental Care. Book any of them directly from this page.',
        gallery_title: 'A closer look at Samal Dental Care',
        gallery_lede: 'Photographs of the clinic, equipment and team.',
        reviews_title: 'What patients are saying',
        cta_title: 'Your smile deserves attentive, modern care',
        cta_body: 'Reach Samal Dental Care by phone, WhatsApp, or book an appointment online — whichever is easiest for you.',
        seo_title: 'Samal Dental Care — Dr. Sonali S. Samal, BDS, FRCD | Vikrampur',
        seo_description: 'Samal Dental Care, led by Dr. Sonali S. Samal (BDS, FRCD), offers modern dental treatment in Vikrampur. Book an appointment online, call, or message on WhatsApp today.',
        og_title: 'Samal Dental Care — Modern Dental Care in Vikrampur',
        og_description: 'Led by Dr. Sonali S. Samal, BDS, FRCD. Book an appointment, call, or WhatsApp the clinic.',
      });
      log('[seed] clinic settings created');
    }

    /* Weekly hours */
    if (!settingsRepo.getHours().length) {
      for (const h of DEFAULT_HOURS) settingsRepo.upsertHours(h.weekday, h);
      log('[seed] clinic hours created (every day 08:00-21:00, break 13:00-15:00)');
    }

    /* The clinic's dentist */
    if (!doctorsRepo.list().length) {
      const doc = doctorsRepo.create({
        name: CLINIC.doctor_name,
        qualification: CLINIC.qualification,
        registration: CLINIC.registration,
        specialization: 'General & Cosmetic Dentistry',
        bio: `${CLINIC.doctor_name} holds a ${CLINIC.qualification} from ${CLINIC.institution}.`,
        languages: 'English, Hindi, Odia',
      });
      // No per-doctor overrides: the single dentist follows clinic hours.
      log(`[seed] doctor created: ${doc.name}`);
    }

    /* Services (previously the SERVICES array) */
    if (!servicesRepo.list().length) {
      SERVICES.forEach(([cat, name, desc, duration], i) => {
        const category = servicesRepo.ensureCategory(cat);
        servicesRepo.create({
          name, category_id: category.id, short_desc: desc,
          duration_min: duration, display_order: i, bookable: true, is_active: true,
        });
      });
      log(`[seed] ${SERVICES.length} services created`);
    }

    /* FAQs (previously the FAQS array). Placeholders resolve at render time. */
    if (!contentRepo.listFaqs().length) {
      FAQS.forEach(([question, answer], i) =>
        contentRepo.createFaq({ question, answer, display_order: i, is_published: true }));
      log(`[seed] ${FAQS.length} FAQs created`);
    }

    /* Integration placeholders so the admin Integrations screen lists them */
    for (const p of ['whatsapp', 'google_business', 'smtp']) {
      if (!one('SELECT id FROM integrations WHERE provider = ?', p)) {
        run(`INSERT INTO integrations (provider, status) VALUES (?, 'not_configured')`, p);
      }
    }

    if (!one('SELECT id FROM review_sync_state WHERE id = 1')) {
      run('INSERT INTO review_sync_state (id, connected) VALUES (1, 0)');
    }
  });

  /* First admin user. Only from env, only when no users exist. */
  if (usersRepo.count() === 0) {
    const { email, password } = config.seedAdmin;
    if (email && password) {
      if (password.length < 12) {
        log('[seed] SEED_ADMIN_PASSWORD must be at least 12 characters — admin NOT created');
      } else {
        usersRepo.create({ email, name: 'Clinic Administrator', password, role: 'owner' });
        log(`[seed] owner account created: ${email}`);
      }
    } else {
      log('[seed] no admin user yet. Create one with: npm run create-admin');
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  seed();
  db.close();
  process.exit(0);
}
