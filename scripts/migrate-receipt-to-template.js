/**
 * Migration Script: Convert Current Receipt to Template System
 *
 * This script creates a template-based version of the existing thermal receipt
 * from receiptGenerator.js and inserts it into the database.
 */

import {
    createTemplate,
    createTemplateElement,
    getDocumentTypes
} from '../services/database/queries/template-queries.js';

/**
 * Create the default receipt template for Shwan Orthodontics
 */
async function migrateReceiptToTemplate() {
    console.log('🚀 Starting Receipt Template Migration...\n');

    try {
        // Step 1: Get document types to find the receipt type ID
        console.log('📋 Step 1: Fetching document types...');
        const documentTypes = await getDocumentTypes();
        const receiptType = documentTypes.find(dt => dt.type_code === 'receipt');

        if (!receiptType) {
            throw new Error('Receipt document type not found in database');
        }
        console.log(`✅ Found receipt type: ID=${receiptType.type_id}\n`);

        // Step 2: Create the template
        console.log('📝 Step 2: Creating receipt template...');
        const templateData = {
            template_name: 'Shwan Orthodontics Default Receipt',
            description: 'Default thermal printer receipt (80mm) for payment transactions',
            document_type_id: receiptType.type_id,
            paper_width: 80,           // 80mm thermal paper
            paper_height: 297,          // Roughly A4 height in mm
            paper_orientation: 'portrait',
            paper_margin_top: 5,
            paper_margin_right: 5,
            paper_margin_bottom: 5,
            paper_margin_left: 5,
            background_color: '#FFFFFF',
            show_grid: false,
            grid_size: 10,
            is_default: true,           // Set as default receipt template
            is_active: true,
            is_system: true,            // Protect from deletion
            created_by: 'migration_script'
        };

        const templateId = await createTemplate(templateData);
        console.log(`✅ Template created: ID=${templateId}\n`);

        // Step 3: Create template elements
        console.log('🎨 Step 3: Creating template elements...\n');

        const elements = [];

        // ===== CLINIC HEADER =====
        elements.push({
            element_type: 'static_text',
            element_name: 'Clinic Name Header',
            element_label: 'SHWAN ORTHODONTICS',
            element_order: 10,
            is_locked: false,
            pos_x: 0,
            pos_y: 10,
            width: 70,
            height: 15,
            font_family: 'Arial',
            font_size: 18,
            font_weight: 'bold',
            text_align: 'center',
            text_color: '#000000',
            background_color: 'transparent',
            static_content: 'SHWAN ORTHODONTICS',
            margin_left: 5,
            margin_right: 5
        });

        elements.push({
            element_type: 'static_text',
            element_name: 'Clinic Location',
            element_order: 20,
            is_locked: false,
            pos_x: 0,
            pos_y: 30,
            width: 70,
            height: 10,
            font_family: 'Arial',
            font_size: 10,
            font_weight: 'normal',
            text_align: 'center',
            text_color: '#333333',
            background_color: 'transparent',
            static_content: '📍 Sulaymaniyah, Kurdistan - Iraq',
            margin_left: 5,
            margin_right: 5
        });

        elements.push({
            element_type: 'static_text',
            element_name: 'Clinic Contact',
            element_order: 30,
            is_locked: false,
            pos_x: 0,
            pos_y: 42,
            width: 70,
            height: 10,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'center',
            text_color: '#333333',
            background_color: 'transparent',
            static_content: '📞 +964 750 123 4567 | +964 770 987 6543',
            margin_left: 5,
            margin_right: 5
        });

        // ===== DIVIDER 1 =====
        elements.push({
            element_type: 'line',
            element_name: 'Divider 1',
            element_order: 40,
            is_locked: false,
            pos_x: 5,
            pos_y: 58,
            width: 70,
            height: 1,
            line_orientation: 'horizontal',
            line_thickness: 1,
            line_style: 'dashed',
            text_color: '#CCCCCC'
        });

        // ===== INVOICE HEADER =====
        elements.push({
            element_type: 'static_text',
            element_name: 'Invoice Title',
            element_order: 50,
            is_locked: false,
            pos_x: 0,
            pos_y: 65,
            width: 70,
            height: 12,
            font_family: 'Arial',
            font_size: 14,
            font_weight: 'bold',
            text_align: 'center',
            text_color: '#000000',
            background_color: 'transparent',
            static_content: 'PAYMENT RECEIPT',
            margin_left: 5,
            margin_right: 5
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Invoice Date',
            element_order: 60,
            is_locked: false,
            pos_x: 5,
            pos_y: 82,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'center',
            text_color: '#000000',
            data_binding: 'payment.PaymentDateTime',
            data_category: 'payment',
            format_pattern: 'date:MMM DD, YYYY HH:mm'
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Receipt Number',
            element_order: 70,
            is_locked: false,
            pos_x: 5,
            pos_y: 92,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'center',
            text_color: '#000000',
            data_binding: 'work.WorkID',
            data_category: 'work',
            format_pattern: 'receipt_number'
        });

        // ===== DIVIDER 2 =====
        elements.push({
            element_type: 'line',
            element_name: 'Divider 2',
            element_order: 80,
            is_locked: false,
            pos_x: 5,
            pos_y: 105,
            width: 70,
            height: 1,
            line_orientation: 'horizontal',
            line_thickness: 1,
            line_style: 'dashed',
            text_color: '#CCCCCC'
        });

        // ===== PATIENT INFORMATION SECTION =====
        elements.push({
            element_type: 'static_text',
            element_name: 'Patient Info Label',
            element_order: 90,
            is_locked: false,
            pos_x: 5,
            pos_y: 112,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 10,
            font_weight: 'bold',
            text_align: 'left',
            text_color: '#000000',
            background_color: 'transparent',
            static_content: 'PATIENT INFORMATION'
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Patient Name Field',
            element_order: 100,
            is_locked: false,
            pos_x: 5,
            pos_y: 125,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'patient.PatientName',
            data_category: 'patient',
            static_content: 'Name: '
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Patient Phone Field',
            element_order: 110,
            is_locked: false,
            pos_x: 5,
            pos_y: 135,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'patient.Phone',
            data_category: 'patient',
            static_content: 'Phone: '
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Patient ID Field',
            element_order: 120,
            is_locked: false,
            pos_x: 5,
            pos_y: 145,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'patient.PersonID',
            data_category: 'patient',
            static_content: 'Patient ID: '
        });

        // ===== NEXT APPOINTMENT SECTION =====
        elements.push({
            element_type: 'static_text',
            element_name: 'Next Appointment Label',
            element_order: 130,
            is_locked: false,
            pos_x: 5,
            pos_y: 160,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 10,
            font_weight: 'bold',
            text_align: 'left',
            text_color: '#000000',
            background_color: 'transparent',
            static_content: 'NEXT APPOINTMENT'
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Appointment Date Field',
            element_order: 140,
            is_locked: false,
            pos_x: 5,
            pos_y: 173,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'patient.AppDate',
            data_category: 'patient',
            format_pattern: 'date:MMM DD, YYYY HH:mm',
            default_value: 'Not Scheduled',
            hide_if_empty: false
        });

        // ===== PAYMENT DETAILS SECTION =====
        elements.push({
            element_type: 'static_text',
            element_name: 'Payment Details Label',
            element_order: 150,
            is_locked: false,
            pos_x: 5,
            pos_y: 188,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 10,
            font_weight: 'bold',
            text_align: 'left',
            text_color: '#000000',
            background_color: 'transparent',
            static_content: 'PAYMENT DETAILS'
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Total Treatment Cost',
            element_order: 160,
            is_locked: false,
            pos_x: 5,
            pos_y: 201,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'work.TotalRequired',
            data_category: 'work',
            format_pattern: 'currency',
            static_content: 'Total Treatment Cost: '
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Previously Paid',
            element_order: 170,
            is_locked: false,
            pos_x: 5,
            pos_y: 211,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 9,
            font_weight: 'normal',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'payment.PreviouslyPaid',
            data_category: 'payment',
            format_pattern: 'currency',
            static_content: 'Previously Paid: '
        });

        // ===== PAYMENT DIVIDER =====
        elements.push({
            element_type: 'line',
            element_name: 'Payment Divider 1',
            element_order: 180,
            is_locked: false,
            pos_x: 5,
            pos_y: 223,
            width: 70,
            height: 1,
            line_orientation: 'horizontal',
            line_thickness: 1,
            line_style: 'solid',
            text_color: '#CCCCCC'
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Paid Today',
            element_order: 190,
            is_locked: false,
            pos_x: 5,
            pos_y: 228,
            width: 70,
            height: 10,
            font_family: 'Arial',
            font_size: 11,
            font_weight: 'bold',
            text_align: 'left',
            text_color: '#000000',
            background_color: '#F0F0F0',
            data_binding: 'payment.AmountPaidToday',
            data_category: 'payment',
            format_pattern: 'currency',
            static_content: 'Paid Today: ',
            padding_top: 2,
            padding_bottom: 2
        });

        // ===== PAYMENT DIVIDER 2 =====
        elements.push({
            element_type: 'line',
            element_name: 'Payment Divider 2',
            element_order: 200,
            is_locked: false,
            pos_x: 5,
            pos_y: 242,
            width: 70,
            height: 1,
            line_orientation: 'horizontal',
            line_thickness: 1,
            line_style: 'solid',
            text_color: '#CCCCCC'
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Total Paid',
            element_order: 210,
            is_locked: false,
            pos_x: 5,
            pos_y: 247,
            width: 70,
            height: 10,
            font_family: 'Arial',
            font_size: 11,
            font_weight: 'bold',
            text_align: 'left',
            text_color: '#000000',
            data_binding: 'payment.TotalPaid',
            data_category: 'payment',
            format_pattern: 'currency',
            static_content: 'Total Paid: '
        });

        elements.push({
            element_type: 'data_field',
            element_name: 'Remaining Balance',
            element_order: 220,
            is_locked: false,
            pos_x: 5,
            pos_y: 261,
            width: 70,
            height: 10,
            font_family: 'Arial',
            font_size: 11,
            font_weight: 'bold',
            text_align: 'left',
            text_color: '#CC0000',
            data_binding: 'payment.RemainingBalance',
            data_category: 'payment',
            format_pattern: 'currency',
            static_content: 'Remaining Balance: '
        });

        // ===== FOOTER SECTION =====
        elements.push({
            element_type: 'static_text',
            element_name: 'Thank You Message',
            element_order: 230,
            is_locked: false,
            pos_x: 0,
            pos_y: 280,
            width: 70,
            height: 10,
            font_family: 'Arial',
            font_size: 11,
            font_weight: 'bold',
            text_align: 'center',
            text_color: '#000000',
            background_color: 'transparent',
            static_content: 'Thank you for your payment!',
            margin_left: 5,
            margin_right: 5
        });

        elements.push({
            element_type: 'static_text',
            element_name: 'Footer Note',
            element_order: 240,
            is_locked: false,
            pos_x: 0,
            pos_y: 292,
            width: 70,
            height: 8,
            font_family: 'Arial',
            font_size: 8,
            font_weight: 'normal',
            text_align: 'center',
            text_color: '#666666',
            background_color: 'transparent',
            static_content: 'Keep this receipt for your records',
            margin_left: 5,
            margin_right: 5
        });

        // Insert all elements
        console.log(`Creating ${elements.length} template elements...`);
        let elementCount = 0;
        for (const element of elements) {
            const elementId = await createTemplateElement(templateId, element);
            elementCount++;
            console.log(`  ✓ Element ${elementCount}/${elements.length}: ${element.element_name} (ID=${elementId})`);
        }

        console.log(`\n✅ All ${elementCount} elements created successfully!\n`);

        // Step 4: Summary
        console.log('═'.repeat(60));
        console.log('📊 MIGRATION SUMMARY');
        console.log('═'.repeat(60));
        console.log(`✅ Template ID: ${templateId}`);
        console.log(`✅ Template Name: ${templateData.template_name}`);
        console.log(`✅ Document Type: ${receiptType.type_name}`);
        console.log(`✅ Paper Size: ${templateData.paper_width}mm x ${templateData.paper_height}mm`);
        console.log(`✅ Total Elements: ${elementCount}`);
        console.log(`✅ Is Default: ${templateData.is_default ? 'Yes' : 'No'}`);
        console.log(`✅ Is System: ${templateData.is_system ? 'Yes' : 'No'}`);
        console.log('═'.repeat(60));
        console.log('\n🎉 Receipt template migration completed successfully!\n');

        return templateId;

    } catch (error) {
        console.error('❌ Migration failed:', error);
        throw error;
    }
}

// Run the migration
migrateReceiptToTemplate()
    .then(() => {
        console.log('✅ Migration script completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Migration script failed:', error);
        process.exit(1);
    });
