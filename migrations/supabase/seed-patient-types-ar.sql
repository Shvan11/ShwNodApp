-- Seed Arabic display names for the patient_types controlled vocabulary.
-- Clinic-specific data (not schema) — applied by psql to BOTH DBs (or local-only,
-- letting the failover sink mirror to Supabase). OPG is an acronym (radiograph
-- type) → left NULL so it falls back to the base value. AR strings authored by
-- Claude — FLAG FOR DOCTOR REVIEW (public/js/locales-style review).
UPDATE public.patient_types SET patient_type_name_ar = 'نشط'            WHERE id = 1; -- Active
UPDATE public.patient_types SET patient_type_name_ar = 'منتهي'          WHERE id = 2; -- Finished
UPDATE public.patient_types SET patient_type_name_ar = 'جديد'           WHERE id = 3; -- New
UPDATE public.patient_types SET patient_type_name_ar = 'استشارة'        WHERE id = 4; -- Consult
UPDATE public.patient_types SET patient_type_name_ar = 'غير تقويمي'     WHERE id = 5; -- Not Ortho
-- id = 6 OPG: acronym, leave NULL → falls back to "OPG"
UPDATE public.patient_types SET patient_type_name_ar = 'مفقود'          WHERE id = 7; -- Missing
UPDATE public.patient_types SET patient_type_name_ar = 'منتهي / بدون صور' WHERE id = 8; -- Finisjed / No Photos
UPDATE public.patient_types SET patient_type_name_ar = 'مختبر المصفّفات' WHERE id = 9; -- Aligner Lab
