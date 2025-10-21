-- Add Foreign Key Constraints
-- Run this AFTER initial data sync is complete

-- Add foreign key from aligner_sets to work
ALTER TABLE aligner_sets
    ADD CONSTRAINT fk_aligner_sets_work
    FOREIGN KEY (work_id) REFERENCES work(work_id);

-- Add foreign key from work to patients
ALTER TABLE work
    ADD CONSTRAINT fk_work_patients
    FOREIGN KEY (person_id) REFERENCES patients(person_id);

-- Verify constraints
SELECT
    tc.table_name,
    tc.constraint_name,
    tc.constraint_type,
    kcu.column_name,
    ccu.table_name AS foreign_table_name,
    ccu.column_name AS foreign_column_name
FROM information_schema.table_constraints AS tc
JOIN information_schema.key_column_usage AS kcu
    ON tc.constraint_name = kcu.constraint_name
    AND tc.table_schema = kcu.table_schema
LEFT JOIN information_schema.constraint_column_usage AS ccu
    ON ccu.constraint_name = tc.constraint_name
    AND ccu.table_schema = tc.table_schema
WHERE tc.constraint_type = 'FOREIGN KEY'
    AND tc.table_name IN ('aligner_sets', 'work', 'patients')
ORDER BY tc.table_name, tc.constraint_name;
