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
import * as servicesRepo from '../repositories/services.repo.js';

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

/*
 * Contact details and map position.
 *
 * 8847879686 is the primary line: every tel: link, the header, the sticky bar,
 * WhatsApp and the structured data read from it. The older 9124839288 is kept
 * and published as an alternative rather than dropped — it has been on cards,
 * signage and Google for months, and patients still dial it.
 *
 * The coordinates come from the clinic's own Google Maps listing, so the map
 * drops an exact pin and "Get Directions" routes to the door instead of to a
 * geocoded guess at the street name.
 */
const CONTACT = {
  phone: '8847879686',
  phone_intl: '+918847879686',
  whatsapp: '918847879686',
  phone_secondary: '9124839288',
  phone_secondary_intl: '+919124839288',
  latitude: 20.9033969,
  longitude: 85.1743727,
  maps_url: 'https://maps.app.goo.gl/9SURk8sfiWBojto18',
};

/* Open 9:00 AM to 10:00 PM every day, with the clinic's 1:00-3:00 PM break.
   The break is held separately from opening hours: the clinic asked for it
   explicitly, and it only removes those slots from the booking grid. */
const HOURS = { open_min: 540, close_min: 1320, break_start_min: 780, break_end_min: 900 };

/* Fields added after the first release: filled in only while still empty. */
const COPY_DEFAULTS = {
  treatments_eyebrow: 'Our Treatments',
  location_title: 'Finding the clinic',
  location_body: 'Samal Dental Care is in the Annapurna Market Complex at Bikrampur, inside the FCI township at Talcher. The map below carries the clinic\u2019s exact position, so "Get Directions" will route you to the door. If you would rather be talked in, call and we will guide you.',
  /* The supplied card already carries "Check us out on Google" and the clinic
     name, so the heading beside it must not say the same thing twice. */
  review_qr_title: 'Found the clinic helpful?',
  review_qr_body: 'A review helps the next person in Talcher decide where to go. Point your phone camera at the code and it opens the review page \u2014 it takes a minute, and you do not need an appointment to leave one.',
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

/* ── Treatments the clinic offers but the original site never listed ───────
   Implants, orthodontics and aesthetic dentistry came from the clinic's own
   opening material; dentures, wisdom teeth and gum treatment were confirmed
   directly. Each is created only when no service with that slug exists at all —
   including a soft-deleted one — so removing a treatment from the admin panel
   keeps it removed.

   All three are booked as an assessment rather than as the procedure itself:
   none of them can responsibly begin before an examination, and the copy below
   says so. */
const ADDED_TREATMENTS = [
  {
    slug: 'dental-implants', name: 'Dental Implants', category: 'Restorative',
    short_desc: 'A replacement for a missing tooth that sits in the jaw like a natural root.',
    duration_min: 45,
  },
  {
    slug: 'braces-aligners', name: 'Braces & Aligners', category: 'Orthodontics',
    short_desc: 'Straightening crowded, gapped or protruding teeth with braces or clear aligners.',
    duration_min: 45,
  },
  {
    slug: 'aesthetic-dentistry', name: 'Aesthetic Dentistry', category: 'Cosmetic',
    short_desc: 'Improving how your teeth look — their shape, their colour, and how they sit together.',
    duration_min: 45,
  },
  {
    slug: 'dentures', name: 'Dentures', category: 'Restorative',
    short_desc: 'Removable replacements for several missing teeth, or for a whole arch.',
    duration_min: 45,
  },
  {
    slug: 'wisdom-tooth', name: 'Wisdom Tooth', category: 'Surgical',
    short_desc: 'Assessment and, where it is genuinely needed, removal of a wisdom tooth.',
    duration_min: 45,
  },
  {
    slug: 'gum-treatment', name: 'Gum Treatment', category: 'Gum Care',
    short_desc: 'Treatment for gums that bleed, recede or feel sore, and for the bone beneath them.',
    duration_min: 45,
  },
  {
    /* The clinic trades until 10 PM every day, which is unusual and is exactly
       what someone in pain at night is searching for. Nothing on the site
       addressed pain at all. */
    slug: 'dental-emergency', name: 'Emergency Dental Care', category: 'Urgent',
    short_desc: 'Toothache, swelling, a broken tooth or a knocked-out tooth — seen the same day where possible.',
    duration_min: 30, featured: true,
  },
];

/* ── Treatment detail content ────────────────────────────────────────────── */
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
  'dental-implants': {
    long_desc: 'An implant is a small titanium post placed in the jawbone to take the place of a missing tooth\u2019s root. Once the bone has grown around it, a crown is fitted on top. Unlike a bridge it does not rely on the teeth either side, and unlike a denture it does not come out.',
    who_needs: 'A missing tooth, or several — from an extraction, an injury, or a gap you have lived with for years. Whether an implant is possible depends on how much bone is there and on the health of your gums, which is exactly what the first appointment establishes.',
    what_to_expect: 'The first visit is an assessment, not surgery: an examination, X-rays, and an honest discussion of whether an implant, a bridge or a denture suits your situation better. If you go ahead, the post is placed under local anaesthetic and then left to integrate with the bone for a few months before the crown is made. This is a treatment measured in months rather than visits.',
    benefits: 'Fills the gap without cutting down the healthy teeth on either side\nNothing to take out at night\nChewing and speaking feel closer to a natural tooth\nHelps preserve the jawbone, which shrinks where a tooth is missing',
    seo_title: 'Dental Implants in Talcher | Samal Dental Care',
    seo_description: 'Dental implants to replace missing teeth at Samal Dental Care, Bikrampur, FCI Township, Talcher. Book an assessment with Dr. Sonali S. Samal.',
    is_featured: 1,
  },
  'braces-aligners': {
    long_desc: 'Orthodontic treatment moves teeth gradually into better alignment — with fixed braces, or with a series of clear removable aligners. Which of the two suits you depends on how much movement is needed and on what you are willing to wear day to day.',
    who_needs: 'Crowded or overlapping teeth, gaps, teeth that stick out, or a bite where the upper and lower teeth do not meet evenly. Children are usually assessed once the adult teeth are coming through, but there is no upper age limit — adults are treated too.',
    what_to_expect: 'The first appointment is an assessment: photographs, an impression or scan, X-rays, and then a discussion of the options with how long each would take and what each costs. Treatment itself runs over months to a couple of years, with a short adjustment appointment every few weeks. Retainers afterwards are part of the treatment, not an optional extra — teeth drift back without them.',
    benefits: 'Teeth that are easier to clean, which lowers the risk of decay and gum disease\nA bite that spreads the load evenly instead of wearing down particular teeth\nA written plan with a timescale and a cost before you commit to anything\nClear aligners as an option where they suit the movement needed',
    seo_title: 'Braces & Clear Aligners in Talcher | Samal Dental Care',
    seo_description: 'Orthodontic treatment with braces or clear aligners at Samal Dental Care, Bikrampur, FCI Township, Talcher. Book an orthodontic assessment.',
    is_featured: 1,
  },
  'aesthetic-dentistry': {
    long_desc: 'Aesthetic dentistry covers the treatments aimed at how a smile looks rather than at pain or disease: reshaping a chipped or uneven edge, closing a small gap, replacing old dark fillings with tooth-coloured ones, veneers, and whitening. Most plans combine more than one of these.',
    who_needs: 'A tooth that is chipped, uneven, discoloured or out of line with the rest; old grey fillings that show when you smile; or a small gap you would rather not have. What is realistically achievable depends on the teeth you already have, so it begins with an examination.',
    what_to_expect: 'It helps to come able to say which tooth bothers you rather than describe the smile in general. The dentist examines your teeth and gums, explains what can and cannot be changed, and sets out the options with costs against each. Anything that permanently alters tooth structure — a veneer, for instance — is explained in full before it is started, because it cannot be undone.',
    benefits: 'A straight answer about what can be changed, before anything is begun\nTooth-coloured materials matched to the shade of your own teeth\nDecay and gum problems treated first — appearance work belongs on a sound tooth\nCosts set out per option, so you can choose how far to go',
    seo_title: 'Aesthetic & Cosmetic Dentistry in Talcher | Samal Dental Care',
    seo_description: 'Aesthetic dentistry at Samal Dental Care, Bikrampur, FCI Township, Talcher — reshaping, veneers, tooth-coloured restorations and whitening.',
    is_featured: 0,
  },
  dentures: {
    long_desc: 'A denture replaces missing teeth with a removable plate. It can be partial — filling the gaps while your own remaining teeth stay where they are — or complete, replacing a whole upper or lower arch. Of the ways to replace several teeth it is the one that needs no surgery and takes the least time.',
    who_needs: 'Several missing teeth, or a full arch gone. It is also a sensible choice where an implant or a bridge is not possible: too little bone, gum disease that has to settle first, or simply a preference for something that does not involve surgery.',
    what_to_expect: 'Impressions are taken and the denture is built to fit your mouth over several appointments, with a try-in before it is finished so the look and the bite can be adjusted while that is still easy. A new denture always feels bulky at first and takes a few weeks to get used to — softer food and reading aloud both help. Small adjustments in the first month are expected, not a sign that something has gone wrong.',
    benefits: 'Replaces several teeth at once, with no surgery\nChewing and speech improve as you adapt to it\nCan be relined or adjusted as the gums change shape over the years\nThe least invasive way to close a large gap',
    seo_title: 'Dentures in Talcher | Samal Dental Care',
    seo_description: 'Partial and complete dentures at Samal Dental Care, Bikrampur, FCI Township, Talcher. Book a consultation with Dr. Sonali S. Samal.',
    is_featured: 0,
  },
  'wisdom-tooth': {
    long_desc: 'Wisdom teeth are the last to come through, usually in the late teens or twenties. Many cause no trouble at all and are best left alone. Removal is considered when one is repeatedly infected, is decayed in a spot no brush can reach, or is pressing against the tooth in front of it.',
    who_needs: 'Pain or swelling at the back of the jaw, a flap of gum that keeps getting sore, a bad taste that keeps returning, difficulty opening your mouth fully, or food packing behind the last tooth. A wisdom tooth that is through and causing none of this usually does not need removing.',
    what_to_expect: 'The first appointment is an examination and an X-ray to see the tooth\u2019s position and the shape of its roots, which is what determines how straightforward removal would be. Not every wisdom tooth needs to come out, and you will be told plainly if yours does not. If it does, it is done under local anaesthetic, with the aftercare explained and a number to call if anything worries you.',
    benefits: 'An X-ray assessment before anything is decided\nA straight answer on whether removal is actually needed\nAn end to the cycle of infection and the pain that comes with it\nThe tooth in front protected where it is being pressed on',
    seo_title: 'Wisdom Tooth Removal in Talcher | Samal Dental Care',
    seo_description: 'Wisdom tooth assessment and removal at Samal Dental Care, Bikrampur, FCI Township, Talcher. X-ray first, then a clear recommendation.',
    is_featured: 0,
  },
  'gum-treatment': {
    long_desc: 'Gum disease begins as inflammation that bleeds when you brush and, left alone, goes on to affect the bone holding the teeth in place. Caught at the early stage it is reversible. Further along it can be halted and kept under control, but bone already lost does not grow back — which is exactly why the early stage is worth acting on.',
    who_needs: 'Gums that bleed when you brush or eat, that look red or puffy, breath that will not freshen, gums that have shrunk back so the teeth look longer, or a tooth that has begun to feel slightly loose.',
    what_to_expect: 'The gum is measured around each tooth to record how deep the pockets are. That measurement is what separates reversible inflammation from established disease, and it is repeated later to show whether the treatment is working. Cleaning then goes below the gum line, sometimes across more than one appointment and with the area numbed. Most of the result after that depends on cleaning at home, which is why time is spent working through technique with you rather than simply advising you to brush more.',
    benefits: 'A recorded measurement, so progress is something you can see rather than take on trust\nBleeding and soreness settle as the inflammation resolves\nFurther bone loss halted, which is what keeps the teeth in place\nCleaning technique worked through with you, not just recommended',
    seo_title: 'Gum Treatment in Talcher | Samal Dental Care',
    seo_description: 'Treatment for bleeding and receding gums at Samal Dental Care, Bikrampur, FCI Township, Talcher. Book a gum assessment with Dr. Sonali S. Samal.',
    is_featured: 1,
  },
  'dental-emergency': {
    long_desc: 'Dental problems rarely wait for a convenient moment. The clinic is open until 10 PM every day, including Sunday, and keeps room for urgent cases. If something has broken, swollen or started to throb, call rather than wait for it to settle \u2014 most of what makes a dental emergency worse is time.',
    who_needs: 'Toothache that will not settle or wakes you at night; facial swelling; a tooth knocked out or broken; a crown or filling that has come out; bleeding that will not stop after an extraction; or an injury to the mouth. Swelling that is spreading towards the eye or the throat, or that makes swallowing or breathing difficult, is a hospital matter \u2014 go to A&E, do not wait for a dental appointment.',
    what_to_expect: 'Call first so the clinic knows what is coming and can tell you what to do meanwhile. You will be seen the same day where the diagnosis allows it. The first visit is about settling the pain and controlling any infection; the definitive treatment \u2014 a root canal, a crown, an extraction \u2014 is planned once you are comfortable rather than decided while you are in pain.',
    benefits: 'Open until 10:00 PM every day, Sunday included\nSame-day appointments kept free for urgent problems\nPain and infection dealt with first, treatment decided after\nClear advice on the phone about what to do before you arrive',
    seo_title: 'Emergency Dentist in Talcher \u2014 Open till 10 PM | Samal Dental Care',
    seo_description: 'Toothache, swelling or a broken tooth in Talcher? Samal Dental Care is open until 10 PM every day at Bikrampur, FCI Township. Call 8847879686.',
    is_featured: 1,
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

/* ── Related treatments ────────────────────────────────────────────────────
   Pairs a dentist would actually suggest, rather than the first three featured
   treatments, which is what every page showed. */
const RELATED = {
  'general-dentistry':    'dental-cleaning,dental-fillings,gum-treatment',
  'dental-cleaning':      'gum-treatment,general-dentistry,teeth-whitening',
  'dental-fillings':      'root-canal-treatment,crowns-bridges,general-dentistry',
  'root-canal-treatment': 'crowns-bridges,dental-fillings,tooth-extraction',
  'crowns-bridges':       'root-canal-treatment,dental-implants,dentures',
  'tooth-extraction':     'dental-implants,dentures,wisdom-tooth',
  'wisdom-tooth':         'tooth-extraction,general-dentistry,gum-treatment',
  'dental-implants':      'crowns-bridges,dentures,tooth-extraction',
  'dentures':             'dental-implants,crowns-bridges,tooth-extraction',
  'gum-treatment':        'dental-cleaning,general-dentistry,tooth-extraction',
  'teeth-whitening':      'aesthetic-dentistry,dental-cleaning,crowns-bridges',
  'aesthetic-dentistry':  'teeth-whitening,crowns-bridges,braces-aligners',
  'braces-aligners':      'aesthetic-dentistry,general-dentistry,dental-cleaning',
  'pediatric-dentistry':  'general-dentistry,dental-cleaning,dental-fillings',
  'dental-emergency':     'root-canal-treatment,tooth-extraction,dental-fillings',
};

/* ── Questions patients ask about each treatment ───────────────────────────
   Every page previously carried the same five site-wide questions, which
   answered nothing about the treatment and duplicated across fourteen indexed
   URLs. These are the questions a dentist actually gets asked. */
const SERVICE_FAQS = {
  'root-canal-treatment': [
    ['Does a root canal hurt?',
      'The tooth is numbed thoroughly first, so the treatment itself should not hurt \u2014 most patients say it felt like having a long filling. What hurts is the infection beforehand, which is what the treatment removes. The tooth can feel tender to bite on for a few days afterwards.'],
    ['How many visits does it take?',
      'One or two, depending on the tooth and how infected it is. A front tooth with a single canal is often done in one; a back molar with three or four canals usually takes two.'],
    ['Will I need a crown afterwards?',
      'Usually, on a back tooth. A root-treated tooth has had its blood supply removed and becomes more brittle, so it is prone to splitting under chewing. A crown holds it together. Front teeth sometimes manage without.'],
    ['Is it better to just take the tooth out?',
      'Extraction is quicker and cheaper on the day, but the gap then needs filling with an implant or a bridge, which costs more than the root canal did. Keeping your own tooth is almost always the better long-term answer where it is possible.'],
  ],
  'dental-implants': [
    ['How long does the whole process take?',
      'Three to six months in most cases. The post is placed, then left to fuse with the bone before the crown goes on. You are not without a tooth for that time \u2014 a temporary is usually fitted.'],
    ['Does placing an implant hurt?',
      'It is done under local anaesthetic, like an extraction. Most people describe the discomfort afterwards as less than they expected, and manageable with ordinary painkillers for a day or two.'],
    ['Am I suitable for an implant?',
      'It depends on how much bone is there and on the health of your gums, which is what the first appointment establishes with an examination and X-rays. Gum disease has to be treated first. Smoking lowers the success rate and we will be straight with you about that.'],
    ['How long does an implant last?',
      'Implants regularly last decades, but they are not maintenance-free: they can be lost to gum disease the same way a natural tooth can. Cleaning around them properly is what decides it.'],
  ],
  'dentures': [
    ['How long do dentures last?',
      'Five to ten years is typical, but the fit changes sooner than that because the gum and bone underneath shrink after teeth are lost. A reline every few years keeps them fitting rather than replacing them outright.'],
    ['Will I be able to eat normally?',
      'Not immediately. Start with softer food cut small, chew on both sides at once, and build up over a few weeks. Most people manage most things eventually, though very hard or sticky food stays awkward.'],
    ['Will people be able to tell?',
      'Modern dentures are made to match your own tooth shade and face. The giveaway is usually movement rather than appearance, which is what a good fit and, where suitable, implant retention are for.'],
    ['Do I take them out at night?',
      'Yes. Leaving them out overnight lets the gum tissue recover and lowers the risk of fungal infection. Keep them in water so they do not dry out and warp.'],
  ],
  'gum-treatment': [
    ['Will my gums stop bleeding?',
      'In early gum disease, usually within a week or two of the cleaning plus proper brushing and cleaning between the teeth. Bleeding is inflammation, and inflammation settles once the deposits causing it are gone.'],
    ['Can I lose teeth from gum disease?',
      'Yes \u2014 it is the most common reason adults lose teeth, and it is usually painless until late. The bone holding the teeth shrinks away quietly. That is why the measurement at the first visit matters.'],
    ['Is the treatment painful?',
      'Cleaning above the gum line is not. Cleaning below it, where the pockets are deep, is done with the area numbed. Teeth often feel more sensitive for a week or so afterwards as the gum tightens back.'],
    ['Will the bone grow back?',
      'No. Treatment stops further loss and settles the inflammation, but bone already lost does not return. That is the honest reason to come in early rather than wait.'],
  ],
  'teeth-whitening': [
    ['How much whiter will my teeth get?',
      'It varies with the kind of staining and the starting shade, which is why the shade is recorded before and after rather than promised in advance. Yellowish staining lifts well; greyish discolouration responds less.'],
    ['Will it damage my teeth?',
      'Whitening at professional concentrations, with the gums protected, does not soften or weaken enamel. Sensitivity for a day or two is common and settles. Shop-bought kits used repeatedly are the greater risk.'],
    ['How long does it last?',
      'Typically one to two years, depending on tea, coffee and tobacco. Top-ups are straightforward once the first treatment is done.'],
    ['Will my fillings and crowns whiten too?',
      'No \u2014 whitening works on natural tooth, not on restorative materials. If you have a visible filling or crown it may need replacing afterwards to match the new shade, and that is worth planning before you start.'],
  ],
  'braces-aligners': [
    ['How long will treatment take?',
      'Months to a couple of years, depending on how far the teeth have to move. You will be given a realistic range at the assessment, not an optimistic one.'],
    ['Braces or clear aligners \u2014 which is better?',
      'Braces handle more movement and do not rely on you remembering anything. Aligners are less visible and come out for meals, but only work if worn around 22 hours a day. The choice depends on the movement needed and on you being honest about the wearing.'],
    ['Am I too old for braces?',
      'No. Teeth move at any age, provided the gums and bone are healthy. Adults make up a growing share of orthodontic patients.'],
    ['Do I really have to wear a retainer afterwards?',
      'Yes, and indefinitely. Teeth drift back toward where they started \u2014 that is not a failure of the treatment, it is how teeth behave. Retainers are part of the treatment, not an optional extra.'],
  ],
  'tooth-extraction': [
    ['How long does it take to heal?',
      'The socket closes over in about a week and the gum heals in two to three. The bone underneath takes a few months to fill in, which matters if you are planning an implant.'],
    ['What should I avoid afterwards?',
      'No rinsing, spitting or smoking for 24 hours \u2014 all three can dislodge the clot and leave a dry socket, which is genuinely painful. No hot drinks and nothing through a straw on the first day.'],
    ['Should I replace the tooth?',
      'A back tooth that nobody sees can sometimes be left, but the teeth either side tend to tilt into the gap over time and the bite changes. We will set out the options \u2014 implant, bridge or denture \u2014 at a follow-up, not on the day.'],
  ],
  'wisdom-tooth': [
    ['Do all wisdom teeth need removing?',
      'No, and most do not. One that has come through straight, bites properly and can be cleaned is best left alone. Removal is for the ones causing repeated infection, decay or pressure on the tooth in front.'],
    ['How bad is the recovery?',
      'Expect swelling and soreness for two to three days, peaking around day two, and a stiff jaw for a few days after that. A straightforward upper wisdom tooth is usually much easier than a lower one that is lying on its side.'],
    ['Why does the gum keep getting sore?',
      'A partly erupted wisdom tooth leaves a flap of gum over it that traps food and bacteria and cannot be cleaned properly. That is pericoronitis, and it tends to recur until the tooth is either fully through or removed.'],
  ],
  'dental-fillings': [
    ['How long does a filling last?',
      'Commonly five to ten years, sometimes much longer. It depends on the size of the filling, where it is in the mouth, and how heavily you grind or clench.'],
    ['Can I eat straight afterwards?',
      'Yes with a composite filling, which is set hard before you leave. Wait until the numbness has worn off though, or you will bite your cheek without feeling it.'],
    ['Why does my tooth still twinge afterwards?',
      'A deep filling can leave the nerve irritated for a few weeks. That usually settles. If it gets worse, lingers after hot or cold, or wakes you at night, come back \u2014 that can mean the nerve is not recovering.'],
  ],
  'dental-cleaning': [
    ['How often do I need a cleaning?',
      'Once or twice a year suits most people. More often if you have had gum disease, smoke, or build up tartar quickly \u2014 that varies far more between people than most expect.'],
    ['Will it make my teeth whiter?',
      'It removes surface staining from tea, coffee and tobacco, so teeth often look brighter. It does not change the natural shade of the tooth underneath \u2014 that is whitening, which is a separate treatment.'],
    ['Does scaling damage enamel or loosen teeth?',
      'No. The scaler removes deposits, not tooth. Teeth can feel slightly looser briefly after a deep clean because the inflamed gum tightens as it heals \u2014 that is recovery, not damage.'],
  ],
  'crowns-bridges': [
    ['How long do crowns and bridges last?',
      'Ten to fifteen years is typical, and often longer. What usually fails is not the crown itself but new decay at its edge, so cleaning that margin properly is what decides its life.'],
    ['Does the tooth have to be filed down?',
      'Yes, for a crown \u2014 enough to make room for the material without the tooth feeling bulky. That is irreversible, which is why it is only recommended where the tooth genuinely needs the protection.'],
    ['Bridge or implant?',
      'A bridge is quicker and needs no surgery, but it means preparing the healthy teeth either side. An implant leaves them untouched but takes months and costs more. Both are explained with the trade-offs before you choose.'],
  ],
  'pediatric-dentistry': [
    ['When should my child first see a dentist?',
      'Around their first birthday, or within six months of the first tooth. The first visit is mostly about getting them comfortable, not treatment.'],
    ['Do milk teeth need filling if they fall out anyway?',
      'Often yes. Decay in a milk tooth causes the same pain and infection as in an adult one, and losing it too early lets the other teeth drift and crowd the adult tooth coming behind it.'],
    ['How do I stop my child being frightened?',
      'Bring them along to your own appointment first so the place is familiar. Avoid words like "hurt", "needle" or "pull" even in reassurance \u2014 children hear the word, not the reassurance. We explain things to them in their own terms.'],
  ],
  'general-dentistry': [
    ['How often should I have a check-up?',
      'Every six months for most adults. Someone with healthy teeth and gums and no risk factors may be fine annually; someone with a history of decay or gum disease may need to come more often.'],
    ['What happens at a check-up?',
      'An examination of the teeth, gums and bite, a look at the soft tissues, and X-rays where they would show something an examination cannot. You leave knowing what is fine, what needs attention, and what it costs.'],
    ['Nothing hurts \u2014 do I still need to come?',
      'Decay and gum disease are both painless until they are advanced. By the time a tooth hurts, the cheap fix has usually passed. That is the whole argument for check-ups.'],
  ],
  'dental-emergency': [
    ['My tooth is throbbing \u2014 what can I do right now?',
      'Take the painkiller you would normally use for a headache, at the dose on the packet. Keep your head raised, including at night. Avoid very hot or very cold food on that side. Do not hold an aspirin against the gum \u2014 it burns the tissue and does not help the tooth. Then call, because painkillers mask a problem that is still progressing.'],
    ['My tooth has been knocked out. Can it be put back?',
      'Sometimes, if you act fast. Hold it by the crown, never the root. If it is dirty, rinse it briefly in milk or saline \u2014 not tap water, and do not scrub it. Push it gently back into the socket if you can and bite on a clean cloth; if not, keep it in milk and come straight away. The first hour matters more than anything else. Milk teeth are not replanted.'],
    ['How do I know if it is an emergency or can wait until morning?',
      'Call and we will tell you honestly. Pain that is manageable with painkillers usually can wait a few hours. Swelling, especially swelling that is spreading or closing your eye, cannot. Swelling that affects swallowing or breathing is a hospital emergency \u2014 go to A&E immediately rather than waiting for a dentist.'],
    ['Will I be seen the same day?',
      'Where the problem is genuinely urgent, usually yes \u2014 time is kept free each day for exactly this. The clinic is open until 10 PM every day including Sunday, which is why calling is better than guessing.'],
  ],
  'aesthetic-dentistry': [
    ['Is it permanent?',
      'It depends what is done. Whitening and bonding are reversible or easily redone. Veneers and crowns involve removing tooth structure and cannot be undone \u2014 that is explained in full before anything starts.'],
    ['Will it look obvious?',
      'It should not. The shade is matched to your own teeth and the shape to your face. The common mistake is going too white and too uniform, which is exactly what makes dental work noticeable.'],
    ['Can anything be done without drilling?',
      'Often, yes \u2014 whitening, bonding and reshaping an edge all leave the tooth essentially intact. Those are the options discussed first.'],
  ],
};

/* ── Local FAQs ────────────────────────────────────────────────────────────
   Matched on the question text, so re-running never duplicates them and a
   question the clinic has deleted stays deleted. */
const LOCAL_FAQS = [
  ['Where exactly is the clinic in Talcher?',
    'Samal Dental Care is at the Annapurna Market Complex, Bikrampur, inside the FCI township at Talcher, Odisha 759106. The "Get Directions" button on this page opens the clinic\u2019s exact position in Google Maps, so it routes you to the door rather than to the street.'],
  ['What are the clinic timings?',
    'The clinic is open {{hours}}. The weekly table on this page always shows the current hours, and any holiday closure appears there too.'],
  ['Which number should I call?',
    'Call {{phone}} \u2014 that is the main line, and it is also the number on WhatsApp. {{phone2}} still works as a second line if the first is engaged.'],
  ['Can I message the clinic on WhatsApp?',
    'Yes. WhatsApp {{phone}} and the clinic will reply during opening hours. It is the easiest way to ask a question before committing to an appointment. Please do not send anything urgent by message \u2014 call instead.'],
  ['Do you treat children?',
    "Yes. Children's dentistry is one of the treatments offered, covering check-ups, cleaning and fillings for younger patients. An appointment earlier in the day usually suits children better."],
  ['How long does a first consultation take?',
    'A consultation is normally booked for 30 minutes \u2014 enough time to examine your teeth and gums, discuss what you have noticed, and explain what treatment, if any, would help. Longer treatments are booked as separate appointments.'],
  ['What if I would rather the clinic called me?',
    'Use "Request a call back" on this page. Leave your name and number, and say which treatment you are asking about if you know. The clinic will ring you back during opening hours \u2014 there is nothing to pay and no obligation.'],
  ['Which treatments can I book online?',
    'Every treatment listed on this page can be booked online, from a routine check-up and cleaning through fillings, root canals, crowns, extractions and dentures to implants, braces, whitening and gum treatment. Implants, braces and aesthetic work start with an assessment rather than the procedure itself.'],
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

  /* Contact details and map position, likewise supplied directly. Applied only
     while the old number is still the primary, so a later change made in the
     admin panel is not reverted on the next boot. */
  if (settings.phone === '9124839288') {
    await run(
      `UPDATE clinic_settings SET phone = @phone, phone_intl = @phone_intl,
         whatsapp = @whatsapp, phone_secondary = @phone_secondary,
         phone_secondary_intl = @phone_secondary_intl, updated_at = NOW()
       WHERE id = 1`, CONTACT);
    log('[content] primary number set to 8847879686, previous number kept as secondary');
    copyChanged++;
  }
  if (settings.latitude == null || settings.longitude == null) {
    await run(
      `UPDATE clinic_settings SET latitude = @latitude, longitude = @longitude,
         maps_url = COALESCE(NULLIF(maps_url, ''), @maps_url), updated_at = NOW()
       WHERE id = 1`, CONTACT);
    log('[content] map coordinates set from the clinic\u2019s Google listing');
    copyChanged++;
  }
  if (copyChanged) log(`[content] ${copyChanged} copy field group(s) updated`);

  /*
   * Opening hours. Rewritten only while every day still matches the previous
   * 8:00-9:00 default, so a clinic that has since edited one day in the admin
   * panel keeps its own grid.
   */
  const hours = await all('SELECT * FROM clinic_hours ORDER BY weekday');
  const allOldDefault = hours.length === 7
    && hours.every(h => h.open_min === 480 && h.close_min === 1260 && h.is_open === 1);
  if (allOldDefault) {
    for (const h of hours) {
      await run(
        `UPDATE clinic_hours SET open_min = @open_min, close_min = @close_min,
           break_start_min = @break_start_min, break_end_min = @break_end_min,
           updated_at = NOW() WHERE weekday = @weekday`,
        { ...HOURS, weekday: h.weekday });
    }
    log('[content] opening hours set to 9:00 AM - 10:00 PM every day (1:00-3:00 PM break)');
  }

  /* Create the treatments the original site never listed. The existence check
     deliberately ignores deleted_at: a soft-deleted service still holds the
     slug, and re-creating one the clinic has removed would both resurrect it
     and collide with the unique index. */
  let added = 0;
  for (const t of ADDED_TREATMENTS) {
    if (await one('SELECT id FROM services WHERE slug = ?', t.slug)) continue;
    const category = await servicesRepo.ensureCategory(t.category);
    const created = await servicesRepo.create({
      name: t.name, slug: t.slug, category_id: category.id, short_desc: t.short_desc,
      duration_min: t.duration_min, bookable: true, is_active: true,
    });
    /* servicesRepo.create() derives the slug from the name. If that ever stops
       matching, the detail content below would silently never attach, so say
       so loudly rather than shipping an empty treatment page. */
    if (created.slug !== t.slug) {
      log(`[content] WARNING: "${t.name}" got slug "${created.slug}", expected "${t.slug}" — its page content will not attach`);
    }
    added++;
  }
  if (added) log(`[content] ${added} treatment(s) added`);

  /*
   * Image provenance.
   *
   * The supplied treatment photographs are licensed stock, but every one was
   * captioned "...at Samal Dental Care, Talcher" and one as a before-and-after
   * of a smile makeover at the clinic. For a registered practice that is a
   * claim about clinical results, and it was true of none of them.
   *
   * Matched on the claim itself rather than on a list of ids, so an image the
   * clinic replaces with a real photograph — and re-captions — is left alone.
   */
  const claiming = await all(
    `SELECT id, alt FROM media
     WHERE deleted_at IS NULL AND is_stock = 0
       AND alt IS NOT NULL AND alt LIKE '%Samal Dental Care%'
       AND folder IN ('services', 'clinic')`);
  let marked = 0;
  for (const m of claiming) {
    /* Strip the clinic from the description and say plainly what it is. */
    const neutral = m.alt
      .replace(/,?\s*(at\s+)?Samal Dental Care[^,]*/i, '')
      .replace(/,\s*(Bikrampur[^,]*,?\s*)?(FCI Township,?\s*)?Talcher[^,]*/i, '')
      .replace(/\s{2,}/g, ' ').replace(/[,\s]+$/, '').trim();
    await run(`UPDATE media SET alt = ?, is_stock = 1, updated_at = NOW() WHERE id = ?`,
      `Illustration: ${neutral.charAt(0).toLowerCase()}${neutral.slice(1)}`, m.id);
    marked++;
  }
  if (marked) log(`[content] ${marked} licensed image(s) relabelled and marked illustrative`);

  /* Related treatments. Set only while empty, so a clinic that has chosen its
     own pairings keeps them. */
  let paired = 0;
  for (const [slug, related] of Object.entries(RELATED)) {
    const r = await run(
      `UPDATE services SET related_slugs = ?, updated_at = NOW()
       WHERE slug = ? AND (related_slugs IS NULL OR related_slugs = '')`, related, slug);
    paired += r.changes;
  }
  if (paired) log(`[content] ${paired} treatment(s) given clinically paired suggestions`);

  /* Per-treatment questions. UNIQUE(service_id, question) makes the insert
     idempotent, and an answer the clinic has edited is never overwritten. */
  let sfaq = 0;
  for (const [slug, rows] of Object.entries(SERVICE_FAQS)) {
    const svc = await one('SELECT id FROM services WHERE slug = ? AND deleted_at IS NULL', slug);
    if (!svc) continue;
    for (const [i, [question, answer]] of rows.entries()) {
      const r = await run(
        `INSERT INTO service_faqs (service_id, question, answer, display_order)
         VALUES (?, ?, ?, ?) ON CONFLICT (service_id, question) DO NOTHING`,
        svc.id, question, answer, i);
      sfaq += r.changes;
    }
  }
  if (sfaq) log(`[content] ${sfaq} treatment-specific FAQ(s) added`);

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

  /*
   * Answers that stated the timings or the phone number as fixed text now use
   * {{hours}} and {{phone}}, which resolve at render. Rewritten only while the
   * answer is still the one shipped, so an edited FAQ is left alone.
   */
  const FAQ_REWRITES = [
    ['What are the clinic timings?',
      'The clinic is open every day from 8:00 AM to 9:00 PM, with a break between 1:00 PM and 3:00 PM. The weekly table on this page always shows the current hours, and any holiday closure appears there too.',
      'The clinic is open {{hours}}. The weekly table on this page always shows the current hours, and any holiday closure appears there too.'],
    ['How can I contact the clinic?',
      'Call or WhatsApp {{phone}}, or use the booking form on this page.',
      'Call {{phone}}, message the same number on WhatsApp, or use the booking form on this page. {{phone2}} is a second line if the first is engaged.'],
  ];
  let rewritten = 0;
  for (const [question, from, to] of FAQ_REWRITES) {
    const r = await run(
      'UPDATE faqs SET answer = ?, updated_at = NOW() WHERE question = ? AND answer = ?',
      to, question, from);
    rewritten += r.changes;
  }
  if (rewritten) log(`[content] ${rewritten} FAQ answer(s) now track the live hours and numbers`);

  /*
   * Thin seeded questions superseded by fuller ones. Unpublished rather than
   * deleted, so the clinic can bring one back from the admin panel, and guarded
   * on the original answer so an edited version is left alone. Three questions
   * all answering "how do I contact you" is worse than one that answers it
   * properly.
   */
  const FAQ_RETIRED = [
    ['Where is Samal Dental Care located?', '{{address}}.'],
    ['How can I contact the clinic?',
      'Call {{phone}}, message the same number on WhatsApp, or use the booking form on this page. {{phone2}} is a second line if the first is engaged.'],
  ];
  let retired = 0;
  for (const [question, answer] of FAQ_RETIRED) {
    const r = await run(
      'UPDATE faqs SET is_published = 0, updated_at = NOW() WHERE question = ? AND answer = ? AND is_published = 1',
      question, answer);
    retired += r.changes;
  }
  if (retired) log(`[content] ${retired} duplicate FAQ(s) unpublished`);

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
