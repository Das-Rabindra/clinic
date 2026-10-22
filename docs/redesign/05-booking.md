# Stage 5: Booking flow, as built

## Server contract (unchanged; re-mapped before any change)

| Call | Returns | Notes |
|---|---|---|
| `GET /api/appointments/calendar?days=60&service_id=` | `{ days: [{date, open, reason, reason_text, available_count}], next_available: {date, first, label, count} }` | One row per day for 60 days |
| `GET /api/appointments/availability?date=&service_id=` | `{ date, open, duration_min, slots: [{time, label, available}] }` | **Free slots only**: booked, blocked and too-soon slots are filtered out server-side for the public API |
| `POST /api/appointments` (CSRF) | `201 { appointment: {ref, status, date_label, time, service, doctor, …} }` | See the error codes below |
| `GET /api/appointments/:ref?phone=` | public view | 404 `NOT_FOUND` unless the reference **and** the normalised phone match |
| `GET /api/appointments/:ref/calendar.ics?phone=` | ICS file | Same reference + phone check |
| `POST /api/appointments/:ref/cancel` (CSRF) `{phone}` | `{ appointment }` | 409 `NOT_CANCELLABLE` unless the status is pending, confirmed or rescheduled |

The time zone comes from `clinic_settings.timezone` (Asia/Kolkata). All
labels, such as "9:30 AM", come from the server. The client formats dates
only, using UTC arithmetic on `YYYY-MM-DD`, so the patient's device time zone
never shifts a date.

## Client state machine (`public/js/booking.js`)

```
Treatment ──► Date ──► Time ──► Your details ──► Review ──► [POST] ──► Confirmation
  (radio)    (calendar  (slots from   (validated      (summary)   only after 201
              from       server)       client-side,                with a ref)
              server)                  server decides)
```

**Errors from submit**

| Code | Where the patient lands | What they see |
|---|---|---|
| `SLOT_TAKEN`, `SLOT_UNAVAILABLE` | Time step, slots reloaded, selection cleared | "That time has just gone", details kept |
| `CLOSED`, `HOLIDAY`, `PAST_DATE`, `BEYOND_HORIZON`, `INVALID_DATE` | Date step, calendar reloaded | The server's message, details kept |
| `VALIDATION` with `fields`, `INVALID_PHONE` | Details step | Field errors, focus on the first one |
| `INVALID_SERVICE` | Treatment step | Notice, plus Call/WhatsApp |
| `PATIENT_BLOCKED`, `NO_DOCTOR` | Stays on Review | Notice, plus Call/WhatsApp |
| `RATE_LIMITED` | Stays on Review | "Too many attempts", plus Call/WhatsApp |
| `CSRF` | — | One automatic retry with a fresh token (the server did nothing) |
| Network failure | Stays on Review | "We could not confirm whether your booking went through…". **No automatic retry**, because a lost response could mean the booking did go through |
| Other 4xx/5xx | Stays on Review | Generic notice, plus Call/WhatsApp |

**Load failures**

- If the calendar or the times fail to load, a notice appears with **Try
  again** and the Call/WhatsApp fallbacks.
- If no days have free times, an empty state appears with the fallbacks.
- If a day has no free times, an empty state appears with **Choose another
  day**.

**Guarantees**

- Slots are never invented. Selecting one is a request, not a reservation.
- Double submission is blocked twice over: a `submitting` flag, plus the
  Confirm button is disabled and marked `aria-busy`.
- Nothing typed is cleared on any error or step change.
- The confirmation screen appears only after a 201. It shows the reference,
  date, time, treatment and dentist, with Add to calendar, WhatsApp the
  clinic, and Book another. The WhatsApp button was dead before:
  `__SDC_WHATSAPP` was never set.
- Nothing is logged to the console. The analytics hook stays as before (no
  tag is installed) and never carries form data.

**Accessibility**

- Each step heading takes focus and the step is announced (`role=status`).
  A re-render while loading keeps focus on the heading.
- Choices are native radios, so arrow keys and screen readers work as
  normal.
- Days are buttons labelled like "Friday 23 October, 22 times available".
  Full or closed days are disabled with "no times available".
- Times are `aria-pressed` buttons grouped under Morning, Afternoon and
  Evening headings.
- Errors are linked with `aria-describedby`, marked `aria-invalid`,
  summarised in the live region, and focus goes to the first problem.

**Mobile**

- The action bar hides while the booking section is on screen and while
  typing.
- Continue is verified clear of the bar at every step.
- Inputs are 16 px, so iOS doesn't zoom.

## Slot states

The design system has four slot states. The live flow uses only
**available** and **selected**, because the public API returns only free
slots. Showing "booked" or "closed" slots would mean inventing them, so they
are not shown. If the clinic wants booked times visible, that's a backend
change (`includeTaken` for the public endpoint) and needs approval.

## Find or cancel (`#manage`, below the wizard)

- **Lookup:** reference plus mobile. The server checks both. A wrong pair
  gives "No appointment matches…", and nothing about the booking is revealed.
- **Cancel:** a two-step confirmation ("Cancel Friday… at 4:00 PM?" → "Yes,
  cancel it" / "Keep my appointment"), then `POST …/cancel`. A booking that
  can't be cancelled says so and offers Call/WhatsApp.
- **Rescheduling:** admin-only on the server. The panel says "To change the
  time, call or message the clinic".
- This delivers the "cancel online" promise already made in the FAQ and the
  privacy page (audit C2, owner question 8, option 1). If the clinic prefers
  option 2, remove the `<details id="manage">` block and change those two
  texts.

## Testing approach

- `test/booking-ui.test.mjs`: 15 tests in real Chromium against an isolated
  database.
  - The valid booking and the cancellation are genuine requests.
  - Every failure is injected with request interception: no slots, calendar
    500, `SLOT_TAKEN`, network abort, `VALIDATION`, `RATE_LIMITED`, duplicate
    submit.
- Production checks only ever mock the POST. **No real booking is made on a
  deployed URL.**
