import { Request, TYPES } from 'tedious';
import { createConnection } from '../config/database.js';

console.log('🔧 Converting receipt to LANDSCAPE layout...\n');

const connection = createConnection();

connection.on('connect', (err) => {
    if (err) {
        console.error('❌ Connection failed:', err.message);
        process.exit(1);
    }

    console.log('✅ Connected to database\n');
    updateTemplate();
});

function updateTemplate() {
    const sql = `
        -- Update template to landscape
        UPDATE DocumentTemplates
        SET paper_width = 297,
            paper_height = 210,
            paper_orientation = 'landscape',
            paper_margin_top = 10,
            paper_margin_right = 10,
            paper_margin_bottom = 10,
            paper_margin_left = 10
        WHERE template_id = 2;

        -- Update positions (converting mm to pixels at 96 DPI)
        -- Header
        UPDATE TemplateElements SET pos_x = 38, pos_y = 19, width = 1058, height = 30 WHERE element_id = 1 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 53, width = 1058, height = 23 WHERE element_id = 2 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 79, width = 1058, height = 23 WHERE element_id = 3 AND template_id = 2;

        -- Title
        UPDATE TemplateElements SET pos_x = 378, pos_y = 113, width = 367, height = 38 WHERE element_id = 4 AND template_id = 2;

        -- Line
        UPDATE TemplateElements SET pos_x = 38, pos_y = 159, width = 1047, height = 4 WHERE element_id = 5 AND template_id = 2;

        -- Patient info (left)
        UPDATE TemplateElements SET pos_x = 38, pos_y = 181, width = 321, height = 23 WHERE element_id = 6 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 208, width = 321, height = 23 WHERE element_id = 7 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 234, width = 321, height = 23 WHERE element_id = 8 AND template_id = 2;

        -- Receipt info (right)
        UPDATE TemplateElements SET pos_x = 756, pos_y = 181, width = 321, height = 23 WHERE element_id = 9 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 756, pos_y = 208, width = 321, height = 23 WHERE element_id = 10 AND template_id = 2;

        -- Payment (left column)
        UPDATE TemplateElements SET pos_x = 38, pos_y = 284, width = 321, height = 23 WHERE element_id = 11 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 310, width = 321, height = 23 WHERE element_id = 12 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 336, width = 321, height = 23 WHERE element_id = 13 AND template_id = 2;

        -- Balance (middle column)
        UPDATE TemplateElements SET pos_x = 397, pos_y = 284, width = 321, height = 23 WHERE element_id = 14 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 397, pos_y = 310, width = 321, height = 23 WHERE element_id = 15 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 397, pos_y = 336, width = 321, height = 23 WHERE element_id = 16 AND template_id = 2;

        -- Treatment (right column)
        UPDATE TemplateElements SET pos_x = 756, pos_y = 284, width = 321, height = 23 WHERE element_id = 17 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 756, pos_y = 310, width = 321, height = 23 WHERE element_id = 18 AND template_id = 2;

        -- Notes
        UPDATE TemplateElements SET pos_x = 38, pos_y = 397, width = 1039, height = 76 WHERE element_id = 19 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 484, width = 1039, height = 23 WHERE element_id = 20 AND template_id = 2;

        -- Signatures
        UPDATE TemplateElements SET pos_x = 38, pos_y = 548, width = 454, height = 57 WHERE element_id = 21 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 623, pos_y = 548, width = 454, height = 57 WHERE element_id = 22 AND template_id = 2;

        -- Footer
        UPDATE TemplateElements SET pos_x = 38, pos_y = 643, width = 1039, height = 23 WHERE element_id = 23 AND template_id = 2;
        UPDATE TemplateElements SET pos_x = 38, pos_y = 669, width = 1039, height = 23 WHERE element_id = 24 AND template_id = 2;

        SELECT 'SUCCESS' as status;
    `;

    const request = new Request(sql, (err, rowCount) => {
        if (err) {
            console.error('❌ Update failed:', err.message);
            connection.close();
            process.exit(1);
        } else {
            console.log('✅ Template updated to LANDSCAPE!');
            console.log('📄 Size: A4 Landscape (297mm × 210mm)');
            console.log('📐 Layout: 3-column organized design');
            console.log('🖨️  Ready for printing!');
            console.log('\n🔄 Refresh designer: http://localhost:3000/template-designer.html\n');
            connection.close();
            process.exit(0);
        }
    });

    request.on('row', (columns) => {
        if (columns[0].value === 'SUCCESS') {
            console.log('✓ All elements repositioned');
        }
    });

    connection.execSql(request);
}

connection.connect();
