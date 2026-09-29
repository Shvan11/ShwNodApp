-- Up Migration
--
-- Seed the rest of the rows a brand-new deployment cannot work without: the ones the CODE names,
-- by id or by value. 1789460400000 did the two FK-target lookups (work_statuses, patient_types);
-- this file does everything else an empty install was found to be missing (2026-09-29, while
-- building `npm run db:setup` + the demo seeder on a throwaway PG 18):
--
--   work_types          ids are WORK_TYPE_IDS (shared/treatment-taxonomy.ts). No FK, so a missing
--                       row doesn't fail a write, but every work shows a blank type and the
--                       ortho / x-ray / aligner groupings have nothing to group.
--   tooth_numbers       the dental nomenclature. `tooth_code` must equal the chart SVG names
--                       (public/images/teeth/chart/UR6.svg, …) and DentalChart's hard-coded codes;
--                       work_item_teeth.tooth_id points at these ids.
--   document_types      receipt-service.ts renders the default receipt with `documentTypeId: 1`.
--   document_templates  that default receipt row (type 1, is_default) has NO on-disk fallback, so
--                       printing any receipt failed "Default receipt template not found". The file
--                       it names ships in the repo (data/templates/). The no-work receipt is
--                       registered too so it's editable in Templates; the discount variant is found
--                       by name with a file fallback, so it's left to that fallback.
--   expense_categories  5 'Employees' and 7 'Lab' only — EMPLOYEE_EXPENSE_CATEGORY /
--                       LAB_EXPENSE_CATEGORY (public/js/config/expenseCategories.ts) swap the
--                       expense form's sub-level to an employee / lab picker by these ids. On an
--                       empty install, identity would have handed 5 and 7 to whatever was typed first.
--   positions           'Doctor' — every doctor list filters `position_name = 'Doctor'`.
--   employees           'Clinic' — the pseudo-doctor that X-ray/Consult intake works are stamped
--                       with (PatientService.resolveClinicDoctorId, matched by name → 422 without it).
--   numbers             the 0..366 tally table that fillCalendar() multiplies by the time slots.
--                       Empty, the calendar can never be generated.
--
-- NOT HERE, on purpose: clinic vocabulary (time slots, appointment types, wires, alert types,
-- expense categories, …), the first user and the clinic's identity. Those are the clinic's own
-- choices and come from `npm run db:setup` (services/setup/), which fills a vocabulary only while
-- it is still empty.
--
-- EXISTING DEPLOYMENTS: a no-op. Explicit ids are ON CONFLICT DO NOTHING; the name-keyed rows are
-- WHERE NOT EXISTS; so nothing an existing clinic has edited or added is touched (on the original
-- deployment every row below already exists — checked 2026-09-29). Identities are moved PAST the
-- seeded ids, never backwards (same GREATEST pattern as 1789460400000). employees and
-- document_templates are reverse-sync tables (INCREMENT BY 2, local ODD), so their rows take the
-- identity's own next value and never an explicit id.
--
-- No Supabase mirror half: row DATA, not DDL. Every table here carries the failover cdc_capture
-- trigger, so the rows reach the mirror like any other write when capture is on.

INSERT INTO public.work_types (id, work_type) VALUES
  (1,  'Ortho (Braces)'),
  (2,  'Ortho Phase 1'),
  (3,  'Scaling'),
  (4,  'Filling'),
  (5,  'Endo'),
  (6,  'Bleaching'),
  (7,  'Exo'),
  (8,  'Gingivectomy'),
  (9,  'Veneers'),
  (10, 'Surgery'),
  (11, 'Relapse'),
  (12, 'Retainer'),
  (13, 'Other'),
  (14, 'OPG'),
  (15, 'Implant'),
  (17, 'Crown/Bridge'),
  (18, 'CBCT'),
  (19, 'Ortho (Aligners)'),
  (20, 'Ortho (Mixed)'),
  (21, 'Aligner (Lab)'),
  (22, 'Cephalo'),
  (23, 'Consult')
  ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.work_types', 'id'),
  GREATEST(
    (SELECT max(id) FROM public.work_types),
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.work_types_id_seq)
  )
);

INSERT INTO public.tooth_numbers (id, tooth_code, tooth_name, tooth_number, quadrant, sort_order, is_permanent) VALUES
  (1,  'UR8', 'Upper Right Third Molar',            '8', 'UR', 1,  true),
  (2,  'UR7', 'Upper Right Second Molar',           '7', 'UR', 2,  true),
  (3,  'UR6', 'Upper Right First Molar',            '6', 'UR', 3,  true),
  (4,  'UR5', 'Upper Right Second Premolar',        '5', 'UR', 4,  true),
  (5,  'UR4', 'Upper Right First Premolar',         '4', 'UR', 5,  true),
  (6,  'UR3', 'Upper Right Canine',                 '3', 'UR', 6,  true),
  (7,  'UR2', 'Upper Right Lateral Incisor',        '2', 'UR', 7,  true),
  (8,  'UR1', 'Upper Right Central Incisor',        '1', 'UR', 8,  true),
  (9,  'UL1', 'Upper Left Central Incisor',         '1', 'UL', 9,  true),
  (10, 'UL2', 'Upper Left Lateral Incisor',         '2', 'UL', 10, true),
  (11, 'UL3', 'Upper Left Canine',                  '3', 'UL', 11, true),
  (12, 'UL4', 'Upper Left First Premolar',          '4', 'UL', 12, true),
  (13, 'UL5', 'Upper Left Second Premolar',         '5', 'UL', 13, true),
  (14, 'UL6', 'Upper Left First Molar',             '6', 'UL', 14, true),
  (15, 'UL7', 'Upper Left Second Molar',            '7', 'UL', 15, true),
  (16, 'UL8', 'Upper Left Third Molar',             '8', 'UL', 16, true),
  (17, 'LL8', 'Lower Left Third Molar',             '8', 'LL', 17, true),
  (18, 'LL7', 'Lower Left Second Molar',            '7', 'LL', 18, true),
  (19, 'LL6', 'Lower Left First Molar',             '6', 'LL', 19, true),
  (20, 'LL5', 'Lower Left Second Premolar',         '5', 'LL', 20, true),
  (21, 'LL4', 'Lower Left First Premolar',          '4', 'LL', 21, true),
  (22, 'LL3', 'Lower Left Canine',                  '3', 'LL', 22, true),
  (23, 'LL2', 'Lower Left Lateral Incisor',         '2', 'LL', 23, true),
  (24, 'LL1', 'Lower Left Central Incisor',         '1', 'LL', 24, true),
  (25, 'LR1', 'Lower Right Central Incisor',        '1', 'LR', 25, true),
  (26, 'LR2', 'Lower Right Lateral Incisor',        '2', 'LR', 26, true),
  (27, 'LR3', 'Lower Right Canine',                 '3', 'LR', 27, true),
  (28, 'LR4', 'Lower Right First Premolar',         '4', 'LR', 28, true),
  (29, 'LR5', 'Lower Right Second Premolar',        '5', 'LR', 29, true),
  (30, 'LR6', 'Lower Right First Molar',            '6', 'LR', 30, true),
  (31, 'LR7', 'Lower Right Second Molar',           '7', 'LR', 31, true),
  (32, 'LR8', 'Lower Right Third Molar',            '8', 'LR', 32, true),
  (33, 'URE', 'Upper Right Second Primary Molar',   'E', 'UR', 33, false),
  (34, 'URD', 'Upper Right First Primary Molar',    'D', 'UR', 34, false),
  (35, 'URC', 'Upper Right Primary Canine',         'C', 'UR', 35, false),
  (36, 'URB', 'Upper Right Primary Lateral Incisor', 'B', 'UR', 36, false),
  (37, 'URA', 'Upper Right Primary Central Incisor', 'A', 'UR', 37, false),
  (38, 'ULA', 'Upper Left Primary Central Incisor', 'A', 'UL', 38, false),
  (39, 'ULB', 'Upper Left Primary Lateral Incisor', 'B', 'UL', 39, false),
  (40, 'ULC', 'Upper Left Primary Canine',          'C', 'UL', 40, false),
  (41, 'ULD', 'Upper Left First Primary Molar',     'D', 'UL', 41, false),
  (42, 'ULE', 'Upper Left Second Primary Molar',    'E', 'UL', 42, false),
  (43, 'LLE', 'Lower Left Second Primary Molar',    'E', 'LL', 43, false),
  (44, 'LLD', 'Lower Left First Primary Molar',     'D', 'LL', 44, false),
  (45, 'LLC', 'Lower Left Primary Canine',          'C', 'LL', 45, false),
  (46, 'LLB', 'Lower Left Primary Lateral Incisor', 'B', 'LL', 46, false),
  (47, 'LLA', 'Lower Left Primary Central Incisor', 'A', 'LL', 47, false),
  (48, 'LRA', 'Lower Right Primary Central Incisor', 'A', 'LR', 48, false),
  (49, 'LRB', 'Lower Right Primary Lateral Incisor', 'B', 'LR', 49, false),
  (50, 'LRC', 'Lower Right Primary Canine',         'C', 'LR', 50, false),
  (51, 'LRD', 'Lower Right First Primary Molar',    'D', 'LR', 51, false),
  (52, 'LRE', 'Lower Right Second Primary Molar',   'E', 'LR', 52, false)
  ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.tooth_numbers', 'id'),
  GREATEST(
    (SELECT max(id) FROM public.tooth_numbers),
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.tooth_numbers_id_seq)
  )
);

INSERT INTO public.document_types
  (type_id, type_code, type_name, description, icon, default_paper_width, default_paper_height, default_orientation, is_active, sort_order)
VALUES
  (1, 'receipt',      'Receipt',          'Payment receipts for thermal printers',    'fa-receipt',             80,  297, 'portrait',  true, 1),
  (2, 'invoice',      'Invoice',          'Detailed invoices and billing statements', 'fa-file-invoice-dollar', 210, 297, 'portrait',  true, 2),
  (3, 'prescription', 'Prescription',     'Medical prescriptions (Rx)',               'fa-prescription',        210, 297, 'portrait',  true, 3),
  (4, 'referral',     'Referral Letter',  'Patient referral letters to specialists',  'fa-file-medical',        210, 297, 'portrait',  true, 4),
  (5, 'appointment',  'Appointment Card', 'Appointment reminder cards',               'fa-calendar-check',      100, 150, 'landscape', true, 5)
  ON CONFLICT DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.document_types', 'type_id'),
  GREATEST(
    (SELECT max(type_id) FROM public.document_types),
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.document_types_type_id_seq)
  )
);

INSERT INTO public.document_templates
  (template_name, description, document_type_id, paper_width, paper_height, paper_orientation,
   paper_margin_top, paper_margin_right, paper_margin_bottom, paper_margin_left,
   background_color, show_grid, is_default, is_system, is_active, template_file_path)
SELECT 'Default Receipt', 'Payment receipt for thermal printers (190 × 75 mm).', 1, 190, 75, 'landscape',
       5, 5, 5, 5, '#ffffff', false, true, true, true,
       'data/templates/shwan-orthodontics-default-receipt.html'
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_templates WHERE document_type_id = 1 AND is_default = true
);

INSERT INTO public.document_templates
  (template_name, description, document_type_id, paper_width, paper_height, paper_orientation,
   paper_margin_top, paper_margin_right, paper_margin_bottom, paper_margin_left,
   background_color, show_grid, grid_size, is_default, is_system, is_active, template_file_path)
SELECT 'No-Work Appointment Receipt',
       'Thermal receipt template for patients with no works, showing next appointment information',
       1, 190, 75, 'landscape', 5, 5, 5, 5, '#ffffff', false, 10, false, true, true,
       'data/templates/shwan-orthodontics-no-work-receipt.html'
WHERE NOT EXISTS (
  SELECT 1 FROM public.document_templates WHERE template_name = 'No-Work Appointment Receipt'
);

INSERT INTO public.expense_categories (category_id, category_name, category_name_ar) VALUES
  (5, 'Employees', 'الموظفون'),
  (7, 'Lab',       'المختبر')
  ON CONFLICT (category_id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.expense_categories', 'category_id'),
  GREATEST(
    (SELECT max(category_id) FROM public.expense_categories),
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.expense_categories_category_id_seq)
  )
);

INSERT INTO public.positions (position_name)
SELECT 'Doctor'
WHERE NOT EXISTS (SELECT 1 FROM public.positions WHERE position_name = 'Doctor');

INSERT INTO public.employees (employee_name, position, get_appointments, percentage, receive_email, is_active)
SELECT 'Clinic', (SELECT id FROM public.positions WHERE position_name = 'Doctor' ORDER BY id LIMIT 1),
       true, false, false, true
WHERE NOT EXISTS (SELECT 1 FROM public.employees WHERE employee_name = 'Clinic');

INSERT INTO public.numbers (my_number)
SELECT n FROM generate_series(0, 366) AS n
  ON CONFLICT (my_number) DO NOTHING;

-- Down Migration
--
-- Intentionally empty, like 1789460400000: on any database that has used them these rows are FK
-- targets or referenced by id/name from code, and on an existing deployment they predate this file,
-- so deleting them could only fail or destroy data this migration never created.
