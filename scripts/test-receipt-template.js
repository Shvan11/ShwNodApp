/**
 * Test Script: Render Receipt Template with Sample Data
 *
 * This script tests the receipt template rendering with sample payment data
 */

import { getDefaultTemplate } from '../services/database/queries/template-queries.js';
import { renderTemplate, renderTemplateToPrint } from '../services/templates/TemplateRenderer.js';
import fs from 'fs';

async function testReceiptTemplate() {
    console.log('🧪 Testing Receipt Template Rendering...\n');

    try {
        // Step 1: Get the default receipt template
        console.log('📋 Step 1: Fetching default receipt template...');
        const template = await getDefaultTemplate(1); // 1 = receipt type

        if (!template) {
            throw new Error('Default receipt template not found');
        }
        console.log(`✅ Found template: ${template.template_name}`);
        console.log(`   Elements: ${template.elements?.length || 0}\n`);

        // Step 2: Create sample payment data
        console.log('📝 Step 2: Creating sample payment data...');
        const sampleData = {
            patient: {
                PersonID: 'P12345',
                PatientName: 'Ahmad Mohammed Ali',
                Phone: '+964 750 123 4567',
                AppDate: new Date('2025-11-15T14:30:00')
            },
            work: {
                WorkID: 'W789',
                TotalRequired: 3000,
                Currency: 'USD',
                Typeofwork: 'Full Braces Treatment',
                StartDate: new Date('2025-01-10')
            },
            payment: {
                PaymentDateTime: new Date(),
                AmountPaidToday: 500,
                PreviouslyPaid: 1200,
                TotalPaid: 1700,
                RemainingBalance: 1300,
                Currency: 'USD'
            },
            clinic: {
                Name: 'Shwan Orthodontics',
                Location: 'Sulaymaniyah, Kurdistan - Iraq',
                Phone1: '+964 750 123 4567',
                Phone2: '+964 770 987 6543'
            },
            system: {
                CurrentDateTime: new Date(),
                ReceiptNumber: `W789-${Date.now().toString().slice(-6)}`
            }
        };

        console.log('✅ Sample data created\n');

        // Step 3: Render the template
        console.log('🎨 Step 3: Rendering template...');
        const html = renderTemplateToPrint(template, sampleData);

        console.log(`✅ Template rendered (${html.length} characters)\n`);

        // Step 4: Save to file for inspection
        const outputPath = '/home/administrator/projects/ShwNodApp/scripts/test-receipt-output.html';
        fs.writeFileSync(outputPath, html);
        console.log(`💾 Output saved to: ${outputPath}\n`);

        // Step 5: Display preview snippet
        console.log('═'.repeat(60));
        console.log('📄 RENDERED OUTPUT PREVIEW (first 1000 chars)');
        console.log('═'.repeat(60));
        console.log(html.substring(0, 1000));
        console.log('...\n');

        console.log('═'.repeat(60));
        console.log('✅ TEST SUMMARY');
        console.log('═'.repeat(60));
        console.log(`Template ID: ${template.template_id}`);
        console.log(`Template Name: ${template.template_name}`);
        console.log(`Elements Rendered: ${template.elements.length}`);
        console.log(`Output File: ${outputPath}`);
        console.log('═'.repeat(60));
        console.log('\n🎉 Receipt template test completed successfully!\n');

        // Step 6: Test with minimal data (edge case)
        console.log('🧪 Step 6: Testing with minimal data (edge case)...');
        const minimalData = {
            patient: {
                PatientName: 'Test Patient'
            },
            work: {
                WorkID: 'W001'
            },
            payment: {
                AmountPaidToday: 100,
                Currency: 'USD'
            }
        };

        const minimalHtml = renderTemplateToPrint(template, minimalData);
        console.log(`✅ Minimal data test passed (${minimalHtml.length} characters)\n`);

        return true;

    } catch (error) {
        console.error('❌ Test failed:', error);
        throw error;
    }
}

// Run the test
testReceiptTemplate()
    .then(() => {
        console.log('✅ Test script completed!');
        process.exit(0);
    })
    .catch((error) => {
        console.error('❌ Test script failed:', error);
        process.exit(1);
    });
