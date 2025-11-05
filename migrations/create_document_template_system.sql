-- Universal Document Template System
-- Supports receipts, prescriptions, referral letters, and future document types

-- Document Types Table
CREATE TABLE DocumentTypes (
    type_id INT PRIMARY KEY IDENTITY(1,1),
    type_code NVARCHAR(50) NOT NULL UNIQUE, -- 'receipt', 'prescription', 'referral', 'invoice'
    type_name NVARCHAR(100) NOT NULL,
    description NVARCHAR(500),
    icon NVARCHAR(50), -- FontAwesome icon class
    default_paper_width INT DEFAULT 210, -- mm (80 for receipt, 210 for A4)
    default_paper_height INT DEFAULT 297, -- mm
    default_orientation NVARCHAR(20) DEFAULT 'portrait', -- 'portrait', 'landscape'
    is_active BIT DEFAULT 1,
    sort_order INT DEFAULT 0
);

-- Document Templates Table
CREATE TABLE DocumentTemplates (
    template_id INT PRIMARY KEY IDENTITY(1,1),
    template_name NVARCHAR(100) NOT NULL,
    description NVARCHAR(500),

    -- Document Type
    document_type_id INT NOT NULL,

    -- Paper Configuration
    paper_width INT NOT NULL, -- Paper width in mm
    paper_height INT NOT NULL, -- Paper height in mm
    paper_orientation NVARCHAR(20) DEFAULT 'portrait',
    paper_margin_top INT DEFAULT 10,
    paper_margin_right INT DEFAULT 10,
    paper_margin_bottom INT DEFAULT 10,
    paper_margin_left INT DEFAULT 10,

    -- Page Settings
    background_color NVARCHAR(20) DEFAULT '#FFFFFF',
    show_grid BIT DEFAULT 0, -- Show grid in designer
    grid_size INT DEFAULT 10, -- Grid spacing in pixels

    -- Template Status
    is_default BIT DEFAULT 0, -- Is this the default template for this document type?
    is_active BIT DEFAULT 1,
    is_system BIT DEFAULT 0, -- System templates (can't be deleted)

    -- Versioning
    template_version INT DEFAULT 1,
    parent_template_id INT NULL, -- For cloned templates

    -- Metadata
    created_by NVARCHAR(100),
    created_date DATETIME DEFAULT GETDATE(),
    modified_by NVARCHAR(100),
    modified_date DATETIME,
    last_used_date DATETIME,

    CONSTRAINT FK_DocumentTemplates_Type FOREIGN KEY (document_type_id)
        REFERENCES DocumentTypes(type_id),
    CONSTRAINT FK_DocumentTemplates_Parent FOREIGN KEY (parent_template_id)
        REFERENCES DocumentTemplates(template_id)
);

-- Template Elements Table (individual text boxes, fields, images, etc.)
CREATE TABLE TemplateElements (
    element_id INT PRIMARY KEY IDENTITY(1,1),
    template_id INT NOT NULL,

    -- Element Identification
    element_type NVARCHAR(50) NOT NULL, -- 'text', 'data_field', 'image', 'line', 'divider', 'table', 'signature_line'
    element_name NVARCHAR(100) NOT NULL, -- User-friendly name: "Patient Name", "Clinic Header", "Drug List"
    element_label NVARCHAR(200), -- Label shown in designer

    -- Layering
    element_order INT NOT NULL DEFAULT 0, -- Z-index (higher = on top)
    is_locked BIT DEFAULT 0, -- Prevent accidental editing/moving

    -- Position & Size (in pixels for designer, converts to mm for print)
    pos_x DECIMAL(10,2) NOT NULL DEFAULT 0,
    pos_y DECIMAL(10,2) NOT NULL DEFAULT 0,
    width DECIMAL(10,2) DEFAULT 100,
    height DECIMAL(10,2) DEFAULT 20,

    -- Layout
    display_type NVARCHAR(20) DEFAULT 'block', -- 'block', 'inline', 'inline-block'
    position_type NVARCHAR(20) DEFAULT 'absolute', -- 'absolute', 'relative'

    -- Typography
    font_family NVARCHAR(50) DEFAULT 'Arial',
    font_size INT DEFAULT 14,
    font_weight NVARCHAR(20) DEFAULT 'normal', -- 'normal', 'bold', '600', '700'
    font_style NVARCHAR(20) DEFAULT 'normal', -- 'normal', 'italic'
    text_align NVARCHAR(20) DEFAULT 'left', -- 'left', 'center', 'right', 'justify'
    text_decoration NVARCHAR(50) DEFAULT 'none', -- 'none', 'underline', 'line-through'
    text_transform NVARCHAR(20) DEFAULT 'none', -- 'none', 'uppercase', 'lowercase', 'capitalize'
    vertical_align NVARCHAR(20) DEFAULT 'top', -- 'top', 'middle', 'bottom'

    -- Advanced Typography
    letter_spacing DECIMAL(5,2) DEFAULT 0,
    line_height DECIMAL(5,2) DEFAULT 1.5,
    word_spacing DECIMAL(5,2) DEFAULT 0,
    white_space NVARCHAR(20) DEFAULT 'normal', -- 'normal', 'nowrap', 'pre', 'pre-wrap'

    -- Colors
    text_color NVARCHAR(20) DEFAULT '#000000',
    background_color NVARCHAR(20) DEFAULT 'transparent',

    -- Spacing
    margin_top DECIMAL(10,2) DEFAULT 0,
    margin_right DECIMAL(10,2) DEFAULT 0,
    margin_bottom DECIMAL(10,2) DEFAULT 0,
    margin_left DECIMAL(10,2) DEFAULT 0,
    padding_top DECIMAL(10,2) DEFAULT 0,
    padding_right DECIMAL(10,2) DEFAULT 0,
    padding_bottom DECIMAL(10,2) DEFAULT 0,
    padding_left DECIMAL(10,2) DEFAULT 0,

    -- Border
    border_style NVARCHAR(20) DEFAULT 'none', -- 'none', 'solid', 'dashed', 'dotted', 'double'
    border_width INT DEFAULT 0,
    border_color NVARCHAR(20) DEFAULT '#000000',
    border_radius INT DEFAULT 0,
    border_top_width INT NULL,
    border_right_width INT NULL,
    border_bottom_width INT NULL,
    border_left_width INT NULL,

    -- Content Types
    -- For static text
    static_content NVARCHAR(MAX), -- Plain text or HTML

    -- For dynamic data binding
    data_binding NVARCHAR(200), -- e.g., 'patient.PatientName', 'payment.TotalPaid', 'prescription.drugName'
    data_category NVARCHAR(50), -- 'patient', 'payment', 'prescription', 'referral', 'clinic', 'system'
    format_pattern NVARCHAR(100), -- Format: 'currency', 'date:MM/DD/YYYY', 'number:0,0.00'
    default_value NVARCHAR(500), -- Fallback if data is empty

    -- For images
    image_url NVARCHAR(500), -- Static image URL or path
    image_data_binding NVARCHAR(200), -- Dynamic image from data (e.g., 'patient.photo')
    image_fit NVARCHAR(20) DEFAULT 'contain', -- 'contain', 'cover', 'fill', 'none', 'scale-down'

    -- For lines/dividers
    line_orientation NVARCHAR(20), -- 'horizontal', 'vertical'
    line_thickness INT DEFAULT 1,
    line_style NVARCHAR(20), -- 'solid', 'dashed', 'dotted'

    -- For signature lines
    signature_type NVARCHAR(50), -- 'doctor', 'patient', 'witness'
    show_signature_line BIT DEFAULT 1,
    signature_label NVARCHAR(100), -- "Doctor's Signature", "Patient Signature"

    -- Conditional Display
    show_condition NVARCHAR(500), -- JavaScript expression: 'payment.newBalance > 0'
    hide_if_empty BIT DEFAULT 0, -- Hide element if data is null/empty

    -- Special Properties
    is_repeating BIT DEFAULT 0, -- For lists (e.g., list of medications)
    repeat_data_source NVARCHAR(200), -- Array to iterate: 'prescription.medications[]'
    repeat_direction NVARCHAR(20) DEFAULT 'vertical', -- 'vertical', 'horizontal'
    repeat_spacing DECIMAL(10,2) DEFAULT 0, -- Space between repeated items

    -- Visibility
    is_visible BIT DEFAULT 1,
    is_printable BIT DEFAULT 1, -- Show on screen but not print (or vice versa)

    CONSTRAINT FK_TemplateElements_Template FOREIGN KEY (template_id)
        REFERENCES DocumentTemplates(template_id) ON DELETE CASCADE
);

-- Data Field Definitions (available fields for each document type)
CREATE TABLE DataFieldDefinitions (
    field_id INT PRIMARY KEY IDENTITY(1,1),
    document_type_id INT NOT NULL,
    field_category NVARCHAR(50) NOT NULL, -- 'patient', 'payment', 'prescription', 'referral', 'clinic', 'system'
    field_name NVARCHAR(100) NOT NULL, -- 'PatientName', 'TotalPaid', 'drugName'
    field_path NVARCHAR(200) NOT NULL, -- 'patient.PatientName', 'payment.TotalPaid'
    field_label NVARCHAR(200) NOT NULL, -- Display name in designer
    field_description NVARCHAR(500),
    data_type NVARCHAR(50) DEFAULT 'string', -- 'string', 'number', 'date', 'currency', 'boolean', 'array'
    default_format NVARCHAR(100), -- Suggested format pattern
    is_required BIT DEFAULT 0,
    sort_order INT DEFAULT 0,

    CONSTRAINT FK_DataFields_DocumentType FOREIGN KEY (document_type_id)
        REFERENCES DocumentTypes(type_id)
);

-- Template Usage Log
CREATE TABLE TemplateUsageLog (
    log_id INT PRIMARY KEY IDENTITY(1,1),
    template_id INT,
    document_type_id INT,
    used_date DATETIME DEFAULT GETDATE(),
    used_by NVARCHAR(100),
    context_type NVARCHAR(50), -- 'payment', 'appointment', 'prescription', 'referral'
    context_id INT, -- workid, prescription_id, referral_id
    print_count INT DEFAULT 1,
    generation_time_ms INT, -- Performance tracking

    CONSTRAINT FK_TemplateUsage_Template FOREIGN KEY (template_id)
        REFERENCES DocumentTemplates(template_id) ON DELETE SET NULL,
    CONSTRAINT FK_TemplateUsage_DocType FOREIGN KEY (document_type_id)
        REFERENCES DocumentTypes(type_id)
);

-- Insert Document Types
INSERT INTO DocumentTypes (type_code, type_name, description, icon, default_paper_width, default_paper_height, default_orientation, sort_order) VALUES
('receipt', 'Receipt', 'Payment receipts for thermal printers', 'fa-receipt', 80, 297, 'portrait', 1),
('invoice', 'Invoice', 'Detailed invoices and billing statements', 'fa-file-invoice-dollar', 210, 297, 'portrait', 2),
('prescription', 'Prescription', 'Medical prescriptions (Rx)', 'fa-prescription', 210, 297, 'portrait', 3),
('referral', 'Referral Letter', 'Patient referral letters to specialists', 'fa-file-medical', 210, 297, 'portrait', 4),
('appointment', 'Appointment Card', 'Appointment reminder cards', 'fa-calendar-check', 100, 150, 'landscape', 5);

-- Create indexes for performance
CREATE INDEX IX_DocumentTemplates_Type ON DocumentTemplates(document_type_id, is_active);
CREATE INDEX IX_DocumentTemplates_Default ON DocumentTemplates(is_default, document_type_id);
CREATE INDEX IX_TemplateElements_Template ON TemplateElements(template_id, element_order);
CREATE INDEX IX_TemplateElements_Type ON TemplateElements(element_type, is_visible);
CREATE INDEX IX_DataFields_DocType ON DataFieldDefinitions(document_type_id, field_category);
CREATE INDEX IX_TemplateUsage_Template ON TemplateUsageLog(template_id, used_date);
CREATE INDEX IX_TemplateUsage_Context ON TemplateUsageLog(context_type, context_id, used_date);

-- Insert common data fields for RECEIPTS
INSERT INTO DataFieldDefinitions (document_type_id, field_category, field_name, field_path, field_label, field_description, data_type, default_format, sort_order) VALUES
-- Receipt - Patient fields
(1, 'patient', 'PatientName', 'patient.PatientName', 'Patient Name', 'Full name of the patient', 'string', NULL, 1),
(1, 'patient', 'Phone', 'patient.Phone', 'Phone Number', 'Patient phone number', 'string', NULL, 2),
(1, 'patient', 'PersonID', 'patient.PersonID', 'Patient ID', 'Unique patient identifier', 'string', NULL, 3),
-- Receipt - Payment fields
(1, 'payment', 'TotalRequired', 'payment.TotalRequired', 'Total Treatment Cost', 'Total cost of treatment', 'currency', 'currency', 10),
(1, 'payment', 'TotalPaid', 'payment.TotalPaid', 'Total Paid (Before Today)', 'Amount paid before today', 'currency', 'currency', 11),
(1, 'payment', 'amountPaidToday', 'payment.amountPaidToday', 'Paid Today', 'Amount paid in this transaction', 'currency', 'currency', 12),
(1, 'payment', 'newBalance', 'payment.newBalance', 'Remaining Balance', 'Balance remaining after payment', 'currency', 'currency', 13),
(1, 'payment', 'Currency', 'payment.Currency', 'Currency', 'Payment currency (USD/IQD)', 'string', NULL, 14),
(1, 'payment', 'paymentDate', 'payment.paymentDate', 'Payment Date', 'Date of payment', 'date', 'date:MMM DD, YYYY', 15),
(1, 'payment', 'usdReceived', 'payment.usdReceived', 'USD Received', 'USD amount received', 'currency', 'currency', 16),
(1, 'payment', 'iqdReceived', 'payment.iqdReceived', 'IQD Received', 'IQD amount received', 'currency', 'currency', 17),
(1, 'payment', 'change', 'payment.change', 'Change Given', 'Change given to patient', 'currency', 'currency', 18),
-- Receipt - Work fields
(1, 'work', 'TypeName', 'work.TypeName', 'Work Type', 'Type of dental work', 'string', NULL, 20),
(1, 'work', 'workid', 'work.workid', 'Work ID', 'Work record identifier', 'number', NULL, 21),
(1, 'work', 'AppDate', 'work.AppDate', 'Next Appointment', 'Next scheduled appointment', 'date', 'date:MMM DD, YYYY HH:mm', 22),
-- Receipt - Clinic fields
(1, 'clinic', 'clinicName', 'clinic.clinicName', 'Clinic Name', 'Name of the clinic', 'string', NULL, 30),
(1, 'clinic', 'address', 'clinic.address', 'Clinic Address', 'Clinic address', 'string', NULL, 31),
(1, 'clinic', 'phone1', 'clinic.phone1', 'Phone 1', 'Primary phone number', 'string', NULL, 32),
(1, 'clinic', 'phone2', 'clinic.phone2', 'Phone 2', 'Secondary phone number', 'string', NULL, 33),
-- Receipt - System fields
(1, 'system', 'receiptNumber', 'system.receiptNumber', 'Receipt Number', 'Unique receipt number', 'string', NULL, 40),
(1, 'system', 'currentDateTime', 'system.currentDateTime', 'Current Date/Time', 'Current date and time', 'date', 'date:MMM DD, YYYY HH:mm', 41);

-- Insert common data fields for PRESCRIPTIONS (for future use)
INSERT INTO DataFieldDefinitions (document_type_id, field_category, field_name, field_path, field_label, field_description, data_type, default_format, sort_order) VALUES
-- Prescription - Patient fields
(3, 'patient', 'PatientName', 'patient.PatientName', 'Patient Name', 'Full name of the patient', 'string', NULL, 1),
(3, 'patient', 'Age', 'patient.Age', 'Age', 'Patient age', 'number', NULL, 2),
(3, 'patient', 'PersonID', 'patient.PersonID', 'Patient ID', 'Unique patient identifier', 'string', NULL, 3),
(3, 'patient', 'Phone', 'patient.Phone', 'Phone Number', 'Patient phone number', 'string', NULL, 4),
-- Prescription - Drug fields
(3, 'prescription', 'medications', 'prescription.medications', 'Medication List', 'List of prescribed medications', 'array', NULL, 10),
(3, 'prescription', 'diagnosis', 'prescription.diagnosis', 'Diagnosis', 'Medical diagnosis', 'string', NULL, 11),
(3, 'prescription', 'instructions', 'prescription.instructions', 'General Instructions', 'General instructions for patient', 'string', NULL, 12),
(3, 'prescription', 'prescriptionDate', 'prescription.prescriptionDate', 'Prescription Date', 'Date of prescription', 'date', 'date:MMM DD, YYYY', 13),
-- Prescription - Doctor fields
(3, 'doctor', 'doctorName', 'doctor.doctorName', 'Doctor Name', 'Prescribing doctor name', 'string', NULL, 20),
(3, 'doctor', 'licenseNumber', 'doctor.licenseNumber', 'License Number', 'Medical license number', 'string', NULL, 21),
(3, 'doctor', 'signature', 'doctor.signature', 'Doctor Signature', 'Digital signature', 'string', NULL, 22);

-- Insert common data fields for REFERRALS (for future use)
INSERT INTO DataFieldDefinitions (document_type_id, field_category, field_name, field_path, field_label, field_description, data_type, default_format, sort_order) VALUES
-- Referral - Patient fields
(4, 'patient', 'PatientName', 'patient.PatientName', 'Patient Name', 'Full name of the patient', 'string', NULL, 1),
(4, 'patient', 'DOB', 'patient.DOB', 'Date of Birth', 'Patient date of birth', 'date', 'date:MM/DD/YYYY', 2),
(4, 'patient', 'PersonID', 'patient.PersonID', 'Patient ID', 'Unique patient identifier', 'string', NULL, 3),
-- Referral - Referral fields
(4, 'referral', 'referringTo', 'referral.referringTo', 'Referring To', 'Specialist or clinic being referred to', 'string', NULL, 10),
(4, 'referral', 'referralReason', 'referral.referralReason', 'Reason for Referral', 'Reason for referral', 'string', NULL, 11),
(4, 'referral', 'clinicalFindings', 'referral.clinicalFindings', 'Clinical Findings', 'Clinical observations', 'string', NULL, 12),
(4, 'referral', 'referralDate', 'referral.referralDate', 'Referral Date', 'Date of referral', 'date', 'date:MMM DD, YYYY', 13),
-- Referral - Doctor fields
(4, 'doctor', 'doctorName', 'doctor.doctorName', 'Referring Doctor', 'Name of referring doctor', 'string', NULL, 20),
(4, 'doctor', 'clinicName', 'doctor.clinicName', 'Clinic Name', 'Referring clinic name', 'string', NULL, 21);
