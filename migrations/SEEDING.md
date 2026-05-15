# Fresh-Install Seeding Guide

Companion to `init_script.sql` (DDL baseline). After the schema is created, populate the tables below before booting the app against the new database.

Audited 2026-05-15 against the live `ShwanNew` DB.

---

## Tier 1 — Required (app will not function without these)

NOT-NULL FK targets the app writes to during normal flows, plus auth.

| Table | Why it's required |
|---|---|
| `tblUsers` | Login required. Seed at least one row with `Username`, `PasswordHash`, `Role='admin'`, `IsActive=1`. |
| `tblEmployees` | `tblwork.DrID` and `tblappointments.DrID` are NOT NULL FKs. Need at least one doctor row. |
| `tblPositions` | FK target of `tblEmployees.Position`. Generic: Doctor / Assistant / Receptionist / Worker. |
| `tblWorkType` | `tblwork.Typeofwork` is NOT NULL. Generic dental catalogue (Ortho, Filling, Endo, …). |
| `tblWorkStatus` | `tblwork.Status` is NOT NULL. Three rows: `Active`, `Finished`, `Discontinued`. |
| `tblToothNumber` | FK target of `tblWorkItemTeeth.ToothID`. Universal 52-row tooth chart (32 permanent + 20 primary). |
| `tbloptions` | Code reads keys directly. Without the minimum keys below, calendar / patient / video routes throw. |

### Minimum `tbloptions` keys

```
MaxAppointmentsPerSlot                = 4
PatientsFolder                        = <set per install>
VideosPath                            = <set per install>
OldOPG                                = <set per install or leave blank>
ARCHFORM_DB_PATH                      = <set per install or leave blank>
CALENDAR_EARLY_SLOTS                  = 12:00,12:30,13:00,13:30
CALENDAR_LATE_SLOTS                   = 21:00,21:30,22:00,22:30
CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT  = true
LatestVersion                         = <current build>
```

Email keys (`EMAIL_SMTP_*`, `EMAIL_FROM_*`) and SMS template keys (`Welcomesms`, `Dailysms`, `Thursdaysms`, `Insta`, `Source`, `LabelTemplatePath`, `LatestLabelPos`) can be omitted — the email service upserts its keys via the Settings UI, and SMS templates are clinic-authored.

---

## Tier 2 — Strongly recommended (universal, tiny, UI expects them)

| Table | Content |
|---|---|
| `tblGender` | 2 rows: Male, Female. Referenced by `tblpatients.Gender`. |
| `tblPatientType` | Patient lifecycle: Active / New / Consult / Finished / Not Ortho / OPG / Missing / Aligner Lab. |
| `tblAlertTypes` | Financial / Appointment / Appliance / Attitude / Clinical / Other. |
| `DocumentTypes` | Receipt / Invoice / Prescription / Referral / Appointment Card. Required if `DocumentTemplates` are used (FK). |

---

## Tier 3 — Domain defaults (ship generic, clinic can edit)

Orthodontic standards. Safe to copy as-is — none reference live clinic data.

| Table | Content |
|---|---|
| `tblWires` | NiTi / SS wire gauges (12, 14, 16, 16x22, 17x25, 18x25, 19x25, 21x25 in NiTi/SS/TMA variants). |
| `tblbends` | Angulation / Rotation / Torque / Extrusion / Intrusion. |
| `tblElastics` | Box / Cl II / Cl III / Cross / Forsus / Power Scope. |
| `tblWaitReason` | Appliance variants, Examine Records, Early Appointment, etc. |
| `tblVidCat` | Surgery / Ortho-Exo / Extra-Oral / Functional / Expansion / Elastics / IPR / Patient Care / Others. |
| `tblExpenseCategories` | Food / Office / Cleaning / Employees / Dental / Lab / Others. |
| `tblStandCategories` | Tooth Paste / Floss / Mouth Wash / Tooth Brush / Others. (Only if Stand POS used.) |
| `tbltimes` | Clinic appointment time slots (every 30 min). Adjust to the clinic's hours. |

---

## Tier 4 — Do NOT seed from another clinic's data

Empty by design. New clinic enters their own values via the admin UI.

- `tbCities`, `tblAddress` — geography
- `tblReferrals` — referring doctors
- `tblKeyWord` — clinical case keywords
- `tblHolidays` — current calendar year
- `tblEstimatedCostPresets` — pricing tiers
- `tblExpenseSubcategories` — staff names / vendor sub-buckets
- `tblLabs`, `tblDentalOffices`, `tblImplantManufacturer` — vendors
- `AlignerDoctors` — only if Aligner features are used
- `tblTagOptions` — clinic-defined categorization
- `tbloptions` rows whose values are clinic-specific paths / credentials / SMS templates (keep the keys, blank the values)

---

## Tier 5 — No seed needed (runtime-populated or already empty)

These exist in `init_script.sql` and must be created, but receive no seed data:

- `tblImplantManufacturer` — admin UI populates it
- All transactional tables (`tblpatients`, `tblappointments`, `tblvisits`, `tblwork`, `tblWorkItems`, `tblWorkItemTeeth`, `tblExpenses`, `tblsms`, `tblInvoice`, `TimePoints`, `TimePointImages`, `tblAlignerSets`, `tblAlignerBatches`, `tblAlignerNotes`, `tblAlignerActivityFlags`, `tblCarriedWires`, `tblscrews`, `tblOldOPG`, `tblPatientPortalAuth`, `tblMessageStatusHistory`, `SyncQueue`, `tblStandItems`, `tblStandStockMovements`, `tblStandSales`, `tblStandSaleItems`, `tblAlerts`, `tblWaiting`, `tblEndo`, `tblDiagnosis`, `tblPrivatePhotos`, `tblvideos`, `Patients`, `tblCalender`, `History.tblInvoice`, `tblWorkDetails_ARCHIVED`)

---

## Dropped tables (do not recreate)

Removed on 2026-05-15 after audit confirmed zero code references:

- ~~`tblOpened`~~ — legacy Access "recent patients" tracker. Modern React UI relies on browser history + search instead.
- ~~`tblTeeth`~~ — duplicate of `tblToothNumber`. No FKs, no code references.
- ~~`tblTypeofWorks`~~ — dead lookup. Not to be confused with `tblWorkType` (active) or `tblwork.Typeofwork` (column name).

---

## Audit one-liner

To re-verify which tables hold reference vs operational data:

```sql
SELECT s.name AS schema_name, t.name AS table_name, p.rows AS row_count
FROM sys.tables t
JOIN sys.schemas s ON t.schema_id = s.schema_id
JOIN sys.partitions p ON t.object_id = p.object_id
WHERE p.index_id IN (0, 1)
ORDER BY p.rows DESC, t.name;
```

To list all FK targets (tells you which tables are referenced and therefore likely need seed data):

```sql
SELECT DISTINCT OBJECT_NAME(fk.referenced_object_id) AS parent_table
FROM sys.foreign_keys fk
ORDER BY parent_table;
```
