/**
 * Fix Receipt Template Layout - Convert to Landscape and Organize Elements
 * Run with: node scripts/fix-receipt-layout-landscape.js
 */

import sql from 'mssql';
import config from '../config/config.js';

async function fixLayout() {
    console.log('🔧 Fixing receipt template layout to LANDSCAPE...\n');

    try {
        // Connect to database
        const pool = await sql.connect(config.database);
        console.log('✅ Connected to database\n');

        // 1. Update template to landscape (A4: 297mm x 210mm)
        console.log('📐 Changing template to LANDSCAPE (297mm x 210mm)...');
        await pool.request().query(`
            UPDATE DocumentTemplates
            SET paper_width = 297,
                paper_height = 210,
                paper_orientation = 'landscape',
                paper_margin_top = 10,
                paper_margin_right = 10,
                paper_margin_bottom = 10,
                paper_margin_left = 10
            WHERE template_id = 2
        `);
        console.log('✅ Template updated to landscape\n');

        // 2. Get all elements
        const result = await pool.request().query(`
            SELECT element_id, element_name, element_order
            FROM TemplateElements
            WHERE template_id = 2
            ORDER BY element_order
        `);
        console.log(`📦 Found ${result.recordset.length} elements to reorganize\n`);

        // 3. Update element positions for landscape layout
        // Convert mm to pixels (96 DPI: 1mm ≈ 3.78px)
        const mm = (val) => Math.round(val * 3.78);

        const updates = [
            // Header Section (Top)
            { id: 1, x: mm(10), y: mm(5), w: mm(280), h: mm(8), name: 'Clinic Name' },
            { id: 2, x: mm(10), y: mm(14), w: mm(280), h: mm(6), name: 'Clinic Address' },
            { id: 3, x: mm(10), y: mm(21), w: mm(280), h: mm(6), name: 'Clinic Phone' },

            // Title (Centered)
            { id: 4, x: mm(100), y: mm(30), w: mm(97), h: mm(10), name: 'Receipt Title' },

            // Separator Line
            { id: 5, x: mm(10), y: mm(42), w: mm(277), h: mm(1), name: 'Line Separator' },

            // Patient Info (Left Column)
            { id: 6, x: mm(10), y: mm(48), w: mm(85), h: mm(6), name: 'Patient Name' },
            { id: 7, x: mm(10), y: mm(55), w: mm(85), h: mm(6), name: 'Patient Code' },
            { id: 8, x: mm(10), y: mm(62), w: mm(85), h: mm(6), name: 'Patient Phone' },

            // Receipt Info (Right Column)
            { id: 9, x: mm(200), y: mm(48), w: mm(85), h: mm(6), name: 'Receipt Date' },
            { id: 10, x: mm(200), y: mm(55), w: mm(85), h: mm(6), name: 'Receipt Number' },

            // Payment Details (3 columns)
            { id: 11, x: mm(10), y: mm(75), w: mm(85), h: mm(6), name: 'Total Amount' },
            { id: 12, x: mm(10), y: mm(82), w: mm(85), h: mm(6), name: 'Paid Amount' },
            { id: 13, x: mm(10), y: mm(89), w: mm(85), h: mm(6), name: 'Previous Balance' },

            { id: 14, x: mm(105), y: mm(75), w: mm(85), h: mm(6), name: 'New Balance' },
            { id: 15, x: mm(105), y: mm(82), w: mm(85), h: mm(6), name: 'Total Paid' },
            { id: 16, x: mm(105), y: mm(89), w: mm(85), h: mm(6), name: 'Remaining Balance' },

            { id: 17, x: mm(200), y: mm(75), w: mm(85), h: mm(6), name: 'Treatment Type' },
            { id: 18, x: mm(200), y: mm(82), w: mm(85), h: mm(6), name: 'Payment Method' },

            // Notes Section (Full Width)
            { id: 19, x: mm(10), y: mm(105), w: mm(275), h: mm(20), name: 'Payment Notes' },
            { id: 20, x: mm(10), y: mm(128), w: mm(275), h: mm(6), name: 'Thank You' },

            // Signatures (Two columns)
            { id: 21, x: mm(10), y: mm(145), w: mm(120), h: mm(15), name: 'Doctor Signature' },
            { id: 22, x: mm(165), y: mm(145), w: mm(120), h: mm(15), name: 'Patient Signature' },

            // Footer
            { id: 23, x: mm(10), y: mm(170), w: mm(275), h: mm(6), name: 'Footer Note' },
            { id: 24, x: mm(10), y: mm(177), w: mm(275), h: mm(6), name: 'Website/Contact' }
        ];

        console.log('📍 Updating element positions...\n');
        for (const update of updates) {
            await pool.request()
                .input('id', sql.Int, update.id)
                .input('x', sql.Decimal(10, 2), update.x)
                .input('y', sql.Decimal(10, 2), update.y)
                .input('w', sql.Decimal(10, 2), update.w)
                .input('h', sql.Decimal(10, 2), update.h)
                .query(`
                    UPDATE TemplateElements
                    SET pos_x = @x,
                        pos_y = @y,
                        width = @w,
                        height = @h
                    WHERE element_id = @id AND template_id = 2
                `);
            console.log(`  ✓ ${update.name.padEnd(25)} → (${update.x}, ${update.y}) ${update.w}×${update.h}px`);
        }

        console.log('\n✅ ALL DONE! Receipt template is now LANDSCAPE with organized layout');
        console.log('📄 Page size: A4 Landscape (297mm × 210mm)');
        console.log('📐 Layout: 3-column design with proper spacing');
        console.log('🖨️  Ready for printing!');
        console.log('\n🔄 Refresh the designer to see changes: http://localhost:3000/template-designer.html\n');

        await pool.close();
        process.exit(0);

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
        process.exit(1);
    }
}

fixLayout();
