-- =============================================================================
-- CONVERT RECEIPT TEMPLATE TO LANDSCAPE LAYOUT
-- A4 Landscape: 297mm × 210mm (~1123px × 794px at 96 DPI)
-- =============================================================================

-- Step 1: Update template to LANDSCAPE orientation
UPDATE DocumentTemplates
SET paper_width = 297,
    paper_height = 210,
    paper_orientation = 'landscape',
    paper_margin_top = 10,
    paper_margin_right = 10,
    paper_margin_bottom = 10,
    paper_margin_left = 10
WHERE template_id = 2;

PRINT '✓ Template updated to LANDSCAPE (297mm × 210mm)';

-- Step 2: Reorganize all 24 elements for landscape layout
-- Layout: 3-column design with header, sections, and footer

-- =============================================================================
-- HEADER SECTION (Top left)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 10, pos_y = 10, width = 400, height = 25, font_size = 18
WHERE element_id = 1 AND template_id = 2; -- Clinic Name

UPDATE TemplateElements SET pos_x = 10, pos_y = 40, width = 400, height = 18
WHERE element_id = 2 AND template_id = 2; -- Clinic Address

UPDATE TemplateElements SET pos_x = 10, pos_y = 62, width = 400, height = 18
WHERE element_id = 3 AND template_id = 2; -- Clinic Phone

-- =============================================================================
-- TITLE (Top center)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 400, pos_y = 20, width = 300, height = 30, text_align = 'center', font_size = 20
WHERE element_id = 4 AND template_id = 2; -- Receipt Title

-- =============================================================================
-- SEPARATOR LINE (Full width)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 10, pos_y = 90, width = 1100, height = 2
WHERE element_id = 5 AND template_id = 2; -- Horizontal Line

-- =============================================================================
-- PATIENT INFORMATION (Left column)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 10, pos_y = 105, width = 350, height = 18
WHERE element_id = 6 AND template_id = 2; -- Patient Name

UPDATE TemplateElements SET pos_x = 10, pos_y = 127, width = 350, height = 18
WHERE element_id = 7 AND template_id = 2; -- Patient Code

UPDATE TemplateElements SET pos_x = 10, pos_y = 149, width = 350, height = 18
WHERE element_id = 8 AND template_id = 2; -- Patient Phone

-- =============================================================================
-- RECEIPT INFORMATION (Right column)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 750, pos_y = 105, width = 360, height = 18
WHERE element_id = 9 AND template_id = 2; -- Receipt Date

UPDATE TemplateElements SET pos_x = 750, pos_y = 127, width = 360, height = 18
WHERE element_id = 10 AND template_id = 2; -- Receipt Number

-- =============================================================================
-- PAYMENT DETAILS (3-column layout)
-- =============================================================================

-- LEFT COLUMN
UPDATE TemplateElements SET pos_x = 10, pos_y = 190, width = 350, height = 20
WHERE element_id = 11 AND template_id = 2; -- Total Amount

UPDATE TemplateElements SET pos_x = 10, pos_y = 214, width = 350, height = 20
WHERE element_id = 12 AND template_id = 2; -- Paid Amount

UPDATE TemplateElements SET pos_x = 10, pos_y = 238, width = 350, height = 20
WHERE element_id = 13 AND template_id = 2; -- Previous Balance

-- MIDDLE COLUMN
UPDATE TemplateElements SET pos_x = 380, pos_y = 190, width = 350, height = 20
WHERE element_id = 14 AND template_id = 2; -- New Balance

UPDATE TemplateElements SET pos_x = 380, pos_y = 214, width = 350, height = 20
WHERE element_id = 15 AND template_id = 2; -- Total Paid

UPDATE TemplateElements SET pos_x = 380, pos_y = 238, width = 350, height = 20
WHERE element_id = 16 AND template_id = 2; -- Remaining Balance

-- RIGHT COLUMN
UPDATE TemplateElements SET pos_x = 750, pos_y = 190, width = 360, height = 20
WHERE element_id = 17 AND template_id = 2; -- Treatment Type

UPDATE TemplateElements SET pos_x = 750, pos_y = 214, width = 360, height = 20
WHERE element_id = 18 AND template_id = 2; -- Payment Method

-- =============================================================================
-- NOTES SECTION (Full width)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 10, pos_y = 280, width = 1100, height = 60
WHERE element_id = 19 AND template_id = 2; -- Payment Notes

UPDATE TemplateElements SET pos_x = 10, pos_y = 350, width = 1100, height = 20, text_align = 'center'
WHERE element_id = 20 AND template_id = 2; -- Thank You Message

-- =============================================================================
-- SIGNATURE SECTION (Two columns)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 10, pos_y = 390, width = 500, height = 40
WHERE element_id = 21 AND template_id = 2; -- Doctor Signature

UPDATE TemplateElements SET pos_x = 610, pos_y = 390, width = 500, height = 40
WHERE element_id = 22 AND template_id = 2; -- Patient Signature

-- =============================================================================
-- FOOTER (Bottom, centered)
-- =============================================================================
UPDATE TemplateElements SET pos_x = 10, pos_y = 450, width = 1100, height = 18, text_align = 'center'
WHERE element_id = 23 AND template_id = 2; -- Footer Note

UPDATE TemplateElements SET pos_x = 10, pos_y = 472, width = 1100, height = 18, text_align = 'center'
WHERE element_id = 24 AND template_id = 2; -- Website/Contact

-- =============================================================================
-- VERIFICATION
-- =============================================================================
SELECT
    'CONVERSION COMPLETE!' as Status,
    COUNT(*) as Elements_Updated,
    paper_width as Width_mm,
    paper_height as Height_mm,
    paper_orientation as Orientation
FROM TemplateElements
CROSS JOIN DocumentTemplates
WHERE TemplateElements.template_id = 2
  AND DocumentTemplates.template_id = 2
GROUP BY paper_width, paper_height, paper_orientation;

PRINT '';
PRINT '========================================';
PRINT 'LANDSCAPE CONVERSION COMPLETE!';
PRINT '========================================';
PRINT 'Page Size: A4 Landscape (297mm × 210mm)';
PRINT 'Layout: 3-column organized design';
PRINT 'Elements Updated: 24';
PRINT '';
PRINT 'Refresh designer to see changes:';
PRINT 'http://localhost:3000/template-designer.html';
PRINT '========================================';
