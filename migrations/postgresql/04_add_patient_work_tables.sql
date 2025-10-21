-- Add Patient and Work tables to PostgreSQL
-- These are needed to display patient names in the portal

-- Table: Patients (minimal data needed for portal)
CREATE TABLE IF NOT EXISTS patients (
    person_id INTEGER PRIMARY KEY,
    patient_id VARCHAR(50),
    patient_name VARCHAR(200),
    first_name VARCHAR(100),
    last_name VARCHAR(100),
    phone VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: Work (minimal data needed for portal)
CREATE TABLE IF NOT EXISTS work (
    work_id INTEGER PRIMARY KEY,
    person_id INTEGER NOT NULL REFERENCES patients(person_id),
    type_of_work VARCHAR(200),
    addition_date DATE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_work_person_id ON work(person_id);
CREATE INDEX IF NOT EXISTS idx_patients_name ON patients(patient_name);

-- Auto-update timestamp triggers
CREATE TRIGGER update_patients_updated_at BEFORE UPDATE ON patients
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_work_updated_at BEFORE UPDATE ON work
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- NOTE: Foreign key constraint will be added AFTER initial data sync
-- Run this manually after syncing patient/work data from SQL Server:
-- ALTER TABLE aligner_sets
--     ADD CONSTRAINT fk_aligner_sets_work
--     FOREIGN KEY (work_id) REFERENCES work(work_id);

-- Row Level Security
ALTER TABLE patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE work ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on patients" ON patients FOR ALL USING (true);
CREATE POLICY "Allow all operations on work" ON work FOR ALL USING (true);

-- Comments
COMMENT ON TABLE patients IS 'Patient information (minimal data for portal display)';
COMMENT ON TABLE work IS 'Work/treatment records linked to aligner sets';
