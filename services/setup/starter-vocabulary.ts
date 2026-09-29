/**
 * Starter vocabularies for a NEW deployment — the clinic-editable lookup lists that an empty
 * install otherwise shows as blank dropdowns (appointment types, calendar time slots, wires, …).
 *
 * WHY THIS IS NOT A MIGRATION. These are the clinic's own choices, edited in Settings → Lookups,
 * unlike the rows the CODE names (work types, tooth codes, the receipt template, 'Doctor',
 * 'Clinic'), which `migrations/pg/1789460500000_seed-product-constants.sql` seeds on every install.
 * `npm run db:setup` (services/setup/install-setup.ts) applies each list below ONLY while its table
 * is still empty, so a clinic that has started editing a vocabulary never gets rows put back, and
 * running setup against an existing deployment changes none of them.
 *
 * Generic orthodontic-practice defaults, not one clinic's list: supplier names, local addresses,
 * referrers and similar are deliberately absent (a new center adds its own).
 *
 * Pure data, no imports — the CI gate has no database (see services/setup/install-setup.test.ts).
 */

/** Calendar time slots ('HH:MM'). Every 30 minutes, 10:00–20:30; edited in Calendar Times settings. */
export const STARTER_TIME_SLOTS: readonly string[] = Array.from({ length: 22 }, (_, i) => {
  const minutes = 10 * 60 + i * 30;
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
});

/** Appointment types (`details`, the "Appointment Types" lookup behind `appointments.app_detail`). */
export const STARTER_APPOINTMENT_TYPES: readonly string[] = [
  'Follow Up',
  'First Time',
  'Exam',
  'Bonding',
  'Removal',
  'Photo',
  'Emergency',
  'Filling 1 Tooth',
  'Filling 2 Teeth',
  'Endo First',
  'Endo Second',
  'Endo Final',
  'Bleaching',
  'Bridge',
  'Implant',
  'Surgical Exposure',
];

/** Patient alert types (`alert_types`). */
export const STARTER_ALERT_TYPES: readonly string[] = [
  'Financial',
  'Appointment',
  'Appliance',
  'Attitude',
  'Clinical',
  'Other',
];

/** Archwires (`wires`), in the usual treatment sequence: round NiTi → rectangular NiTi → SS/TMA. */
export const STARTER_WIRES: readonly string[] = [
  '12 NiTi',
  '14 NiTi',
  '16 NiTi',
  '18 NiTi',
  '20 NiTi',
  '14 SS',
  '16 SS',
  '18 SS',
  '20 SS',
  '16 x 16 NiTi',
  '16 x 22 NiTi',
  '17 x 25 NiTi',
  '18 x 25 NiTi',
  '19 x 25 NiTi',
  '21 x 25 NiTi',
  '16 x 22 SS',
  '17 x 25 SS',
  '18 x 25 SS',
  '19 x 25 SS',
  '21 x 25 SS',
  '17 x 25 TMA',
  '19 x 25 TMA',
  '21 x 25 TMA',
];

/**
 * Expense categories (`expense_categories`), English + Arabic (the expenses screen is translated).
 * 'Employees' (id 5) and 'Lab' (id 7) are NOT here: their ids are code constants
 * (public/js/config/expenseCategories.ts), so the migration seeds them, and "still empty" for this
 * table means "holds nothing but those two".
 */
export const STARTER_EXPENSE_CATEGORIES: ReadonlyArray<{ name: string; nameAr: string }> = [
  { name: 'Rent', nameAr: 'الإيجار' },
  { name: 'Dental Supplies', nameAr: 'مستلزمات طب الأسنان' },
  { name: 'Utilities', nameAr: 'الكهرباء والخدمات' },
  { name: 'Maintenance', nameAr: 'الصيانة' },
  { name: 'Office', nameAr: 'المكتب' },
  { name: 'Cleaning', nameAr: 'مستلزمات التنظيف' },
  { name: 'Marketing', nameAr: 'التسويق' },
  { name: 'Others', nameAr: 'أخرى' },
];

/** Waiting-list reasons (`wait_reasons`). */
export const STARTER_WAIT_REASONS: readonly string[] = [
  'Early Appointment',
  'Examine Records',
  'Appliance Pending',
  'Other',
];

/**
 * Staff positions (`positions`) BESIDES 'Doctor', which the migration seeds because every doctor
 * list filters on that exact name. So "still empty" for this table means "holds nothing but
 * 'Doctor'".
 */
export const STARTER_POSITIONS: readonly string[] = ['Assistant', 'Receptionist'];
export const DOCTOR_POSITION = 'Doctor';

/** The expense-category ids the migration seeds (EMPLOYEE_EXPENSE_CATEGORY, LAB_EXPENSE_CATEGORY). */
export const SEEDED_EXPENSE_CATEGORY_IDS: readonly number[] = [5, 7];
