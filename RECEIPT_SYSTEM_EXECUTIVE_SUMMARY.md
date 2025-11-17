# Receipt Printing System - Executive Summary

## Quick Reference

### Core Components

| Component | Location | Purpose |
|-----------|----------|---------|
| **Receipt Service** | `services/templates/receipt-service.js` | Generates HTML receipts from database data + file templates |
| **Payment Modal** | `public/js/components/react/PaymentModal.jsx` | Handles payment entry and displays receipt printing option |
| **Work Card** | `public/js/components/react/WorkCard.jsx` | Shows work summary with print receipt button |
| **WhatsApp Service** | `services/messaging/whatsapp.js` | Sends messages via WhatsApp Web.js |
| **Phone Formatter** | `utils/phoneFormatter.js` | Converts phone numbers to WhatsApp format |
| **Toast Notifications** | `public/js/components/expenses/Toast.jsx` | Shows success/error notifications to user |

---

## How It Works (End-to-End)

### 1. User Actions
- User opens a patient's works (in PatientShell)
- Clicks "Add Payment" on work card
- Fills in payment form and submits
- Sees success message with "Print Receipt" button
- Can print or close modal

### 2. Data Flow
```
PaymentModal → /api/addInvoice → Database (tblInvoice)
                    ↓
           Payment saved
                    ↓
        Show success screen
                    ↓
      User clicks "Print Receipt"
                    ↓
  /api/templates/receipt/work/{workId}
                    ↓
    receipt-service.generateReceiptHTML()
                    ↓
      1. Load template from filesystem
      2. Query V_Report for patient/payment data
      3. Render template (replace {{placeholders}})
      4. Return HTML
                    ↓
        Browser opens print window
        Auto-prints with Ctrl+P
```

### 3. Patient Data Used
- **PersonID** - Patient ID from database
- **PatientName** - Used on receipt
- **Phone** - PRIMARY FIELD for WhatsApp integration
- **AppDate** - Treatment start date
- **TotalRequired** - Full cost
- **TotalPaid** - Amount paid to date
- **Currency** - USD or IQD

---

## Key Database Views & Tables

### V_Report View (Most Important)
**Purpose:** Single query for all receipt data
- **Source:** Joins tblpatients + tblwork + tblInvoice
- **Contains:** All fields needed for receipt generation
- **Phone field:** YES - includes patient phone ✓

### tblpatients Table
| Field | Example |
|-------|---------|
| PersonID | 1234 |
| PatientName | Ahmed Ali |
| Phone | 07701234567 |
| Phone2 | 07703456789 |

---

## Template System

### How Templates Work
1. **Template files** stored in: `data/templates/`
2. **Template metadata** in: `DocumentTemplates` table
3. **Placeholder syntax:** `{{field.property|filter|options}}`

### Example Placeholders
```html
<h2>{{patient.PatientName}}</h2>
<p>Phone: {{patient.Phone|default:Not Available}}</p>
<p>Treatment Date: {{patient.AppDate|date:DD/MM/YYYY}}</p>
<p>Total Cost: {{work.TotalRequired|currency}} {{work.Currency}}</p>
<p>Amount Paid: {{payment.TotalPaid|currency}} {{work.Currency}}</p>
<p>Balance: {{payment.RemainingBalance|currency}} {{work.Currency}}</p>
<p>Payment Date: {{payment.PaymentDateTime|date:YYYY-MM-DD HH:mm}}</p>
```

### Available Filters
- `|currency` - Format number with commas (35,000)
- `|date:FORMAT` - Format dates (YYYY-MM-DD, DD/MM/YYYY, etc.)
- `|default:text` - Show fallback text if field is empty

---

## WhatsApp Integration Points

### Phone Formatter
```javascript
import PhoneFormatter from 'utils/phoneFormatter.js';

// Convert "07701234567" to "+9647701234567"
const formattedPhone = PhoneFormatter.forWhatsApp(patientPhone, '964');
```

### WhatsApp Service
```javascript
import whatsapp from 'services/messaging/whatsapp.js';

// Send message
const result = await whatsapp.sendSingleMessage(
    '+9647701234567',           // Formatted phone
    'Your receipt...',          // Message text
    'Ahmed Ali',                // Patient name (for logging)
    null                        // Appointment ID (optional)
);

// Result: { success: true, messageId: "..." }
```

### Check If Ready
```javascript
if (!whatsapp.isReady()) {
    // WhatsApp client not initialized
    alert('Please initialize WhatsApp first');
} else {
    // Safe to send
    await whatsapp.sendSingleMessage(...);
}
```

---

## Frontend Notification System

### Using Toasts
```javascript
import { useToast } from 'public/js/components/expenses/Toast.jsx';

const { success, error, warning, info } = useToast();

// Usage:
success('Receipt sent via WhatsApp!', 3000);        // Auto-dismiss in 3s
error('Failed to send WhatsApp', 5000);             // Red, 5s
warning('WhatsApp client not ready', 4000);         // Yellow
info('Sending receipt via WhatsApp...', 0);         // Blue (manual close)
```

### Toast Types
| Type | Icon | Color | Auto-Dismiss |
|------|------|-------|--------------|
| success | ✓ | Green | Yes (3s) |
| error | ✕ | Red | Yes (3s) |
| warning | ⚠ | Yellow | Yes (3s) |
| info | ℹ | Blue | Yes (3s) |

---

## API Endpoints Summary

### Receipt Generation
```http
GET /api/templates/receipt/work/{workId}
Returns: HTML string (Content-Type: text/html)
```

### Payment
```http
POST /api/addInvoice
Body: {workid, amountPaid, paymentDate, usdReceived, iqdReceived, change}
Returns: {status: 'success', data: {...}}
```

### Patient Info
```http
GET /api/getinfos?code={patientId}
Returns: {PersonID, PatientName, Phone, Phone2, ...}
```

### Work Data for Receipt
```http
GET /api/getworkforreceipt/{workId}
Returns: {PersonID, PatientName, Phone, TotalRequired, TotalPaid, Currency}
```

---

## For WhatsApp Receipt Integration

### What's Already Available
✓ Receipt service generates HTML  
✓ Phone numbers stored in database (V_Report, tblpatients)  
✓ PhoneFormatter handles number conversion  
✓ WhatsApp service ready to send messages  
✓ Toast notification system for user feedback  

### What Would Need to Be Added
- "Send via WhatsApp" button in PaymentModal success screen
- WhatsApp send handler function
- Receipt format/template for WhatsApp message
- Error handling and retry logic
- Loading states while sending
- Success/error toast notifications

### Implementation Steps
1. Add button next to "Print Receipt" in PaymentModal (line ~1143)
2. Create handleSendWhatsApp() function
3. Get patient phone from workData or V_Report
4. Format phone using PhoneFormatter.forWhatsApp()
5. Check whatsapp.isReady() before sending
6. Call whatsapp.sendSingleMessage()
7. Show toast notification with result

---

## File Locations (Absolute Paths)

```
/home/user/ShwNodApp/
├── services/templates/
│   └── receipt-service.js (256 lines) - Core receipt generation
├── services/messaging/
│   ├── whatsapp.js (1400+ lines) - WhatsApp client
│   └── websocket-events.js - Real-time updates
├── utils/
│   └── phoneFormatter.js (214 lines) - Phone number utilities
├── public/js/components/react/
│   ├── PaymentModal.jsx (1169 lines) - Payment form + print
│   ├── WorkCard.jsx (251 lines) - Work summary card
│   └── WorkComponent.jsx (984 lines) - Work list manager
├── public/js/components/expenses/
│   └── Toast.jsx (83 lines) - Notification system
├── routes/api/
│   ├── payment.routes.js (378 lines) - Payment endpoints
│   ├── patient.routes.js (200+ lines) - Patient endpoints
│   └── template-api.js (370 lines) - Receipt generation endpoint
└── routes/
    └── template-api.js - Receipt API (GET /api/templates/receipt/...)
```

---

## Database Query Examples

### Get Receipt Data
```sql
SELECT PersonID, PatientName, Phone, TotalRequired, TotalPaid, Currency, 
       Dateofpayment, Amountpaid, workid, AppDate
FROM dbo.V_Report 
WHERE workid = 5678
```

### Get Patient by ID
```sql
SELECT PersonID, PatientName, Phone, Phone2
FROM dbo.tblpatients
WHERE PersonID = 1234
```

### Get Template
```sql
SELECT template_file_path
FROM DocumentTemplates
WHERE document_type_id = 1 AND is_default = 1 AND is_active = 1
```

---

## Common Scenarios

### Scenario 1: Print Receipt After Payment
1. User fills PaymentModal
2. Clicks "Save Payment"
3. Payment saved → Success screen shown
4. User clicks "Print Receipt"
5. Browser opens new window with receipt HTML
6. Auto-print dialog appears (Ctrl+P)

### Scenario 2: Print Receipt from Work Card
1. User views patient's works
2. Expands a work card
3. Clicks "Print Receipt" button
4. Browser opens receipt in new tab
5. Manual print from browser

### Scenario 3: Send Receipt via WhatsApp (Future)
1. User fills PaymentModal
2. Clicks "Save Payment"
3. Success screen shown with "Send via WhatsApp" button
4. User clicks button
5. System:
   - Gets patient phone from workData
   - Formats for WhatsApp
   - Generates receipt HTML
   - Sends via WhatsApp
   - Shows success/error toast
6. Receipt delivered to patient on WhatsApp

---

## Troubleshooting

### Receipt shows [object Object] or {{placeholder}}
- Template not found or file path wrong
- Check DocumentTemplates table
- Verify file exists in data/templates/

### Receipt has empty fields
- Check if data is in database
- V_Report might not have the work data
- Verify work and payment records exist

### WhatsApp send fails
- `whatsapp.isReady()` returned false
- Client needs QR scan authentication
- Circuit breaker may be open (needs restart)

### Phone number invalid
- Check format in database
- Use PhoneFormatter.isValid() to verify
- Must match Iraqi mobile pattern (75x, 77x, 78x, 79x)

---

## Summary

The receipt system is well-architected with:
- Clean separation of concerns (service, route, component)
- Template-driven design for flexibility
- Comprehensive data structure for all receipt info
- Ready-to-use WhatsApp service
- User-friendly toast notifications

To add WhatsApp receipt delivery, you mainly need to:
1. Add a button in PaymentModal
2. Write a handler function
3. Use existing WhatsApp service
4. Show notifications to user

All supporting infrastructure is already in place!

