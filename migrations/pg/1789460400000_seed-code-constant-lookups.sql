-- Up Migration
--
-- Seed the two lookup tables whose ids are CODE CONSTANTS, so a brand-new deployment works on
-- day one (found by the F9 frontend audit, 2026-09-28; owner's go-ahead the same day).
--
--   work_statuses  ← shared/treatment-taxonomy.ts#WORK_STATUS      (works.status → fk_work_status)
--   patient_types  ← shared/treatment-taxonomy.ts#PATIENT_TYPE_IDS (patients.patient_type_id →
--                    fk_patients_tblpatienttype; written by classifyPatient on every patient
--                    create and on every work/visit write that reclassifies one)
--
-- WHY. The baseline seeds product vocabularies (shades, sink registry) but not these two, and
-- docs/db-migrations.md filed them under "clinical lookup vocabularies" that come from a
-- deployment's own data load. They are not clinic vocabulary: the ids are hard-coded in the app,
-- and on an empty install the first work insert failed `fk_work_status` and the first final-photo
-- visit failed `fk_patients_tblpatienttype`.
--
-- EXISTING DEPLOYMENTS: a no-op. Every row is ON CONFLICT DO NOTHING, so names a clinic has
-- edited in Settings → Lookups are left as they are. The labels are the current taxonomy
-- (treatment-taxonomy.ts's comment; the Arabic from migrations/supabase/patient-type-taxonomy-
-- 2026-07-15.sql and seed-patient-types-ar.sql). The retired patient types 6/7/8 are not seeded.
--
-- The patient_types identity is then moved PAST the seeded ids, never backwards. That is
-- GREATEST(max id, the sequence's own position), so a deployment whose sequence is already
-- further along keeps it. patient_types is not in the reverse-sync set (INCREMENT BY 1), so there
-- is no odd/even parity to preserve. work_statuses has no identity (status_id is a plain
-- smallint).
--
-- No Supabase mirror half: this is row DATA, not DDL. Both tables carry the failover
-- cdc_capture trigger, so the rows reach the mirror like any other write when capture is on,
-- and through the mirror's one-time row load when it is not (cf. 1789460300000).

INSERT INTO public.work_statuses (status_id, status_name) VALUES
  (1, 'Active'),
  (2, 'Finished'),
  (3, 'Discontinued')
  ON CONFLICT (status_id) DO NOTHING;

INSERT INTO public.patient_types (id, patient_type, patient_type_name_ar) VALUES
  (1,  'Active Ortho',     'تقويم نشط'),
  (2,  'Former Patient',   'مريض سابق'),
  (3,  'New / No Works',   'جديد'),
  (4,  'Consult',          'استشارة'),
  (5,  'Active Non-Ortho', 'نشط غير تقويمي'),
  (9,  'Aligner Lab',      'مختبر المصفّفات'),
  (10, 'X-ray',            'أشعة')
  ON CONFLICT (id) DO NOTHING;

SELECT setval(
  pg_get_serial_sequence('public.patient_types', 'id'),
  GREATEST(
    (SELECT max(id) FROM public.patient_types),
    (SELECT CASE WHEN is_called THEN last_value ELSE 0 END FROM public.patient_types_id_seq)
  )
);

-- Down Migration
--
-- Intentionally empty. The rows are FK targets on any database that has used them, and on an
-- existing deployment they predate this file, so deleting them here could only fail or destroy
-- data this migration never created.
