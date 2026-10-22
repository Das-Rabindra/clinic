# Local SEO: audit, changes and plan

Samal Dental Care · https://samal-dental-care.vercel.app/ · started
2026-10-22.

Nothing here promises a ranking or a visibility radius. Google decides local
results from **relevance, distance and prominence**. A website can improve
relevance and prove consistency. Distance is fixed by the real address, and
prominence comes mostly from the Google Business Profile, its reviews, and
mentions elsewhere.

---

## 1. Location verification

| Item | Status |
|---|---|
| Owner's Maps link `share.google/uZmjctaXNvyBXT3lG` | **Resolved** to Google's listing for "Samal Dental Care", Knowledge Graph id **`/g/11nw0z267l`** |
| Address, pin and coordinates from Google | **Not verified.** Google showed a CAPTCHA ("unusual traffic") to automated access, so the listing's details could not be read |
| Coordinates on the website | `20.9033969, 85.1743727`, entered in the admin. **Not independently verified; left unchanged** |
| Address on the website | Annapurna Market Complex, Bikrampur, FCI Township, Talcher, Odisha 759106. Consistent on every page and in the structured data |

**Needed from the owner:** open
`https://www.google.com/maps?q=20.9033969,85.1743727` and confirm the pin is
on the clinic, or send the full Google Maps URL from a computer's address bar.
Until then, coordinates are not changed and no distance-based content is
written.

## 2. Audit findings (live site, 2026-10-22)

The full technical QA is in `docs/redesign/06-qa.md`.

| # | Finding | Priority | Status |
|---|---|---|---|
| 1 | Rendering is server-side (Express + EJS), so all content is in the HTML without JavaScript | — | ✔ good |
| 2 | Titles: 17 unique, descriptive, with the town ("Root Canal Treatment in Talcher \| Samal Dental Care") | — | ✔ |
| 3 | Canonicals: each page points at itself. No accidental noindex. `robots.txt` blocks only `/admin` and `/api/` | — | ✔ |
| 4 | Sitemap lists only real routes (17), all 200 | — | ✔ |
| 5 | Sitemap `lastmod` was "today" on every request, so it carried no signal | Medium | **Fixed**: real change dates |
| 6 | `/privacy` said "Last updated" with the current month (untrue) | Medium | **Fixed**: September 2026, the actual wording date |
| 7 | Clinic `image` in the structured data was a licensed stock photo | High | **Fixed**: the clinic's own treatment-room photo and the dentist's portrait |
| 8 | No `logo`. Entity `@id` was `…app#clinic` (no slash) | Medium | **Fixed**: logo added; stable `/#clinic` and `/#dentist` ids |
| 9 | Treatment pages referenced the clinic only by an id defined on another page | Low | **Fixed**: provider carries type, name, URL and phone with the same id |
| 10 | No link from the site's data to the Google listing | Medium | **Fixed**: `sameAs` includes the listing (from the owner's link) |
| 11 | Gallery poster alt text said "Illustration: opening day" | Low | **Fixed**: describes the actual poster |
| 12 | No rating or review markup, and no fake reviews | — | ✔ must stay that way |
| 13 | Opening hours in the structured data are split around the 1–3 PM break and generated from the admin hours | — | ✔ |
| 14 | Treatment card images are 1280 px with no `srcset` | Medium | Open (D30). Needs a smaller image size in the media service (backend) |
| 15 | The emergency page copy says "open until 10 PM every day" and its title says "Open till 10 PM", omitting the break | Medium | Owner questions 1 and 3c |
| 16 | No genuine reviews on the site or in the markup | High (prominence) | Owner action, §5 |
| 17 | Core Web Vitals (lab): LCP 1.5–2.4 s, CLS 0, Accessibility and SEO 100 on all pages | — | ✔ |

## 3. Keyword and page map

Search intent is mapped to pages that **already exist**. No page targets
everything.

| Intent | Target page | Primary | Supporting | Area | Status |
|---|---|---|---|---|---|
| Branded | `/` | Samal Dental Care | Samal Dental Care Talcher; Dr. Sonali S. Samal | — | Exists ✔ |
| Primary local | `/` | dentist in Talcher | dental clinic in Talcher; dental care Talcher | Talcher | Exists ✔ (title, H1, address, structured data) |
| Neighbourhood | `/` (location section) | dental clinic Bikrampur | dentist FCI Township Talcher | Bikrampur, FCI Township | Exists ✔: address and location copy name both |
| Near me | `/` | dentist near me | dental clinic near me | — | Decided by Google from distance and the listing; site supports it with address and geo markup |
| Urgent | `/services/dental-emergency` | emergency dentist Talcher | tooth pain dentist Talcher | Talcher | Exists; copy needs owner fix (#15) |
| Root canal | `/services/root-canal-treatment` | root canal treatment in Talcher | RCT Talcher | Talcher | Exists ✔ |
| Cleaning | `/services/dental-cleaning` | teeth cleaning in Talcher | scaling, polishing | Talcher | Exists ✔ |
| Fillings | `/services/dental-fillings` | dental fillings in Talcher | tooth-coloured filling | Talcher | Exists ✔ |
| Extraction | `/services/tooth-extraction`, `/services/wisdom-tooth` | tooth extraction in Talcher | wisdom tooth removal Talcher | Talcher | Exists ✔ |
| Gums | `/services/gum-treatment` | gum treatment Talcher | bleeding gums | Talcher | Exists ✔ |
| Crowns | `/services/crowns-bridges` | dental crowns Talcher | bridges | Talcher | Exists ✔ |
| Children | `/services/pediatric-dentistry` | children's dentist Talcher | kids dentist | Talcher | Exists ✔ |
| Orthodontics | `/services/braces-aligners` | braces in Talcher | clear aligners | Talcher | Exists ✔ |
| Implants, dentures, whitening, aesthetic | their pages | "… in Talcher" | — | Talcher | Exist ✔ |

**Not done, on purpose:** repeating "Talcher" or nearby town names through
the body copy, hidden text, or a list of village names. Each page names the
town once, in its title and summary, and the address appears in the footer
and markup. That's enough for relevance; more risks being treated as
spam.

## 4. Nearby-area pages: recommendation

**Do not create one page per town.** Pages that differ only in a place name
are "doorway pages", which Google's spam policies target. The clinic has
one location.

**Candidates for a single, genuinely useful page.** All are to be verified
with the owner, and no distances are claimed here:

- Talcher town and FCI Township (the clinic's own area)
- Angul, the district headquarters
- Industrial townships nearby, e.g. NTPC Kaniha and NALCO Nagar
- Surrounding villages

**Proposal:** one page, **"Visiting the clinic"** (`/visit`), with:

- the verified pin
- the building (Annapurna Market Complex) and landmarks patients use
- parking and accessibility
- "coming from Angul / Talcher town / Kaniha", with routes the owner confirms
- the hours, including the break
- what to bring to a first visit
- a booking call to action

It would carry the map. This is a page patients from those places would
actually use, which is what makes it legitimate. **Blocked on:** the
verified pin, plus the owner's directions and landmarks.

## 5. Google Business Profile: owner checklist

I don't have access to the profile, and **nothing there has been changed by
me.** Sign in at business.google.com:

1. **Name:** exactly "Samal Dental Care". No keywords like "Best Dentist
   Talcher"; that breaks Google's rules and risks suspension.
2. **Primary category: Dentist.** Add "Dental clinic" only if Google offers
   it. Don't add specialties the clinic doesn't have.
3. **Address and pin:** Annapurna Market Complex, Bikrampur, FCI Township,
   Talcher 759106. Drag the pin onto the entrance. Then tell me the
   coordinates so the website matches.
4. **Hours:** Mon–Sun 9:00 AM–1:00 PM and 3:00 PM–10:00 PM, if that's
   correct (question 1). Use "special hours" for holidays.
5. **Phone:** primary 8847879686, additional 9124839288 (if still answered).
6. **Website:** `https://samal-dental-care.vercel.app/` (or the custom
   domain later). **Appointment link:**
   `https://samal-dental-care.vercel.app/#appointment`.
7. **Services:** add the 15 treatments, with the same names as the website.
8. **Photos:** the treatment-room photo, the exterior and signboard,
   reception, and the dentist's portrait. Real photos only; add new ones
   monthly.
9. **Description (750 characters):** who, where, what, from the website's
   own wording. No claims you can't support.
10. **Reviews:** ask every satisfied patient. The website's QR card already
    points to the review page, so print it for reception. Reply to every
    review, briefly and without mentioning any treatment details
    (confidentiality).
11. **Never** create a second profile or buy, swap or write reviews.

**Citations:** list the same name, address and phone on JustDial,
Practo, Sulekha and Google, exactly as on the website. Inconsistent copies
dilute prominence.

## 6. Search Console and measurement

**Setup (owner, about 15 minutes)**

1. In search.google.com/search-console, add a **URL-prefix property** for
   `https://samal-dental-care.vercel.app/`. Verify with the HTML-tag method
   (send me the tag and I'll add it to the page `<head>`) or the HTML file
   method.
2. Submit `https://samal-dental-care.vercel.app/sitemap.xml`.
3. Use **URL Inspection** on `/`, `/services` and the 3–4 most important
   treatment pages, and request indexing once.
4. If a custom domain is added later, add it as a **domain property**, set
   `PUBLIC_URL` (the canonical tags then follow), and keep the vercel.app
   URL redirecting to it.

**What to track monthly (baseline = the first 28 days after verification)**

| Metric | Where |
|---|---|
| Impressions and clicks by page | Search Console → Performance → Pages |
| Queries containing "Talcher", "Angul" or a treatment name | Performance → Queries (filter) |
| Calls, direction requests and website clicks from the listing | Business Profile → Performance |
| Phone / WhatsApp / Book clicks on the site | The site fires `call_clicked`, `whatsapp_clicked` and `appointment_started` events, but only if an analytics tag is installed (none is; adding one is your choice and needs a privacy-policy line) |
| Completed online bookings, by month | Admin → Appointments (source "website") |

**Rank checks:** a single search shows one person's results at one spot.
Local results change with the searcher's location. If you want a radius
view, use one tool consistently, monthly, from the same grid points
(e.g. a geo-grid rank tracker), and compare like with like. Don't compare
results across devices.

## 7. 90-day plan

| When | Action | Owner |
|---|---|---|
| Week 1 | Confirm the pin and hours. Fix the Business Profile (§5). Verify Search Console and submit the sitemap | Owner (+ me for the meta tag) |
| Week 1 | Answer owner questions 1, 3 and 11 so the emergency page and benefit wording can be corrected | Owner → me |
| Weeks 2–3 | Build `/visit` (§4) from verified directions and landmarks | Me, after owner input |
| Weeks 2–4 | Start asking for reviews (QR card at reception and a WhatsApp follow-up). Add the paper-card testimonials with consent | Owner |
| Month 2 | Citations (JustDial, Practo, Sulekha) with identical name, address and phone | Owner |
| Month 2 | Smaller image size for treatment cards (D30) | Me, with approval |
| Month 2–3 | 2–3 genuinely useful articles answering questions patients ask the clinic (e.g. "toothache at night: what to do before you can see a dentist"), reviewed by the dentist | Dentist + me |
| Day 90 | Compare Search Console and Business Profile against the baseline; decide the next quarter | Both |

## 8. Risks and limits

- Rankings and a 50 km reach can't be promised. Distance from the searcher
  dominates local results.
- `vercel.app` subdomain: works, but a custom domain (e.g.
  samaldentalcare.in) builds a more durable identity. Recommended.
- No reviews yet is the biggest prominence gap, and only the patients can
  close it.
- Pin, hours and claims are unverified until the owner answers. Nothing
  depending on them has been changed.
