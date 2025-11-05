/**
 * Convert Receipt Template to LANDSCAPE Layout
 * Reorganizes all elements for A4 landscape printing
 */

import { Connection, Request } from 'tedious';
import dotenv from 'dotenv';

dotenv.config();

// Database configuration
const config = {
    server: process.env.DB_SERVER,
    authentication: {
        type: 'default',
        options: {
            userName: process.env.DB_USER,
            password: process.env.DB_PASSWORD,
        }
    },
    options: {
        port: parseInt(process.env.DB_PORT) || 1433,
        database: process.env.DB_DATABASE || 'shwan',
        encrypt: false,
        trustServerCertificate: true,
        instanceName: process.env.DB_INSTANCE || ''
    }
};

const connection = new Connection(config);

console.log('\n🔧 CONVERTING RECEIPT TEMPLATE TO LANDSCAPE LAYOUT\n');
console.log('=' .repeat(60));

connection.on('connect', err => {
    if (err) {
        console.error('\n❌ Database connection failed:', err.message);
        process.exit(1);
    }

    console.log('\n✅ Connected to database');
    console.log('📐 Target: A4 Landscape (297mm × 210mm)');
    console.log('📋 Updating template and 24 elements...\n');

    executeUpdate();
});

connection.on('error', err => {
    console.error('\n❌ Connection error:', err.message);
});

function executeUpdate() {
    const sql = `
        -- Step 1: Update template to landscape
        UPDATE DocumentTemplates
        SET paper_width = 297,
            paper_height = 210,
            paper_orientation = 'landscape',
            paper_margin_top = 10,
            paper_margin_right = 10,
            paper_margin_bottom = 10,
            paper_margin_left = 10
        WHERE template_id = 2;

        -- Step 2: Reorganize elements (positions in pixels at 96 DPI)
        -- A4 Landscape: 297mm × 210mm = ~1123px × 794px

        -- HEADER SECTION (Top full width)
        UPDATE TemplateElements SET pos_x = 10, pos_y = 10, width = 400, height = 25, font_size = 18 WHERE element_id = 1 AND template_id = 2; -- Clinic Name
        UPDATE TemplateElements SET pos_x = 10, pos_y = 40, width = 400, height = 18 WHERE element_id = 2 AND template_id = 2; -- Clinic Address
        UPDATE TemplateElements SET pos_x = 10, pos_y = 62, width = 400, height = 18 WHERE element_id = 3 AND template_id = 2; -- Clinic Phone

        -- TITLE (Centered)
        UPDATE TemplateElements SET pos_x = 400, pos_y = 20, width = 300, height = 30, text_align = 'center', font_size = 20 WHERE element_id = 4 AND template_id = 2; -- Receipt Title

        -- SEPARATOR LINE
        UPDATE TemplateElements SET pos_x = 10, pos_y = 90, width = 1100, height = 2 WHERE element_id = 5 AND template_id = 2;

        -- PATIENT INFORMATION (Left column)
        UPDATE TemplateElements SET pos_x = 10, pos_y = 105, width = 350, height = 18 WHERE element_id = 6 AND template_id = 2; -- Patient Name
        UPDATE TemplateElements SET pos_x = 10, pos_y = 127, width = 350, height = 18 WHERE element_id = 7 AND template_id = 2; -- Patient Code
        UPDATE TemplateElements SET pos_x = 10, pos_y = 149, width = 350, height = 18 WHERE element_id = 8 AND template_id = 2; -- Patient Phone

        -- RECEIPT INFORMATION (Right column)
        UPDATE TemplateElements SET pos_x = 750, pos_y = 105, width = 360, height = 18 WHERE element_id = 9 AND template_id = 2; -- Receipt Date
        UPDATE TemplateElements SET pos_x = 750, pos_y = 127, width = 360, height = 18 WHERE element_id = 10 AND template_id = 2; -- Receipt Number

        -- PAYMENT SECTION (3 columns layout)
        -- Left column
        UPDATE TemplateElements SET pos_x = 10, pos_y = 190, width = 350, height = 20 WHERE element_id = 11 AND template_id = 2; -- Total Amount
        UPDATE TemplateElements SET pos_x = 10, pos_y = 214, width = 350, height = 20 WHERE element_id = 12 AND template_id = 2; -- Paid Amount
        UPDATE TemplateElements SET pos_x = 10, pos_y = 238, width = 350, height = 20 WHERE element_id = 13 AND template_id = 2; -- Previous Balance

        -- Middle column
        UPDATE TemplateElements SET pos_x = 380, pos_y = 190, width = 350, height = 20 WHERE element_id = 14 AND template_id = 2; -- New Balance
        UPDATE TemplateElements SET pos_x = 380, pos_y = 214, width = 350, height = 20 WHERE element_id = 15 AND template_id = 2; -- Total Paid
        UPDATE TemplateElements SET pos_x = 380, pos_y = 238, width = 350, height = 20 WHERE element_id = 16 AND template_id = 2; -- Remaining Balance

        -- Right column
        UPDATE TemplateElements SET pos_x = 750, pos_y = 190, width = 360, height = 20 WHERE element_id = 17 AND template_id = 2; -- Treatment Type
        UPDATE TemplateElements SET pos_x = 750, pos_y = 214, width = 360, height = 20 WHERE element_id = 18 AND template_id = 2; -- Payment Method

        -- NOTES SECTION (Full width)
        UPDATE TemplateElements SET pos_x = 10, pos_y = 280, width = 1100, height = 60 WHERE element_id = 19 AND template_id = 2; -- Payment Notes
        UPDATE TemplateElements SET pos_x = 10, pos_y = 350, width = 1100, height = 20, text_align = 'center' WHERE element_id = 20 AND template_id = 2; -- Thank You

        -- SIGNATURE SECTION (Two columns)
        UPDATE TemplateElements SET pos_x = 10, pos_y = 390, width = 500, height = 40 WHERE element_id = 21 AND template_id = 2; -- Doctor Signature
        UPDATE TemplateElements SET pos_x = 610, pos_y = 390, width = 500, height = 40 WHERE element_id = 22 AND template_id = 2; -- Patient Signature

        -- FOOTER (Bottom full width)
        UPDATE TemplateElements SET pos_x = 10, pos_y = 450, width = 1100, height = 18, text_align = 'center' WHERE element_id = 23 AND template_id = 2; -- Footer Note
        UPDATE TemplateElements SET pos_x = 10, pos_y = 472, width = 1100, height = 18, text_align = 'center' WHERE element_id = 24 AND template_id = 2; -- Website/Contact

        SELECT 'COMPLETE' as status, COUNT(*) as elements_updated FROM TemplateElements WHERE template_id = 2;
    `;

    const request = new Request(sql, (err, rowCount) => {
        if (err) {
            console.error('\n❌ Update failed:', err.message);
            connection.close();
            process.exit(1);
        }
    });

    let successCount = 0;

    request.on('row', columns => {
        const status = columns[0].value;
        const count = columns[1].value;

        if (status === 'COMPLETE') {
            successCount = count;
        }
    });

    request.on('requestCompleted', () => {
        console.log('\n' + '='.repeat(60));
        console.log('✅ SUCCESS! Template converted to LANDSCAPE');
        console.log('=' .repeat(60));
        console.log('\n📄 Template Settings:');
        console.log('   • Size: A4 Landscape (297mm × 210mm)');
        console.log('   • Orientation: Landscape');
        console.log('   • Margins: 10mm all sides');
        console.log(`\n📦 Elements Updated: ${successCount}`);
        console.log('\n📐 New Layout:');
        console.log('   • 3-column design for payment details');
        console.log('   • Full-width header and footer');
        console.log('   • Centered title and thank you message');
        console.log('   • Two-column signature section');
        console.log('\n🖨️  Ready for printing!');
        console.log('\n🔄 Next Steps:');
        console.log('   1. Refresh the designer: http://localhost:3000/template-designer.html');
        console.log('   2. All elements should now be organized in landscape');
        console.log('   3. Adjust positions if needed using drag and drop');
        console.log('\n');

        connection.close();
        process.exit(0);
    });

    connection.execSql(request);
}

console.log('🔌 Connecting to database...');
connection.connect();
