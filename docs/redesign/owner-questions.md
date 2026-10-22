# Owner questions — answer before Stage 2

Each question says what is live today and what changes depending on your
answer. Nothing below will change until it is answered.

## 1. Hours & break

Live data says **every day, 9:00 AM–10:00 PM, closed 1:00–3:00 PM**. The
booking engine already refuses slots during the break.

- **1a.** Is that correct for all seven days, Sunday included?
- **1b.** Is the 1–3 PM break real, and should it be shown in the hours table?
  (It is missing there today.)
- **1c.** Are there days with different hours, or regular holidays?
- **1d.** The homepage says "In pain today? The clinic is open until 10 PM every
  day". Keep it, reword it, or drop it?

## 2. Second phone line (9124839288)

Today it appears in three places: the booking side panel ("second line"), the
footer ("alt") and the FAQ ("works as a second line if the first is engaged").

- **2a.** Is it still answered?
- **2b.** Should it stay in those places, appear only in the FAQ, or be removed
  from the website?
- **2c.** Is it on WhatsApp? (Today only 8847879686 is linked to WhatsApp.)

## 3. Claims needing confirmation

Please reply keep, reword or remove for each.

| # | Claim (where) | Question |
|---|---|---|
| a | "**modern equipment**" (Clinic story) | Which equipment, if any, should be named? Otherwise, remove? |
| b | "Care led by an **experienced dentist**" (About heading) | Years of practice, or an alternative heading? |
| c | "keeps **time free for urgent problems**" (homepage urgent band) and "**Same-day appointments kept free** for urgent problems" (Emergency page) | Is time actually held back each day? |
| d | "**Safe** removal of a damaged or problematic tooth" (Extraction) | Suggested replacement: "Removal of a damaged or problematic tooth when it cannot be saved" |
| e | "see which times are free and **reserve one instantly**" (FAQ) | Are online bookings auto-confirmed, or does the clinic confirm them? (The confirmation screen says "requested" unless auto-confirm is on) |
| f | "**Modern** dental care, close to home" (H1) and "attentive, **modern** care" (CTA) | Keep? |
| g | "seen **the same day where possible**" (Emergency short description) | Keep? |
| h | "Pain and infection **dealt with first**" (Emergency benefits) | Keep? |

## 4. Photography

Real photos today:

- the dentist portrait
- a "Grand Opening" **promotional poster**, which is the only item in "Inside
  the clinic"

Every treatment and hero image is licensed stock, labelled "Illustration:"
(most are actually photographs).

- **4a.** Do you have real photos of the clinic (exterior, reception, treatment
  room, equipment, team)? Please send them, or upload them via Admin → Gallery.
- **4b.** Choose one:
  1. keep the stock images, clearly marked
  2. replace them with real photos as they arrive (mix)
  3. remove stock from treatment cards and use the drawn line-art plates
     that already exist in the code
- **4c.** Should the promotional poster stay in "Inside the clinic"? If not,
  the gallery would be empty and show its empty state until real photos are
  added.
- **4d.** Is the hero image (a close-up of a smiling mouth, stock) acceptable,
  or would you prefer the portrait or a clinic photo there?

### Photo update (2026-10-22)

You supplied three photos.

- **A (treatment room)** is now the homepage hero. It replaces the stock smile
  image.
- **B and C are not used yet.** See question 10.

## 5. Qualification wording

- **5a.** What does "FRCD" stand for, and which institution awarded it?
  The site currently implies both the BDS and the FRCD are from Kalinga
  Institute of Dental Science.
- **5b.** Is the BDS from Kalinga Institute of Dental Science, Bhubaneswar
  (KIDS, KIIT)?
- **5c.** "Regd. No. 3209-A": which council? Should the site say "Odisha State
  Dental Council Regd. No. 3209-A" or similar?

## 6. Emergencies

- **6a.** What should a patient do **outside** opening hours, or during the
  1–3 PM break? (Call anyway? Go to a named hospital?)
- **6b.** Is calling 8847879686 the right instruction for urgent cases at all
  times?

## 7. Brand colour

- **7a.** May the brand primary change from the current dark pine `#1F3D3A` to
  the proposed deep teal `#155E59`? Both pass contrast. Teal reads brighter
  and more "clinical-calm".
- **7b.** Should the browser `theme-color` follow it?
- **7c.** The current honey/gold CTA colour `#C79A4B` has no place in the new
  palette. OK to drop it?

## 8. Online cancellation

The FAQ and the privacy page say patients can **cancel online** with their
booking reference and mobile number. The server supports this, but **the
website has no screen for it.**

- **8a.** Option 1: add a small "Manage my booking" panel (look up + cancel)
  using the existing system. No backend change.
- **8b.** Option 2: change the FAQ and privacy wording to "call or WhatsApp to
  cancel".

## 9. Process

- **9a.** Vercel previews: does the Vercel project have `DATABASE_URL` set for
  **Preview** as well as Production? If it is shared, a preview would write to
  the live database. Booking on previews will be tested only with mocked
  network calls either way.
- **9b.** The prompt asks for one branch and one PR per stage. OK to push
  `redesign/stage-1-audit` and open a docs-only PR? (Pushing creates a Vercel
  preview build.)

## 10. The two photos not used yet

- **10a. Photo B** (extracted tooth fragments on a bloodied glove). This
  would put many patients off. I suggest it is not published on the website.
  Do you want it used anywhere? If so, where, and why?
- **10b. Photo C** (before/after "Smile Transformation" poster).
  - Has this patient given **written consent** for the photo to be published?
  - If yes, the right route is **Admin → Gallery → upload → category
    "Before & after"**. That records who confirmed consent and when, and the
    database refuses to publish the photo without it.
  - Please supply the plain before and after photographs rather than the
    poster. The poster carries "Safe & Painless Treatment" (claim 3, not yet
    confirmed), plus the phone number and URL as text inside the image.

## 11. Treatment "benefit" lines that promise outcomes (added in Stage 4)

These come from each treatment's admin-editable text. They are still shown
unchanged; only the heading above them changed, from "What this treatment does
for you" to the more cautious "What it aims to do". Please reply keep, reword
or remove for each line. Lines not listed here are statements of process ("an
examination first", "a written plan") and are fine as they are.

| Treatment | Line | Concern |
|---|---|---|
| Root canal | "Relieves the pain that brought you in" · "Stops the infection reaching the surrounding bone" | States an outcome as certain. Suggest "aims to relieve…" / "treats the infection before it reaches…" |
| Dental cleaning | "Firmer gums that stop bleeding when brushed" · "Fresher breath" | Outcome promised |
| Dental fillings | "Often avoids the need for a root canal later on" · "Normal biting and chewing restored in a single visit" | The second is a promise of timing and outcome |
| Crowns & bridges | "Comfortable chewing on that side again" | Outcome promised |
| Tooth extraction | "Infection stopped from spreading further" | Outcome promised |
| Dental implants | "Helps preserve the jawbone" · "Chewing and speaking feel closer to a natural tooth" | Clinical claim; generally accepted, but please confirm the wording |
| Dentures | "Chewing and speech improve as you adapt to it" | Outcome promised |
| Wisdom tooth | "An end to the cycle of infection and the pain that comes with it" | Outcome promised |
| Gum treatment | "Bleeding and soreness settle as the inflammation resolves" · "Further bone loss halted" | Outcome promised |
| Dental emergency | "Open until 10:00 PM every day, Sunday included" · "Same-day appointments kept free for urgent problems" · "Pain and infection dealt with first" | The hours omit the 1–3 PM break (Q1); time held back (Q3c) |

The emergency page's long description and SEO title ("Open till 10 PM") carry
the same hours wording (audit §11).
