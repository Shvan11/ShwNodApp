-- ============================================================================
-- Register No-Work Appointment Receipt Template
-- ============================================================================
-- This script registers the new no-work receipt template in the database
-- so the application can find and use it for generating appointment receipts
-- ============================================================================

USE [master]; -- Replace with your database name if different
GO

-- Check if template already exists
IF EXISTS (
    SELECT 1
    FROM DocumentTemplates
    WHERE template_name = 'No-Work Appointment Receipt'
)
BEGIN
    PRINT 'Template already exists. Updating existing template...';

    UPDATE DocumentTemplates
    SET
        template_file_path = 'data/templates/shwan-orthodontics-no-work-receipt.html',
        is_active = 1,
        is_system = 1,
        modified_by = 'system',
        modified_date = GETDATE()
    WHERE template_name = 'No-Work Appointment Receipt';

    PRINT 'Template updated successfully.';
END
ELSE
BEGIN
    PRINT 'Inserting new template...';

    INSERT INTO DocumentTemplates (
        template_name,
        description,
        document_type_id,
        paper_width,
        paper_height,
        paper_orientation,
        paper_margin_top,
        paper_margin_right,
        paper_margin_bottom,
        paper_margin_left,
        background_color,
        show_grid,
        is_default,
        is_active,
        is_system,
        template_version,
        created_by,
        created_date,
        modified_by,
        modified_date,
        template_file_path
    )
    VALUES (
        'No-Work Appointment Receipt',
        'Thermal receipt template for patients with no works, showing next appointment information',
        1, -- document_type_id = 1 (Receipt)
        190, -- paper_width (mm) - thermal printer width
        75, -- paper_height (mm) - thermal printer height
        'landscape',
        5, -- paper_margin_top (mm)
        5, -- paper_margin_right (mm)
        5, -- paper_margin_bottom (mm)
        5, -- paper_margin_left (mm)
        '#ffffff',
        0, -- show_grid = false
        0, -- is_default = false (not default receipt)
        1, -- is_active = true
        1, -- is_system = true
        1, -- template_version
        'system',
        GETDATE(),
        'system',
        GETDATE(),
        'data/templates/shwan-orthodontics-no-work-receipt.html'
    );

    PRINT 'Template inserted successfully.';
END
GO

-- Verify the template was registered
SELECT
    template_id,
    document_type_id,
    template_name,
    template_file_path,
    is_active,
    is_default,
    is_system_template,
    created_at
FROM DocumentTemplates
WHERE template_name = 'No-Work Appointment Receipt';
GO

PRINT '';
PRINT '============================================================================';
PRINT 'No-Work Appointment Receipt Template Registration Complete';
PRINT '============================================================================';
PRINT 'Template Name: No-Work Appointment Receipt';
PRINT 'Template Path: data/templates/shwan-orthodontics-no-work-receipt.html';
PRINT 'Document Type: Receipt (ID: 1)';
PRINT 'Status: Active, System Template';
PRINT '';
PRINT 'The template is now available for use in the application.';
PRINT 'To test, navigate to a patient with a scheduled appointment and click:';
PRINT '  "Print Appointment Receipt" button in the Works page';
PRINT '============================================================================';
GO
