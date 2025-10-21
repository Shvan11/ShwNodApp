-- PostgreSQL Schema for Aligner Portal
-- Migration from SQL Server to PostgreSQL (Supabase)

-- Table: AlignerDoctors
CREATE TABLE IF NOT EXISTS aligner_doctors (
    dr_id SERIAL PRIMARY KEY,
    doctor_name VARCHAR(100) NOT NULL,
    doctor_email VARCHAR(255) UNIQUE,
    logo_path VARCHAR(100),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: tblAlignerSets
CREATE TABLE IF NOT EXISTS aligner_sets (
    aligner_set_id SERIAL PRIMARY KEY,
    work_id INTEGER NOT NULL,
    aligner_dr_id INTEGER NOT NULL REFERENCES aligner_doctors(dr_id),
    set_sequence INTEGER,
    type VARCHAR(50),
    upper_aligners_count INTEGER DEFAULT 0,
    lower_aligners_count INTEGER DEFAULT 0,
    remaining_upper_aligners INTEGER DEFAULT 0,
    remaining_lower_aligners INTEGER DEFAULT 0,
    creation_date DATE,
    days INTEGER,
    is_active BOOLEAN DEFAULT true,
    notes VARCHAR(255),
    folder_path VARCHAR(255),
    set_url VARCHAR(2000),
    set_pdf_url VARCHAR(2000),
    set_cost DECIMAL(10, 2),
    currency VARCHAR(3) DEFAULT 'USD',
    pdf_uploaded_at TIMESTAMP WITH TIME ZONE,
    pdf_uploaded_by VARCHAR(255),
    drive_file_id VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: tblAlignerBatches
CREATE TABLE IF NOT EXISTS aligner_batches (
    aligner_batch_id SERIAL PRIMARY KEY,
    aligner_set_id INTEGER NOT NULL REFERENCES aligner_sets(aligner_set_id) ON DELETE CASCADE,
    batch_sequence INTEGER,
    upper_aligner_count INTEGER DEFAULT 0,
    lower_aligner_count INTEGER DEFAULT 0,
    upper_aligner_start_sequence INTEGER,
    upper_aligner_end_sequence INTEGER,
    lower_aligner_start_sequence INTEGER,
    lower_aligner_end_sequence INTEGER,
    manufacture_date DATE,
    delivered_to_patient_date DATE,
    days INTEGER,
    validity_period INTEGER,
    next_batch_ready_date DATE,
    notes VARCHAR(255),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Table: tblAlignerNotes
CREATE TABLE IF NOT EXISTS aligner_notes (
    note_id SERIAL PRIMARY KEY,
    aligner_set_id INTEGER NOT NULL REFERENCES aligner_sets(aligner_set_id) ON DELETE CASCADE,
    note_type VARCHAR(20) NOT NULL CHECK (note_type IN ('Doctor', 'Lab')),
    note_text TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    is_edited BOOLEAN DEFAULT false,
    edited_at TIMESTAMP WITH TIME ZONE
);

-- View: Payment summary (if you have payment data to sync)
-- Note: This assumes you'll sync payment data separately or calculate it
CREATE TABLE IF NOT EXISTS aligner_set_payments (
    payment_id SERIAL PRIMARY KEY,
    aligner_set_id INTEGER NOT NULL REFERENCES aligner_sets(aligner_set_id) ON DELETE CASCADE,
    total_paid DECIMAL(10, 2) DEFAULT 0,
    balance DECIMAL(10, 2) DEFAULT 0,
    payment_status VARCHAR(20) DEFAULT 'Unpaid' CHECK (payment_status IN ('Paid', 'Partial', 'Unpaid')),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_aligner_sets_work_id ON aligner_sets(work_id);
CREATE INDEX idx_aligner_sets_dr_id ON aligner_sets(aligner_dr_id);
CREATE INDEX idx_aligner_sets_active ON aligner_sets(is_active);
CREATE INDEX idx_aligner_batches_set_id ON aligner_batches(aligner_set_id);
CREATE INDEX idx_aligner_notes_set_id ON aligner_notes(aligner_set_id);
CREATE INDEX idx_aligner_notes_created ON aligner_notes(created_at DESC);
CREATE INDEX idx_doctors_email ON aligner_doctors(doctor_email);

-- Trigger: Auto-update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_aligner_doctors_updated_at BEFORE UPDATE ON aligner_doctors
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_aligner_sets_updated_at BEFORE UPDATE ON aligner_sets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_aligner_batches_updated_at BEFORE UPDATE ON aligner_batches
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_aligner_payments_updated_at BEFORE UPDATE ON aligner_set_payments
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Row Level Security (RLS) Policies
-- Enable RLS on all tables
ALTER TABLE aligner_doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE aligner_sets ENABLE ROW LEVEL SECURITY;
ALTER TABLE aligner_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE aligner_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE aligner_set_payments ENABLE ROW LEVEL SECURITY;

-- Policy: Doctors can only see their own data
-- Note: We'll set up auth.uid() mapping to doctor email in Supabase

-- For now, create permissive policies (we'll tighten after auth setup)
CREATE POLICY "Doctors can view their own sets" ON aligner_sets
    FOR SELECT USING (true);

CREATE POLICY "Doctors can view their own batches" ON aligner_batches
    FOR SELECT USING (true);

CREATE POLICY "Doctors can view notes for their sets" ON aligner_notes
    FOR SELECT USING (true);

CREATE POLICY "Doctors can insert notes for their sets" ON aligner_notes
    FOR INSERT WITH CHECK (true);

CREATE POLICY "Doctors can update their batch days" ON aligner_batches
    FOR UPDATE USING (true);

CREATE POLICY "Doctors can view their info" ON aligner_doctors
    FOR SELECT USING (true);

CREATE POLICY "Doctors can view payment info" ON aligner_set_payments
    FOR SELECT USING (true);

-- Comments for documentation
COMMENT ON TABLE aligner_doctors IS 'Aligner doctors authorized for portal access';
COMMENT ON TABLE aligner_sets IS 'Aligner treatment sets for patients';
COMMENT ON TABLE aligner_batches IS 'Batches of aligners within a set';
COMMENT ON TABLE aligner_notes IS 'Communication notes between doctors and lab';
COMMENT ON TABLE aligner_set_payments IS 'Payment tracking for aligner sets';
