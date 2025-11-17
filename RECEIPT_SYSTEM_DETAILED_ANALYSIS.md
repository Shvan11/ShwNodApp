# Receipt Printing System - Complete Analysis

## OVERVIEW

The receipt printing system is a multi-layered architecture that:
1. Captures payment data through the PaymentModal
2. Generates personalized receipts using HTML templates and database queries
3. Displays receipts for printing from the frontend
4. Provides integration points for WhatsApp delivery

---

## ARCHITECTURE FLOW DIAGRAM

```
┌──────────────────────────────────────────────────────────────────────┐
│                     RECEIPT PRINTING SYSTEM                          │
└──────────────────────────────────────────────────────────────────────┘

FRONTEND TIER
┌────────────────────────────────────────────────────────────────────────┐
│  User Interactions                                                     │
│  ┌─────────────────────────┐  ┌──────────────────┐                   │
│  │  PaymentModal           │  │  WorkCard        │                   │
│  │  - Add Payment Form     │  │  - Print Receipt │                   │
│  │  - Payment Success Flow │  │    Button        │                   │
│  └────────────┬────────────┘  └────────┬─────────┘                   │
│               │                        │                              │
│               └────────────┬───────────┘                              │
│                            │                                          │
│                            ▼                                          │
│  ┌─────────────────────────────────────────┐                        │
│  │  Receipt Display Handler                │                        │
│  │  - Fetch HTML from /api/templates/...   │                        │
│  │  - Open in print window                 │                        │
│  │  - Auto-print on load                   │                        │
│  └──────────────┬──────────────────────────┘                        │
└─────────────────┼────────────────────────────────────────────────────┘

API TIER
┌────────────────────────────────────────────────────────────────────────┐
│  Express Routes                                                        │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  GET /api/templates/receipt/work/{workId}                       │ │
│  │  ├─ Route: routes/template-api.js (line 348)                    │ │
│  │  ├─ Calls: generateReceiptHTML(workId)                          │ │
│  │  └─ Returns: HTML string (not JSON)                             │ │
│  └──────────────┬───────────────────────────────────────────────────┘ │
│                 │                                                      │
│                 ▼                                                      │
│  ┌──────────────────────────────────────────────────────────────────┐ │
│  │  Payment & Work Data Endpoints                                   │ │
│  │  ├─ POST /api/addInvoice         (line 245)                     │ │
│  │  ├─ GET  /api/getworkforreceipt/{workId}  (line 81)             │ │
│  │  ├─ GET  /api/getpaymenthistory?workId    (line 63)             │ │
│  │  └─ GET  /api/getinfos?code={patientId}   (patient.routes.js)   │ │
│  └──────────────┬───────────────────────────────────────────────────┘ │
└─────────────────┼────────────────────────────────────────────────────┘

SERVICE LAYER
┌────────────────────────────────────────────────────────────────────────┐
│  Receipt Service                                                       │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  generateReceiptHTML(workId)                                   │   │
│  │  1. Get template path from DocumentTemplates table             │   │
│  │  2. Read template file from filesystem                         │   │
│  │  3. Query V_Report view for receipt data                       │   │
│  │  4. renderTemplate(html, data) - Replace placeholders          │   │
│  │  5. Return rendered HTML                                       │   │
│  └─────────────────────────┬──────────────────────────────────────┘   │
│                            │                                          │
│  Data Structure            ▼                                          │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  {                                                              │   │
│  │    patient: {PersonID, PatientName, Phone, AppDate}           │   │
│  │    work: {WorkID, TotalRequired, Currency}                     │   │
│  │    payment: {PaymentDateTime, AmountPaidToday, TotalPaid,      │   │
│  │             RemainingBalance, Currency}                        │   │
│  │  }                                                              │   │
│  └────────────────────────────────────────────────────────────────┘   │
│                                                                        │
│  Template Rendering                                                   │
│  ┌────────────────────────────────────────────────────────────────┐   │
│  │  Placeholder: {{field|filter|options}}                         │   │
│  │  Examples:                                                      │   │
│  │    {{patient.PatientName}}                                      │   │
│  │    {{payment.TotalPaid|currency}}                              │   │
│  │    {{payment.PaymentDateTime|date:YYYY-MM-DD HH:mm}}          │   │
│  │    {{patient.Phone|default:Not Available}}                     │   │
│  └────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────────────────────────────────────────────┘

DATABASE TIER
┌────────────────────────────────────────────────────────────────────────┐
│  Views & Tables                                                        │
│  ┌────────────────────────┐  ┌─────────────────────────────────────┐ │
│  │  dbo.V_Report          │  │  dbo.DocumentTemplates             │ │
│  │  ├─ PersonID           │  │  ├─ document_type_id               │ │
│  │  ├─ PatientName        │  │  ├─ template_name                  │ │
│  │  ├─ Phone              │  │  ├─ template_file_path             │ │
│  │  ├─ workid             │  │  ├─ is_default                     │ │
│  │  ├─ TotalRequired      │  │  └─ is_active                      │ │
│  │  ├─ TotalPaid          │  │                                    │ │
│  │  ├─ Currency           │  │  Template Files                    │ │
│  │  ├─ Dateofpayment      │  │  (HTML with {{placeholders}})      │ │
│  │  └─ Amountpaid         │  │  Location: data/templates/         │ │
│  └────────────────────────┘  └─────────────────────────────────────┘ │
│                                                                        │
│  Supporting Tables                                                    │
│  ├─ dbo.tblpatients    (PatientName, Phone, Phone2)                 │
│  ├─ dbo.tblwork        (WorkID, PersonID, TotalRequired)            │
│  ├─ dbo.tblInvoice     (InvoiceID, workid, Amountpaid)              │
│  └─ dbo.ExchangeRates  (Rate by date for USD/IQD conversion)        │
└────────────────────────────────────────────────────────────────────────┘

FILESYSTEM TIER
┌────────────────────────────────────────────────────────────────────────┐
│  Template Files                                                        │
│  └─ data/templates/                                                   │
│     └─ {templateName}.html  (with {{placeholder}} markup)             │
│        └─ Rendered by renderTemplate() function                       │
└────────────────────────────────────────────────────────────────────────┘
```

---

## 1. RECEIPT SERVICE DETAILED BREAKDOWN

### File Location
`/home/user/ShwNodApp/services/templates/receipt-service.js`

### Core Functions

#### `getReceiptData(workId)`
```javascript
// Input: workId (number)
// Query: SELECT FROM dbo.V_Report WHERE workid = @workId
// Output:
{
  patient: {
    PersonID: 1234,
    PatientName: "Ahmed Ali",
    Phone: "07701234567",
    AppDate: "2024-11-15T00:00:00.000Z"
  },
  work: {
    WorkID: 5678,
    TotalRequired: 500000,  // IQD
    Currency: "IQD"
  },
  payment: {
    PaymentDateTime: "2024-11-17T14:30:00.000Z",
    AmountPaidToday: 250000,
    PreviouslyPaid: 100000,
    TotalPaid: 350000,
    RemainingBalance: 150000,
    Currency: "IQD"
  }
}
```

#### `renderTemplate(templateHTML, data)`
**Purpose:** Replace all `{{placeholder|filter}}` markers with actual values

**Filter Processing:**
1. Currency: `{{payment.TotalPaid|currency}}` → "350,000"
2. Date: `{{payment.PaymentDateTime|date:DD/MM/YYYY}}` → "17/11/2024"
3. Default: `{{patient.Phone2|default:Not provided}}` → "Not provided" if Phone2 is null

**Date Formats Supported:**
- YYYY - 2024
- MM - 11
- MMM - Nov
- MMMM - November
- DD - 17
- HH - 14 (24-hour)
- hh - 02 (12-hour)
- A - PM (uppercase)
- a - pm (lowercase)
- mm - 30 (minutes)
- ss - 45 (seconds)

#### `generateReceiptHTML(workId)`
**Step-by-step execution:**
1. Call `getDefaultTemplatePath()` → loads from DocumentTemplates
2. Read file: `fs.readFile(fullPath, 'utf-8')`
3. Call `getReceiptData(workId)` → fetches V_Report data
4. Call `renderTemplate(templateHTML, data)` → fill placeholders
5. Return completed HTML string

### Database Dependencies

**V_Report View** - Source of receipt data
- Joins: tblpatients, tblwork, tblInvoice
- Provides: All patient, work, and payment info needed
- Grouping: By work ID to get totals

**DocumentTemplates Table** - Template metadata
- Stores: File path, template name, active status
- Query: Selects template where document_type_id=1 (receipt)

---

## 2. FRONTEND RECEIPT TRIGGERS

### PaymentModal Component
**File:** `public/js/components/react/PaymentModal.jsx`

**State Transition:**
```
Initial (form) → handleSubmit() → API call → Success state
                                              ↓
                                    Show success screen
                                    with "Print Receipt" btn
                                              ↓
                                    handlePrint() onClick
```

**handlePrint() Function (lines 501-529):**
```javascript
const handlePrint = async () => {
    try {
        // 1. Fetch receipt HTML
        const response = await fetch(
            `/api/templates/receipt/work/${workData.workid}`
        );
        if (!response.ok) throw new Error('Failed to generate receipt');

        const html = await response.text();

        // 2. Open print window
        const printWindow = window.open('', '_blank', 'width=800,height=600');
        if (!printWindow) {
            throw new Error('Pop-up blocked. Please allow pop-ups.');
        }

        // 3. Write HTML to window
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();

        // 4. Auto-print on load
        printWindow.onload = function() {
            printWindow.focus();
            printWindow.print();
        };
    } catch (err) {
        console.error('Error printing receipt:', err);
        alert(`Failed to print receipt: ${err.message}`);
    }
};
```

**Data Available in PaymentModal:**
- workData (from props)
  - workid ✓ (needed for receipt)
  - TypeName (work type)
  - TotalRequired
  - TotalPaid
  - Currency
- receiptData (local state after payment)
  - All receipt information

### WorkCard Component
**File:** `public/js/components/react/WorkCard.jsx`

**Print Button (lines 224-232):**
```jsx
<button
    type="button"
    className="btn-card-secondary btn-print-receipt"
    onClick={() => onPrintReceipt(work)}
    title="Print today's receipt"
>
    <i className="fas fa-print"></i>
    <span>Print Receipt</span>
</button>
```

**Passed Handler:** `onPrintReceipt={handlePrintReceipt}`

### WorkComponent
**File:** `public/js/components/react/WorkComponent.jsx`

**Handler Implementation (lines 353-356):**
```javascript
const handlePrintReceipt = (work) => {
    // Simple window.open - browser opens URL in new tab
    window.open(`/api/templates/receipt/work/${work.workid}`, '_blank');
};
```

**Key Difference from PaymentModal:**
- WorkCard: Opens URL directly in new window
- PaymentModal: Fetches HTML, writes to window, auto-prints

---

## 3. PATIENT DATA STRUCTURE

### Patient Fields in Database

**Table:** `dbo.tblpatients`

| Field | Type | Usage | Example |
|-------|------|-------|---------|
| PersonID | INT | Patient unique ID | 1234 |
| PatientName | NVARCHAR | Full name for receipt | Ahmed Ali |
| Phone | NVARCHAR | Primary WhatsApp number | 07701234567 |
| Phone2 | NVARCHAR | Fallback phone number | 07703456789 |
| Gender | CHAR | Patient gender | M/F |
| Birthdate | DATE | Age calculation | 1990-05-15 |

### How Phone is Stored
- Format: Local Iraqi format "07XXXXXXXXX" or "7XXXXXXXXX"
- Storage: As stored in database (not international format)
- Conversion: Done by PhoneFormatter utility when needed

### Accessing Patient Data

**API Endpoint:**
```
GET /api/getinfos?code={patientId}
```

**Response:**
```javascript
{
    PersonID: 1234,
    PatientName: "Ahmed Ali",
    Phone: "07701234567",
    Phone2: "07703456789",
    StartDate: "2024-01-15T00:00:00.000Z",
    xrays: [],      // X-ray files
    assets: []      // Asset files
}
```

**Also available through V_Report:**
- Receipt-generating query includes patient phone
- Can be used directly without separate lookup

---

## 4. WHATSAPP MESSAGING SERVICE

### Architecture Overview

**Main Service:** `services/messaging/whatsapp.js`

**Initialization:**
1. Creates WhatsApp Web.js client
2. Uses LocalAuth for persistent login
3. QR code scanning for authentication
4. Circuit breaker for fault tolerance

### Sending Methods

#### `sendSingleMessage(number, message, name, appointmentId, appointmentDate, session)`

**Parameters:**
- `number` (string) - International format "+9647701234567"
- `message` (string) - Message text to send
- `name` (string) - Recipient name for logging
- `appointmentId` (number) - Optional appointment reference
- `appointmentDate` (string) - Optional date reference
- `session` (MessageSession) - Optional session for tracking

**Returns:**
```javascript
{
    success: true,
    messageId: "XXXXXXXXXX",
    timestamp: "2024-11-17T14:30:00Z"
}
// OR
{
    success: false,
    error: "WhatsApp client not ready",
    details: { /* ... */ }
}
```

**Implementation (line 1264):**
```javascript
async sendSingleMessage(number, message, name, appointmentId, appointmentDate, session) {
    // Check client ready
    if (!this.clientState.client) {
        throw new Error("WhatsApp client not ready to send messages");
    }

    try {
        // Convert number to chat ID format
        const chatId = number + "@c.us";

        // Send message
        const sentMessage = await this.clientState.client.sendMessage(chatId, message);

        // Track message state
        await this.messageState.trackMessage({
            id: sentMessage.id._serialized,
            recipient: number,
            text: message,
            timestamp: new Date()
        });

        return {
            success: true,
            messageId: sentMessage.id._serialized
        };
    } catch (error) {
        logger.whatsapp.error(`Error sending message to ${number}`, error);
        return {
            success: false,
            error: error.message
        };
    }
}
```

#### `sendMessages(numbers, messages, names, ids, date)`
**Purpose:** Batch sending with parallel processing
**Handles:** Retry logic, circuit breaker, error recovery

### Client Status

**Check before sending:**
```javascript
if (!whatsapp.isReady()) {
    const status = whatsapp.getStatus();
    // status: {
    //     state: 'CONNECTED' | 'DISCONNECTED' | 'ERROR',
    //     circuitBreakerOpen: boolean,
    //     lastError: string
    // }
}
```

**States:**
- DISCONNECTED - Client not initialized
- INITIALIZING - Waiting for QR scan
- CONNECTED - Ready to send
- ERROR - Failed, needs restart

---

## 5. PHONE FORMATTER UTILITY

**File:** `/home/user/ShwNodApp/utils/phoneFormatter.js`

### PhoneFormatter Methods

#### `forWhatsApp(phone, countryCode = '964')`
**Input:** "07701234567" or "7701234567"
**Output:** "+9647701234567"
**Usage:**
```javascript
const formattedPhone = PhoneFormatter.forWhatsApp(patientPhone, '964');
```

#### `normalize(phone, countryCode = '964')`
**Converts various formats to standard:** "9647701234567"

| Input Format | Output | Logic |
|--------------|--------|-------|
| 07701234567 | 9647701234567 | Replace leading 0 with country code |
| 7701234567 | 9647701234567 | Prepend country code |
| +9647701234567 | 9647701234567 | Remove + prefix |
| 009647701234567 | 9647701234567 | Remove 00 prefix |

#### `isValid(phone, countryCode = '964')`
**Iraqi validation:**
```javascript
// Pattern: 964 + (750|751|770-779|780-784|790-795) + 7 digits
// Example: 9647701234567 ✓
```

### Integration in WhatsApp Routes

```javascript
// From routes/api/whatsapp.routes.js (line 129-130)
const countryCode = messageData.countryCode || '964';
const phoneNumber = PhoneFormatter.forWhatsApp(messageData.phone, countryCode);
```

---

## 6. NOTIFICATION SYSTEM

### Toast Component
**File:** `public/js/components/expenses/Toast.jsx`

#### Using Toasts in Components

```javascript
import { useToast } from '../expenses/Toast.jsx';

function MyComponent() {
    const { success, error, warning, info } = useToast();

    // Usage:
    success('Payment added successfully!', 3000);
    error('Failed to save payment', 5000);
    warning('Please enter amount', 3000);
    info('Processing...', 2000);
}
```

#### Toast Types

| Type | Icon | Color | Use Case |
|------|------|-------|----------|
| success | ✓ | Green | Operation completed |
| error | ✕ | Red | Operation failed |
| warning | ⚠ | Yellow | User attention needed |
| info | ℹ | Blue | Informational message |

#### Toast Features
- Auto-dismisses after duration
- Manual close button
- Stacking multiple toasts
- Smooth animations

---

## 7. API ENDPOINTS REFERENCE

### Receipt Generation
```
GET /api/templates/receipt/work/{workId}
├─ Returns: HTML string (text/html)
├─ Source: receipt-service.js
├─ Database: V_Report view
└─ Used by: PaymentModal, WorkComponent print buttons
```

### Payment Operations
```
POST /api/addInvoice
├─ Body: {workid, amountPaid, paymentDate, usdReceived, iqdReceived, change}
├─ Returns: {status: 'success', data: result}
├─ Triggers: Receipt generation
└─ Sets: paymentSuccess state

GET /api/getworkforreceipt/{workId}
├─ Returns: {PersonID, PatientName, Phone, TotalRequired, TotalPaid, Currency}
├─ Source: V_Report view
└─ Used by: PaymentModal after payment

GET /api/getpaymenthistory?workId={workId}
├─ Returns: [{InvoiceID, Dateofpayment, Amountpaid, ...}]
└─ Used by: Payment history modal
```

### Patient Information
```
GET /api/getinfos?code={patientId}
├─ Returns: {PersonID, PatientName, Phone, Phone2, ...}
├─ Source: tblpatients table
└─ Used by: Patient info display

GET /api/getpayments?code={patientId}
├─ Returns: [{workid, Amountpaid, ...}]
└─ Used by: Financial summaries
```

### Exchange Rates
```
GET /api/getExchangeRateForDate?date={YYYY-MM-DD}
└─ Returns: {status: 'success', exchangeRate: 1406}

POST /api/updateExchangeRateForDate
├─ Body: {date, exchangeRate}
└─ Used by: PaymentModal rate management
```

---

## 8. DATA FLOW FOR WHATSAPP RECEIPT INTEGRATION

### Complete Flow Diagram

```
STEP 1: PAYMENT SUBMISSION
┌──────────────────────────────────────────┐
│ User fills PaymentModal form and submits │
│ - Payment amount                         │
│ - Payment date                           │
│ - Cash received (USD/IQD)                │
└──────────────┬──────────────────────────┘
               │
               ▼
STEP 2: SAVE PAYMENT
┌──────────────────────────────────────────┐
│ POST /api/addInvoice                     │
│ ├─ Insert into tblInvoice                │
│ ├─ Update payment totals                 │
│ └─ Return success                        │
└──────────────┬──────────────────────────┘
               │
               ▼
STEP 3: SHOW SUCCESS & OPTIONS
┌──────────────────────────────────────────┐
│ PaymentModal shows success screen        │
│ ├─ "Payment recorded successfully!"      │
│ ├─ Amount paid shown                     │
│ └─ Two buttons:                          │
│    ├─ "Print Receipt" ──┐                │
│    └─ "Done"            │                │
│                         ▼                │
│ ┌──────────────────────────┐            │
│ │ [NEW] "Send via WhatsApp"│             │
│ └───────────┬──────────────┘            │
└────────────┼────────────────────────────┘
             │
             ▼ (User clicks "Send via WhatsApp")
STEP 4: PREPARE WHATSAPP SEND
┌──────────────────────────────────────────┐
│ getData:                                 │
│ - workId = workData.workid               │
│ - patientPhone = from V_Report           │
│ - format phone = PhoneFormatter.forWA()  │
└──────────────┬──────────────────────────┘
               │
               ▼
STEP 5: GENERATE RECEIPT
┌──────────────────────────────────────────┐
│ generateReceiptHTML(workId)              │
│ ├─ Load template from filesystem         │
│ ├─ Query V_Report for data               │
│ ├─ Render template with data             │
│ └─ Return HTML string                    │
└──────────────┬──────────────────────────┘
               │
               ▼
STEP 6: SEND VIA WHATSAPP
┌──────────────────────────────────────────┐
│ whatsapp.sendSingleMessage(              │
│   formattedPhone,                        │
│   "Your receipt: [link/attachment]",    │
│   patientName,                           │
│   workId                                 │
│ )                                        │
│                                          │
│ ├─ Check client ready                    │
│ ├─ Format phone to chat ID               │
│ ├─ Send via WhatsApp Web.js              │
│ ├─ Track message state                   │
│ └─ Return {success, messageId}           │
└──────────────┬──────────────────────────┘
               │
        ┌──────┴──────┐
        │             │
        ▼             ▼
    SUCCESS        FAILURE
    ┌──────┐      ┌──────┐
    │ Toast│      │Toast │
    │ "Sent│      │"Failed
    └──────┘      └──────┘
```

---

## 9. KEY FILES SUMMARY

| File | Lines | Purpose |
|------|-------|---------|
| receipt-service.js | 256 | Generate HTML from template |
| PaymentModal.jsx | 1169 | Payment form + print button |
| WorkCard.jsx | 251 | Work display + print button |
| WorkComponent.jsx | 984 | Work list management |
| whatsapp.js | 1400+ | WhatsApp messaging service |
| phoneFormatter.js | 214 | Phone number formatting |
| Toast.jsx | 83 | Notification component |
| payment.routes.js | 378 | Payment API endpoints |
| template-api.js | 370 | Template management API |
| patient.routes.js | 200+ | Patient information API |

---

## 10. IMPLEMENTATION CHECKLIST FOR WHATSAPP RECEIPT SENDING

### Requirements
- [x] Receipt service generates HTML ← Already done
- [x] Phone field available in patient data ← Already done
- [x] PhoneFormatter utility exists ← Already done
- [x] WhatsApp service can send messages ← Already done
- [x] Toast notification system available ← Already done
- [x] API endpoints for payments ← Already done

### What Needs to Be Added
- [ ] "Send via WhatsApp" button in PaymentModal success screen
- [ ] WhatsApp send handler function
- [ ] Receipt content format for WhatsApp (text or file)
- [ ] Error handling and retry logic
- [ ] Loading states for WhatsApp sending
- [ ] User-facing success/error messages

### Code Integration Points
1. **PaymentModal** - Add button next to "Print Receipt"
2. **New function** - Compose WhatsApp message with receipt
3. **WhatsApp routes** - Optional: Add receipt-specific endpoint
4. **Toast notifications** - Show sending status
5. **WorkComponent** - Optional: Direct send from work card

