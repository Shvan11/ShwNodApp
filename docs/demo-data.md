# Demo data

`npm run db:seed:demo` fills an **empty** install with a believable, fictional orthodontic
clinic. It's for sales demos, staff training on a new install, and for testing (people and agents)
against something realistic without touching a real clinic's database.

```bash
npm run db:migrate          # empty database → full schema + product constants
npm run db:setup            # first admin, identity, currency, starter vocabularies, calendar
npm run db:seed:demo        # the demo clinic
npm run db:seed:demo:remove # …and everything it created, gone again
```

Code: `services/setup/demo/` (cast + planning are pure and unit-tested; `demo-seed.ts` writes).
Photos: `data/demo/photos/`.

## What you get

20 patients covering every derived patient type (Active Ortho with braces, phase 1 and
aligners; Former Patient, finished and discontinued; New; Consult, paid and free; X-ray;
Active Non-Ortho with crown/bridge, endo and implant items), 3 doctors with their own calendar
colours, an assistant and a receptionist, ~135 appointments, ~110 visits with an archwire
progression, ~120 payments with realistic balances (one patient behind on installments), alerts, an
aligner case with three batches (two delivered, one waiting in the lab) and lab notes, a filled
diagnosis, two months of expenses, an upcoming clinic holiday, and **one fully photographed
case**: four sessions (Initial, two Progress, Final), eight views each.

Dates are relative to the day you seed: there are appointments today (checked in, seated or
done according to the clock), reminders due the next two working days, and a case that
finished last month. Fridays and holidays are never used. To refresh the dates, remove and seed
again. Every patient is tagged **Demo**.

Everything is written through the same functions the screens call (patient intake, work
validation, visits and their photo-date roll-up, payment balance guards, appointment holiday and
conflict checks, the aligner services, the photo editor's render path), so a seed also smoke-tests
those write paths on a fresh schema.

## When it refuses, and why

The seed checks first and writes nothing if any of these holds:

| Refuses when | Because |
|---|---|
| the database has any patient | demo rows would mix with real ones |
| a sync sink is capturing (`cdc_sink_control.enabled`) | every demo row would be pushed to the Supabase mirror (and from there into the doctor portal) or into Dolphin |
| the photo folder `MACHINE_PATH/clinic1` holds patient folders or gallery files | photo paths are keyed by patient id, and a fresh database numbers patients 1, 3, 5… — demo patient 1 would write into a real patient 1's folder, and **removing** it would delete that folder |
| there is no active admin | nobody could log in; run `npm run db:setup` first |
| a demo is already seeded | remove it first |

A demo install therefore needs **its own empty database and its own `MACHINE_PATH`**. On a
developer machine whose `.env` points at a real clinic (the original WSL box does: live
PostgreSQL, `MACHINE_PATH=C:` = the real `clinic1`), override both for the run, and keep the
sync sinks and WhatsApp off:

```bash
PG_DATABASE=shwan_demo MACHINE_PATH=/path/to/empty/folder \
FAILOVER_SYNC_ENABLED=false REVERSE_SYNC_ENABLED=false DOLPHIN_SYNC_ENABLED=false WHATSAPP_AUTO_INIT=false \
  npm run db:seed:demo
```

(Shell variables win over `.env`.) Contact details can't reach anyone: phones are in Ofcom's
reserved drama range (+44 7700 900xxx) and emails are `@example.com`, because the reminder batch
messages everyone booked one or two days ahead. The aligner doctor is created without an email
and without the Cloudflare doctor-list sync, so a demo never touches a center's portal access list.

## Removing it

`npm run db:seed:demo:remove` works only from the seed's manifest (`options.DEMO_SEED_MANIFEST`):
it deletes exactly what the seed created. Patients go through `deletePatientCascade`, the same
path as deleting a patient on screen (works, visits, payments, appointments, aligner sets,
alerts, timepoints, photo folder, gallery files, thumbnails). Staff and lookup rows that real
data has since started using are kept and listed. Identity values the seed set are cleared only
if nobody has changed them. A seed that fails half-way leaves its manifest, so remove cleans up
after it too.

## The photos

- **Intraoral views** (Right, Center, Left, Upper, Lower) are real photographs of one treated
  case from the original clinic, used at the clinic owner's request. They are
  downscaled to 960 px with every piece of metadata (EXIF, GPS, ICC, XMP) stripped, and nothing
  in the repository links them to the patient. Do not add more patient photos without the same
  care: this repository ships to every center.
- **Facial views** (Profile, Rest, Smile) are computer-drawn illustrations of nobody, made by
  `node scripts/demo/generate-demo-faces.mjs`. The smile follows the intraoral story: crowded,
  then brackets, then aligned.

The whole pack is about 1.3 MB. The seed copies each timepoint's originals into the patient's
timepoint folder with the editor's `{view}-` tag and renders them through `renderSlotToWorking`,
so the photo editor can reopen and re-crop them like any other session.

## Changing the cast

Edit `services/setup/demo/demo-cast.ts`. `demo-cast.test.ts` fails if the cast names a
vocabulary value a fresh install doesn't have, stops covering a patient type, or loses a view
from the photo pack. Keep new names fictional and new contact details on the reserved ranges.
