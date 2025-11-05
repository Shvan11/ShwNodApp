# Document Template System

## Overview

A flexible, universal document template designer that supports multiple document types:
- ✅ **Receipts** - 80mm thermal printer receipts
- ✅ **Prescriptions** - A4 medical prescriptions (future)
- ✅ **Referral Letters** - A4 formal referral letters (future)
- ✅ **Invoices** - Detailed billing statements (future)
- ✅ **Appointment Cards** - Reminder cards (future)

## Database Schema

### Core Tables

**DocumentTypes** - Document type definitions
- `receipt` (80mm thermal)
- `prescription` (A4)
- `referral` (A4)
- `invoice` (A4)
- `appointment` (100x150mm card)

**DocumentTemplates** - Template metadata
- Template name, description
- Paper dimensions (width, height, orientation)
- Margins, background color
- Default template flag
- Version tracking

**TemplateElements** - Individual design elements
- Element type (text, data_field, image, line, signature_line)
- Position (x, y) and size (width, height)
- Typography (font, size, weight, alignment, color)
- Spacing (margins, padding)
- Borders and styling
- Data binding (link to patient/payment/prescription data)
- Conditional display rules

**DataFieldDefinitions** - Available data fields for each document type
- Field categories (patient, payment, prescription, referral, clinic, doctor, system)
- Field paths (e.g., `patient.PatientName`, `payment.TotalPaid`)
- Data types and format patterns
- Currently configured:
  - **Receipts**: 21 fields
  - **Prescriptions**: 11 fields
  - **Referrals**: 9 fields

**TemplateUsageLog** - Audit trail
- Track template usage
- Print counts
- Performance metrics

### Data Field Categories

#### Receipt Fields (21 fields)
**Patient**: PatientName, Phone, PersonID
**Payment**: TotalRequired, TotalPaid, amountPaidToday, newBalance, Currency, paymentDate, usdReceived, iqdReceived, change
**Work**: TypeName, workid, AppDate
**Clinic**: clinicName, address, phone1, phone2
**System**: receiptNumber, currentDateTime

#### Prescription Fields (11 fields - future)
**Patient**: PatientName, Age, PersonID, Phone
**Prescription**: medications (array), diagnosis, instructions, prescriptionDate
**Doctor**: doctorName, licenseNumber, signature

#### Referral Fields (9 fields - future)
**Patient**: PatientName, DOB, PersonID
**Referral**: referringTo, referralReason, clinicalFindings, referralDate
**Doctor**: doctorName, clinicName

## Architecture

### Form-Based Visual Editor (Simplified Approach)

Instead of complex drag-and-drop, we use:
- **List-based element management** - Edit elements in a structured form
- **Property panel** - Adjust position, size, fonts, colors
- **Live preview** - Real-time preview with sample/real data
- **Template library** - Save, clone, and manage multiple templates

### Element Types

1. **Static Text** - Fixed content (clinic name, headers, labels)
2. **Data Field** - Dynamic content (patient name, amounts) with data binding
3. **Image** - Logos, photos
4. **Line/Divider** - Visual separators
5. **Signature Line** - For doctor signatures (prescriptions, referrals)
6. **Repeating Elements** - Lists (e.g., medication list)

### Data Binding System

Elements can bind to data using paths:
```javascript
{
  element_type: 'data_field',
  element_name: 'Patient Name',
  data_binding: 'patient.PatientName',
  format_pattern: null
}

{
  element_type: 'data_field',
  element_name: 'Amount Paid',
  data_binding: 'payment.amountPaidToday',
  format_pattern: 'currency' // Auto-formats as currency
}
```

### Print Rendering

Templates are converted to HTML with CSS for printing:
1. Load template from database
2. Load all elements ordered by `element_order`
3. For each element:
   - If `static_content` → use as-is
   - If `data_binding` → resolve from data object
   - Apply all styling (position, fonts, colors, borders)
4. Generate HTML string
5. Use `window.print()` or export to PDF

## API Endpoints (Planned)

```
GET    /api/document-templates              # List all templates
GET    /api/document-templates/:id          # Get template with elements
POST   /api/document-templates              # Create new template
PUT    /api/document-templates/:id          # Update template
DELETE /api/document-templates/:id          # Delete template
POST   /api/document-templates/:id/clone    # Clone template

GET    /api/document-types                  # List document types
GET    /api/data-fields/:documentTypeId     # Get available data fields

POST   /api/document-templates/:id/render   # Render with real data
POST   /api/document-templates/:id/preview  # Preview with sample data
```

## UI Components (Planned)

```
public/js/components/react/DocumentDesigner/
├── DocumentDesigner.jsx          # Main designer page
├── TemplateList.jsx              # Browse/manage templates
├── TemplateEditor.jsx            # Edit template metadata
├── ElementList.jsx               # List of elements (outline view)
├── ElementEditor.jsx             # Edit single element properties
├── PropertyPanel.jsx             # Visual property editor
├── DataFieldBrowser.jsx          # Browse available data fields
├── PreviewPanel.jsx              # Live preview
└── TemplateRenderer.jsx          # Render template to HTML
```

## Migration Path

### Phase 1: Current Receipt → Template (Next Step)
1. Convert existing `receiptGenerator.js` to first template
2. Store in database as default receipt template
3. Update `PaymentModal` to use template system

### Phase 2: Designer UI
1. Build template list/management interface
2. Create simplified element editor (form-based)
3. Add live preview
4. Integrate with dashboard

### Phase 3: Future Document Types
1. Enable prescription templates
2. Enable referral letter templates
3. Add signature capture for prescriptions

## Benefits

✅ **Printer Agnostic** - Works with any printer (thermal, laser, PDF)
✅ **Multi-Document** - Receipts, prescriptions, referrals in one system
✅ **User-Friendly** - Form-based editing (not complex drag-drop)
✅ **Flexible** - Reposition, resize, restyle any element
✅ **Database-Driven** - Version control, templates per user, audit trail
✅ **Future-Proof** - Easy to add new document types and data fields

## Next Steps

1. ✅ Database schema created
2. → Build backend API endpoints
3. → Create template renderer
4. → Build UI components
5. → Migrate current receipt to template
6. → Integrate with PaymentModal
7. → Add to dashboard

