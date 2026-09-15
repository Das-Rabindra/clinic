/**
 * Location-aware copy and treatment detail content.
 *
 * This lives in the seed path rather than in a .sql migration for an ordering
 * reason: migrations run *before* the seed, so on a fresh database an UPDATE
 * against clinic_settings or services matches nothing, is recorded as applied,
 * and never runs again. Applying it from the seed means it works on both a new
 * install and the deployed database that already holds these rows.
 *
 * Every write is guarded. Copy is replaced only while it is still the original
 * seeded text, and treatment fields only while they are still NULL, so anything
 * the clinic has edited in the admin panel survives a redeploy untouched.
 */
import { one, run, all } from '../repositories/base.js';

/* ── Site copy ─────────────────────────────────────────────────────────────
   Keyed by the exact text the first seed wrote. Once the clinic edits a field
   the guard stops matching and the field is left alone for good. */
const COPY_UPGRADES = [
  {
    when: { hero_eyebrow: 'Vikrampur, Housing Board · FCI' },
    set: {
      hero_eyebrow: 'Bikrampur · FCI Township, Talcher',
      hero_title: 'Modern dental care,\nclose to home in Talcher.',
      hero_lede: 'Samal Dental Care is a family dental clinic in Bikrampur, FCI Township, led by Dr. Sonali S. Samal (BDS, FRCD) — unhurried consultations, clear explanations, and treatment planned around you.',
      description: 'Samal Dental Care is a dental clinic in Bikrampur, FCI Township, Talcher, Odisha, led by Dr. Sonali S. Samal (BDS, FRCD), offering general, preventive, restorative and cosmetic dental treatment.',
    },
  },
  {
    when: { about_body: 'Dr. Sonali S. Samal holds a BDS and FRCD from Kalinga Institute of Dental Science, Bhubaneswar, and practises at Samal Dental Care in Vikrampur.' },
    set: {
      about_body: 'Dr. Sonali S. Samal holds a BDS and FRCD from Kalinga Institute of Dental Science, Bhubaneswar. She practises at Samal Dental Care in Bikrampur, FCI Township, and sees patients from across Talcher and the surrounding villages.',
    },
  },
  {
    when: { story_body: 'Samal Dental Care was set up to make quality dental treatment available close to home — with unhurried consultations, clear explanations, and modern equipment.' },
    set: {
      story_body: 'Samal Dental Care was set up to make quality dental treatment available close to home, so families in and around Talcher do not have to travel to a city for routine care — with unhurried consultations, clear explanations, and modern equipment.',
    },
  },
  {
    when: { services_lede: 'Treatments currently offered at Samal Dental Care. Book any of them directly from this page.' },
    set: {
      services_title: 'Dental treatments offered at the clinic',
      services_lede: 'Treatments currently offered at Samal Dental Care, for patients in Bikrampur, FCI Township, Talcher and nearby areas. Every one of them can be booked directly from this page.',
    },
  },
  {
    // Title and description carry the town, because that is the word patients
    // type. Kept short enough to render in full, and free of superlatives the
    // clinic cannot substantiate.
    when: { seo_title: 'Samal Dental Care — Dr. Sonali S. Samal, BDS, FRCD | Vikrampur' },
    set: {
      seo_title: 'Samal Dental Care — Dental Clinic in Talcher, Odisha',
      seo_description: 'Dental clinic in Bikrampur, FCI Township, Talcher, led by Dr. Sonali S. Samal (BDS, FRCD). Root canal, cleaning, fillings and family dental care. Book online.',
      og_title: 'Samal Dental Care — Dental Clinic in Bikrampur, FCI Township, Talcher',
      og_description: 'Led by Dr. Sonali S. Samal, BDS, FRCD. Book an appointment, call, or message the clinic on WhatsApp.',
    },
  },
];

/* Fields added after the first release: filled in only while still empty. */
const COPY_DEFAULTS = {
  treatments_eyebrow: 'Our Treatments',
  location_title: 'Finding the clinic',
  location_body: 'Samal Dental Care is in the Annapurna Market Complex at Bikrampur, inside the FCI township at Talcher. If you are coming from elsewhere in Talcher, open the directions below — or call the clinic and we will guide you in.',
  instagram_url: 'https://www.instagram.com/samaldentalcare',
};

/* The address the clinic gave: Bikrampur, FCI Twp, Talcher, Odisha. Split so
   each part lands in the right schema.org slot — address_line1 + area become
   streetAddress, city becomes addressLocality (the town people search for),
   and state becomes addressRegion. */
const ADDRESS = {
  address_line2: null,
  area: 'Bikrampur, FCI Township',
  city: 'Talcher',
  state: 'Odisha',
};

/* ── Treatment detail content ──────────────────────────────────────────────
   Only the eight treatments the clinic already lists. Implants, dentures,
   braces, aligners and smile-makeover work are deliberately absent: the clinic
   has not confirmed it offers them, and listing a treatment a patient cannot
   actually book is worse than listing fewer. */
const TREATMENTS = {
  'general-dentistry': {
    long_desc: 'General dentistry covers the routine care that stops everything else becoming urgent: check-ups, cleaning, small fillings, and practical advice on looking after your teeth at home. It is the usual starting point for a new patient at the clinic.',
    who_needs: 'Anyone who has not had a check-up in the last six to twelve months, or who has noticed something they are unsure about — a sensitive tooth, gums that bleed when brushed, a chipped edge, or a taste that will not clear.',
    what_to_expect: 'The dentist examines your teeth, gums and bite, and asks about anything you have noticed. If an X-ray would help, why it is needed is explained first. You leave knowing what is fine, what needs attention now, what can wait, and what it will cost — before anything is started.',
    benefits: 'Problems found while they are still small and inexpensive to treat\nA plan you can take away and decide on in your own time\nNothing begins until you have agreed to it',
    seo_title: 'General Dentistry in Talcher | Samal Dental Care',
    seo_description: 'Routine dental check-ups and general dental care at Samal Dental Care, Bikrampur, FCI Township, Talcher. Book a consultation with Dr. Sonali S. Samal.',
    is_featured: 1,
  },
  'dental-cleaning': {
    long_desc: 'Professional cleaning — often called scaling — lifts away the hardened plaque that builds up along the gum line and between teeth, where a brush cannot reach. For most patients it is the single most useful appointment for gum health.',
    who_needs: 'Gums that bleed when you brush, breath that does not freshen, or visible tartar and staining. Most people benefit from a cleaning once or twice a year even with no symptoms at all.',
    what_to_expect: 'An ultrasonic scaler loosens the deposits, then the teeth are polished smooth so plaque is slower to return. It usually takes about half an hour. Teeth can feel slightly sensitive for a day or two afterwards, which settles on its own.',
    benefits: 'Firmer gums that stop bleeding when brushed\nSurface staining from tea, coffee or tobacco lifted\nFresher breath\nEarly gum disease caught before it reaches the bone',
    seo_title: 'Dental Cleaning & Scaling in Talcher | Samal Dental Care',
    seo_description: 'Professional dental cleaning and scaling at Samal Dental Care in Bikrampur, FCI Township, Talcher. Around 30 minutes. Book online, call or WhatsApp.',
    is_featured: 1,
  },
  'dental-fillings': {
    long_desc: 'A filling repairs a tooth damaged by decay or a small fracture, rebuilding its shape so you can bite and chew normally again. Tooth-coloured composite is used, so the repair does not stand out.',
    who_needs: 'A tooth that twinges with cold or sweet food, a visible hole or dark spot, food that keeps packing into the same gap, or a chipped edge that catches your tongue.',
    what_to_expect: 'The tooth is numbed if needed, the decayed part is removed, and the cavity is filled and shaped to match the way your teeth meet. Most fillings take 30 to 45 minutes and you can eat normally the same day.',
    benefits: 'Stops decay spreading deeper into the tooth\nOften avoids the need for a root canal later on\nTooth-coloured material that blends in\nNormal biting and chewing restored in a single visit',
    seo_title: 'Dental Fillings in Talcher | Samal Dental Care',
    seo_description: 'Tooth-coloured dental fillings for cavities and chipped teeth at Samal Dental Care, Bikrampur, FCI Township, Talcher. Usually one visit. Book online.',
    is_featured: 1,
  },
  'root-canal-treatment': {
    long_desc: 'When decay or injury reaches the nerve inside a tooth, a root canal removes the infected tissue, cleans and seals the canal, and keeps the tooth in place. It is what makes saving the tooth possible instead of removing it.',
    who_needs: 'Persistent or throbbing toothache, pain that wakes you at night, sensitivity to heat that lingers after the heat is gone, swelling near the gum, or a tooth that has darkened after a knock.',
    what_to_expect: 'The tooth is numbed thoroughly before anything begins. The infected pulp is removed, and the canal is cleaned, shaped and sealed. Depending on the tooth this is one or two visits. A crown is usually recommended afterwards, because a root-treated tooth is more brittle than a healthy one.',
    benefits: 'Keeps your own tooth rather than replacing it\nRelieves the pain that brought you in\nStops the infection reaching the surrounding bone\nCarried out under local anaesthetic',
    seo_title: 'Root Canal Treatment in Talcher | Samal Dental Care',
    seo_description: 'Root canal treatment to save an infected or painful tooth, at Samal Dental Care in Bikrampur, FCI Township, Talcher. Book with Dr. Sonali S. Samal.',
    is_featured: 1,
  },
  'crowns-bridges': {
    long_desc: 'A crown is a cap that covers and protects a weakened tooth. A bridge uses the teeth on either side of a gap to hold a replacement tooth. Both restore the shape, strength and appearance of the bite.',
    who_needs: 'A tooth that has had a root canal, one that is heavily filled or has cracked, or a gap left by a missing tooth that is making chewing awkward on that side.',
    what_to_expect: 'At the first visit the tooth is prepared, an impression is taken and a temporary crown is fitted. The permanent crown is placed at a second visit and adjusted until your bite feels natural rather than sitting high.',
    benefits: 'A weakened or root-treated tooth protected from fracturing\nComfortable chewing on that side again\nShade matched to the teeth around it\nA gap closed without a removable plate',
    seo_title: 'Dental Crowns & Bridges in Talcher | Samal Dental Care',
    seo_description: 'Dental crowns and bridges to protect weakened teeth and close gaps, at Samal Dental Care, Bikrampur, FCI Township, Talcher. Book a consultation.',
    is_featured: 1,
  },
  'tooth-extraction': {
    long_desc: 'Removing a tooth is the last option, considered when it cannot be saved or is causing problems for the teeth around it. It is carried out under local anaesthetic, with clear aftercare to follow at home.',
    who_needs: 'A tooth broken below the gum line, decay too extensive to restore, severe looseness from gum disease, or a wisdom tooth that keeps causing pain or infection.',
    what_to_expect: 'The area is numbed completely — you feel pressure, not pain. Afterwards you are told exactly how to look after the socket: what to eat, what to avoid, and what is normal in the first 48 hours. If the tooth should be replaced, that is discussed at a follow-up rather than on the day.',
    benefits: 'Relief from a tooth that cannot be saved\nInfection stopped from spreading further\nClear aftercare, and a number to call if anything worries you\nReplacement options explained before you decide',
    seo_title: 'Tooth Extraction in Talcher | Samal Dental Care',
    seo_description: 'Safe tooth extraction under local anaesthetic at Samal Dental Care, Bikrampur, FCI Township, Talcher, with clear aftercare. Book online or call.',
    is_featured: 1,
  },
  'teeth-whitening': {
    long_desc: 'A cosmetic treatment that lightens the natural shade of your teeth. It works on the tooth itself, which is why an examination comes first — to establish whether whitening is the right answer for the discolouration you have noticed.',
    who_needs: 'Teeth that have gradually dulled or yellowed with age, tea, coffee or tobacco. Whitening does not change the colour of existing fillings, crowns or bridges, and some staining responds better to a cleaning than to whitening.',
    what_to_expect: 'Your gums are protected, then the whitening gel is applied and activated. The shade is recorded before and after, so the change is something you can see measured rather than take on trust. Some sensitivity for a day or two is common and settles.',
    benefits: 'A recorded before-and-after shade, not a vague promise\nAn examination first, so you are not paying for a treatment that will not work on your kind of staining\nNo drilling, and no change to the tooth structure itself',
    seo_title: 'Teeth Whitening in Talcher | Samal Dental Care',
    seo_description: 'Professional teeth whitening at Samal Dental Care, Bikrampur, FCI Township, Talcher, with a shade check before and after. Book a consultation.',
    is_featured: 0,
  },
  'pediatric-dentistry': {
    long_desc: 'Dental care for children — from a first check-up through to fillings and preventive treatment — at a pace that lets a child get used to the chair before anything needs doing.',
    who_needs: 'Children from around their first birthday onwards. A first visit when nothing is wrong is by far the easiest introduction; after that a check every six months catches decay in milk teeth before it starts to hurt.',
    what_to_expect: 'The first appointment is mostly counting teeth and letting your child sit in the chair and see the instruments. When treatment is needed it is explained to them in words they understand. A parent stays in the room throughout.',
    benefits: 'A first visit that is not frightening\nDecay in milk teeth caught before it becomes painful\nPractical advice on brushing and on sugary drinks\nA parent present for the whole appointment',
    seo_title: "Children's Dentistry in Talcher | Samal Dental Care",
    seo_description: 'Gentle dental care for children at Samal Dental Care, Bikrampur, FCI Township, Talcher. Check-ups, cleaning and fillings for younger patients.',
    is_featured: 0,
  },
};

/* ── Local FAQs ────────────────────────────────────────────────────────────
   Matched on the question text, so re-running never duplicates them and a
   question the clinic has deleted stays deleted. */
const LOCAL_FAQS = [
  ['Where exactly is the clinic in Talcher?',
    'Samal Dental Care is at the Annapurna Market Complex, Bikrampur, inside the FCI township at Talcher, Odisha 759106. The "Get Directions" button on this page opens the exact location in Google Maps.'],
  ['What are the clinic timings?',
    'The clinic is open every day from 8:00 AM to 9:00 PM, with a break between 1:00 PM and 3:00 PM. The weekly table on this page always shows the current hours, and any holiday closure appears there too.'],
  ['Do you treat children?',
    "Yes. Children's dentistry is one of the treatments offered, covering check-ups, cleaning and fillings for younger patients. An appointment earlier in the day usually suits children better."],
  ['How long does a first consultation take?',
    'A consultation is normally booked for 30 minutes — enough time to examine your teeth and gums, discuss what you have noticed, and explain what treatment, if any, would help. Longer treatments are booked as separate appointments.'],
  ['Can I reschedule or cancel an appointment?',
    'Yes. Your confirmation carries a booking reference; use it with your mobile number to cancel online, or simply call or message the clinic on WhatsApp. Letting us know early frees the slot for another patient.'],
];

/** Apply every guarded content upgrade. Safe to call on each boot. */
export async function applyContent({ log = console.log } = {}) {
  const settings = await one('SELECT * FROM clinic_settings WHERE id = 1');
  if (!settings) return;

  let copyChanged = 0;
  for (const { when, set } of COPY_UPGRADES) {
    const [[field, expected]] = Object.entries(when);
    if (settings[field] !== expected) continue;
    for (const [k, v] of Object.entries(set)) {
      await run(`UPDATE clinic_settings SET ${k} = ?, updated_at = NOW() WHERE id = 1`, v);
    }
    copyChanged++;
  }

  for (const [k, v] of Object.entries(COPY_DEFAULTS)) {
    if (settings[k] == null || settings[k] === '') {
      await run(`UPDATE clinic_settings SET ${k} = ?, updated_at = NOW() WHERE id = 1`, v);
      copyChanged++;
    }
  }

  /* The address is corrected outright rather than guarded: the clinic supplied
     it directly, and the previous rows recorded no town or state at all. */
  if (settings.city !== ADDRESS.city || settings.area !== ADDRESS.area) {
    await run(
      `UPDATE clinic_settings SET address_line2 = @address_line2, area = @area,
         city = @city, state = @state, updated_at = NOW() WHERE id = 1`, ADDRESS);
    copyChanged++;
  }
  if (copyChanged) log(`[content] ${copyChanged} copy field group(s) updated`);

  let treatments = 0;
  for (const [slug, t] of Object.entries(TREATMENTS)) {
    const svc = await one('SELECT * FROM services WHERE slug = ? AND deleted_at IS NULL', slug);
    if (!svc) continue;
    const fields = Object.entries(t).filter(([k]) => k !== 'is_featured' && svc[k] == null);
    if (svc.is_featured !== t.is_featured && svc.updated_at === svc.created_at) {
      fields.push(['is_featured', t.is_featured]);
    }
    for (const [k, v] of fields) {
      await run(`UPDATE services SET ${k} = ?, updated_at = NOW() WHERE id = ?`, v, svc.id);
    }
    if (fields.length) treatments++;
  }
  if (treatments) log(`[content] detail content added to ${treatments} treatment(s)`);

  const existing = new Set((await all('SELECT question FROM faqs')).map(f => f.question));
  let faqs = 0;
  for (const [i, [question, answer]] of LOCAL_FAQS.entries()) {
    if (existing.has(question)) continue;
    await run(
      'INSERT INTO faqs (question, answer, display_order, is_published) VALUES (?, ?, ?, 1)',
      question, answer, 10 + i);
    faqs++;
  }
  if (faqs) log(`[content] ${faqs} local FAQ(s) added`);
}
