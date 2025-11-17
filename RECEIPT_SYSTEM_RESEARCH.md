# Receipt Printing System Research Summary

## 1. RECEIPT SERVICE ARCHITECTURE

### Receipt Service Location
**File:** `/home/user/ShwNodApp/services/templates/receipt-service.js`

### How Receipt Service Works

#### Data Retrieval (`getReceiptData()`)
- Queries the `dbo.V_Report` database view
- Retrieves fields:
  - `PersonID` - Patient ID
  - `PatientName` - Patient name
  - `Phone` - Patient phone number (primary phone)
  - `TotalPaid` - Total amount paid so far
  - `AppDate` - Appointment date
  - `Dateofpayment` - Payment date/timestamp
  - `Amountpaid` - Amount paid in this transaction
  - `workid` - Work/treatment ID
  - `TotalRequired` - Total cost of treatment
  - `Currency` - Account currency (USD/IQD)

#### Data Structure
Organized into three main objects:
```javascript
{
  patient: {
    PersonID,
    PatientName,
    Phone,
    AppDate
  },
  work: {
    WorkID,
    TotalRequired,
    Currency
  },
  payment: {
    PaymentDateTime,
    AmountPaidToday,
    PreviouslyPaid,
    TotalPaid,
    RemainingBalance,
    Currency
  }
}
```

#### Template System (`renderTemplate()`)
- Uses file-based HTML templates from database
- Location: `DocumentTemplates` table stores `template_file_path`
- Supports placeholder replacement with format: `{{placeholder|filter|options}}`
- Placeholders use dot notation: `patient.PatientName`, `payment.TotalPaid`

#### Available Filters
1. **Currency Filter**: `{{value|currency}}` - Formats numbers with comma separators
2. **Date Filter**: `{{value|date:FORMAT}}` - Formats dates with patterns like:
   - `YYYY` - 4-digit year
   - `MMM` / `MMMM` - Month abbreviation/full name
   - `DD` - Day
   - `HH` - 24-hour format
   - `hh` / `h` - 12-hour format
   - `mm` - Minutes
   - `ss` - Seconds
   - `A` / `a` - AM/PM (uppercase/lowercase)
3. **Default Filter**: `{{value|default:fallback}}` - Provides fallback value

#### HTML Generation (`generateReceiptHTML()`)
1. Gets template path from database
2. Reads template file from filesystem
3. Queries V_Report view for receipt data
4. Renders template with data
5. Returns complete HTML string

---

## 2. FRONTEND RECEIPT PRINTING LOCATIONS

### Primary Locations Where "Print Receipt" is Triggered

#### A. **PaymentModal Component**
**File:** `/home/user/ShwNodApp/public/js/components/react/PaymentModal.jsx`

**Usage Flow:**
1. User adds payment through payment form
2. Payment submitted successfully → `paymentSuccess` state set to true
3. Success screen displayed with "Print Receipt" button
4. `handlePrint()` function triggered on button click:
   ```javascript
   const handlePrint = async () => {
       const response = await fetch(`/api/templates/receipt/work/${workData.workid}`);
       const html = await response.text();
       const printWindow = window.open('', '_blank', 'width=800,height=600');
       printWindow.document.write(html);
       printWindow.onload = () => {
           printWindow.print();
       };
   }
   ```

**Data Flow:**
- Gets `workData.workid` from modal props
- Fetches receipt HTML from `/api/templates/receipt/work/{workId}`
- Opens in print window with auto-print on load

#### B. **WorkCard Component**
**File:** `/home/user/ShwNodApp/public/js/components/react/WorkCard.jsx`

**Button Location:** Secondary Actions section (lines 224-232)
```jsx
<button
    className="btn-card-secondary btn-print-receipt"
    onClick={() => onPrintReceipt(work)}
    title="Print today's receipt"
>
    <i className="fas fa-print"></i>
    <span>Print Receipt</span>
</button>
```

**Triggered by:** User clicking "Print Receipt" button on work card

#### C. **WorkComponent**
**File:** `/home/user/ShwNodApp/public/js/components/react/WorkComponent.jsx`

**Handler Function** (lines 353-356):
```javascript
const handlePrintReceipt = (work) => {
    // Open receipt in new window - template has auto-print on load
    window.open(`/api/templates/receipt/work/${work.workid}`, '_blank');
};
```

**Passed to WorkCard:** `onPrintReceipt={handlePrintReceipt}`

---

## 3. PATIENT DATA STRUCTURE

### Available Patient Fields

**Primary Table:** `dbo.tblpatients`

**Key Fields:**
- `PersonID` - Unique patient identifier (used as `code` in API calls)
- `PatientName` - Full patient name
- `Phone` - Primary phone number
- `Phone2` - Secondary phone number
- Relevant for WhatsApp: Use `Phone` or `Phone2` fields

### How to Access Patient Data

**API Endpoint:** `GET /api/getinfos?code={patientId}`

**Response includes:**
```javascript
{
    PersonID,
    PatientName,
    Phone,
    StartDate,
    xrays,
    assets
}
```

**Also available through work data:**
- `V_Report` view provides patient phone along with receipt data
- Work records include `PatientName`, `Phone` fields

---

## 4. WHATSAPP MESSAGING SERVICE

### WhatsApp Service Architecture

**Main File:** `/home/user/ShwNodApp/services/messaging/whatsapp.js`

### Key Methods Available

#### `sendSingleMessage(number, message, name, appointmentId, appointmentDate, session)`
**Purpose:** Send a single WhatsApp message
**Parameters:**
- `number` - Phone number in WhatsApp format (international, with + prefix)
- `message` - Message text to send
- `name` - Recipient name for logging
- `appointmentId` - Optional appointment reference
- `appointmentDate` - Optional appointment date
- `session` - Optional message session for tracking

**Returns:** Object with:
```javascript
{
    success: boolean,
    messageId: string,
    error: string (if failed)
}
```

#### `sendMessages(numbers, messages, names, ids, date)`
**Purpose:** Send batch messages
**Handles:** Multiple recipients, retry logic, error recovery

### Phone Number Formatting

**Service:** `PhoneFormatter` utility
**Function:** `PhoneFormatter.forWhatsApp(phone, countryCode)`
- Default country code: '964' (Iraq)
- Converts to international format with + prefix
- Example: "7701234567" → "+9647701234567"

**Usage in WhatsApp routes:**
```javascript
const phoneNumber = PhoneFormatter.forWhatsApp(messageData.phone, countryCode);
const result = await whatsapp.sendSingleMessage(
    phoneNumber,
    messageData.message,
    `Patient ${personId}`,
    parseInt(appointmentId)
);
```

### Circuit Breaker Pattern
- WhatsApp service uses circuit breaker for resilience
- Status checked before sending: `if (!whatsapp.isReady()) { /* error */ }`
- Prevents cascading failures with automatic recovery

### Message State Management
- Uses `messageState` for tracking delivery status
- WebSocket events broadcast message updates
- Session tracking for audit trail

---

## 5. NOTIFICATION SYSTEM

### Toast Component
**File:** `/home/user/ShwNodApp/public/js/components/expenses/Toast.jsx`

**Available Functions:**

#### Toast Component
- Single notification display
- Props: `message`, `type`, `duration`, `onClose`
- Types: `success`, `error`, `warning`, `info`

#### useToast Hook
```javascript
const { showToast, success, error, warning, info } = useToast();

// Usage examples:
success('Payment added successfully!', 3000);
error('Failed to process payment', 3000);
warning('Payment amount not entered', 3000);
info('Processing payment...', 5000);
```

**Features:**
- Auto-dismiss after duration (default 3000ms)
- Manual close button
- Custom styling per type
- Smooth fade in/out animations

### Current UI Alerts Used
- `window.alert()` - For errors/confirmations (modal style)
- `window.confirm()` - For yes/no decisions
- `useToast()` - For non-blocking notifications (preferred)
- Error state in components - For persistent error display

---

## 6. API ENDPOINTS INVOLVED

### Payment/Receipt Workflow

#### Payment Management
1. **Get active works for invoice:**
   - `GET /api/getActiveWorkForInvoice?PID={patientId}`
   - Returns list of unpaid/active works

2. **Get work data for receipt:**
   - `GET /api/getworkforreceipt/{workId}`
   - Returns patient and payment data from V_Report

3. **Get payment history:**
   - `GET /api/getpaymenthistory?workId={workId}`
   - Returns all invoices for a work

4. **Add invoice/payment:**
   - `POST /api/addInvoice`
   - Body:
     ```javascript
     {
         workid: number,
         amountPaid: number,
         paymentDate: string (YYYY-MM-DD),
         usdReceived: number,
         iqdReceived: number,
         change: number (nullable)
     }
     ```
   - Response:
     ```javascript
     { status: 'success', data: result }
     ```

5. **Delete invoice:**
   - `DELETE /api/deleteInvoice/{invoiceId}`
   - Requires authentication (secretary/admin)
   - Time-based restrictions apply

#### Exchange Rate Management
1. **Get current rate:**
   - `GET /api/getCurrentExchangeRate`

2. **Get rate for date:**
   - `GET /api/getExchangeRateForDate?date={YYYY-MM-DD}`

3. **Update rate:**
   - `POST /api/updateExchangeRateForDate`
   - Body:
     ```javascript
     {
         date: string,
         exchangeRate: number
     }
     ```

#### Receipt Generation
1. **Generate receipt HTML:**
   - `GET /api/templates/receipt/work/{workId}`
   - Returns HTML string (not JSON)
   - Used directly in `window.open()` or print window

### Patient Information
1. **Get patient info:**
   - `GET /api/getinfos?code={patientId}`
   - Returns name, phone, start date, assets

2. **Get patient payments:**
   - `GET /api/getpayments?code={patientId}`
   - Returns all payments for patient

---

## KEY DATABASE VIEWS & TABLES

### V_Report View
**Purpose:** Centralized view for receipt data
**Fields Used:**
- PersonID, PatientName, Phone
- workid, Typeofwork, TypeName
- TotalRequired, TotalPaid, Currency
- Dateofpayment, Amountpaid
- AppDate

### Important Tables
1. **dbo.tblpatients** - Patient master data
2. **dbo.tblwork** - Treatment/work records
3. **dbo.tblInvoice** - Payment records
4. **dbo.ExchangeRates** - Currency rates by date
5. **DocumentTemplates** - Template metadata & file paths

---

## INTEGRATION POINTS FOR WHATSAPP RECEIPT SENDING

### Required Steps to Add WhatsApp Receipt Sending

1. **Extract phone from receipt data:**
   - Already available in `V_Report` query: `Phone` field
   - Use patient phone (Phone2 as fallback if needed)

2. **Format phone for WhatsApp:**
   - Import `PhoneFormatter` utility
   - Call: `PhoneFormatter.forWhatsApp(phone, '964')`

3. **Create receipt HTML:**
   - Already done by receipt-service
   - Result: `html` from `generateReceiptHTML(workId)`

4. **Send via WhatsApp:**
   - Use whatsapp service: `whatsapp.sendSingleMessage()`
   - Parameters: formatted phone, message text, patient name, appointmentId

5. **Error Handling:**
   - Check `whatsapp.isReady()` before sending
   - Show toast notification on success/failure
   - Handle circuit breaker state

6. **User Feedback:**
   - Show loading state during send
   - Success toast: "Receipt sent via WhatsApp"
   - Error toast: "Failed to send receipt via WhatsApp"

---

## SUMMARY TABLE

| Component | Location | Function |
|-----------|----------|----------|
| Receipt Service | `services/templates/receipt-service.js` | Generate HTML from template |
| Payment Modal | `components/react/PaymentModal.jsx` | Show print receipt button after payment |
| Work Card | `components/react/WorkCard.jsx` | Print receipt button on work |
| Toast System | `components/expenses/Toast.jsx` | Show success/error notifications |
| WhatsApp Service | `services/messaging/whatsapp.js` | Send messages to patients |
| Phone Formatter | `utils/phoneFormatter.js` | Convert to WhatsApp format |
| API Endpoints | `routes/api/payment.routes.js`, `routes/template-api.js` | Serve receipts and payment data |
| Patient Data | `routes/api/patient.routes.js` | Get patient phone numbers |

