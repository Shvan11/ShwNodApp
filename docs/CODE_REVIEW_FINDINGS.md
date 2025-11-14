# Backend Code Review Findings
**Date:** 2025-11-14
**Reviewer:** Claude Code
**Scope:** Backend routes analysis (routes/ directory)

---

## 🚨 CRITICAL SECURITY ISSUES

### 1. ✅ NO AUTHENTICATION OR AUTHORIZATION
**Status:** 🟢 **DONE** - Implemented 2025-11-14
**File:** All route files
**Severity:** CRITICAL (was)
**Impact:** Fixed - Session-based authentication now available

**Affected APIs:**
- Patient medical records: `/api/getinfos`, `/api/getpayments`, `/api/gettimepoints`
- Delete invoices: `/api/deleteInvoice/:invoiceId`
- Control WhatsApp: `/api/wa/send`, `/api/wa/restart`, `/api/wa/logout`
- Database config: `/api/config/database`
- Sync operations: `/api/sync/trigger`
- Health monitoring: `/api/health/start`, `/api/health/stop`

**Risk:**
- Unauthorized access to patient medical records (HIPAA/GDPR violation)
- Data deletion/modification by unauthorized users
- System control by malicious actors
- Database corruption via sync manipulation

**Recommendation:**
```javascript
// Add authentication middleware
import { authenticate, authorize } from './middleware/auth.js';

router.use(authenticate); // All routes require login

// Protect admin endpoints
router.delete('/deleteInvoice/:invoiceId',
  authorize(['admin', 'accountant']),
  async (req, res) => { ... }
);
```

---

### 2. ❌ CORS Wide Open - Accepts All Origins
**Status:** 🔴 **TODO**
**File:** `middleware/index.js:13`
**Severity:** CRITICAL

**Code:**
```javascript
res.setHeader('Access-Control-Allow-Origin', '*');
res.setHeader('Access-Control-Allow-Credentials', true);
```

**Issue:** Allows any website to make authenticated requests to your API. This enables:
- Cross-Site Request Forgery (CSRF)
- Data theft from any malicious website
- Session hijacking

**Recommendation:**
```javascript
// middleware/index.js
const allowedOrigins = [
  'https://local.shwan-orthodontics.com',
  'https://shwan-orthodontics.com',
  process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : null,
  process.env.NODE_ENV === 'development' ? 'http://localhost:3000' : null
].filter(Boolean);

app.use(function (req, res, next) {
  const origin = req.headers.origin;
  if (allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, DELETE');
  res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With, content-type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', true);
  next();
});
```

---

### 3. ❌ Missing Webhook Signature Verification
**Status:** 🔴 **TODO**
**File:** `routes/sync-webhook.js:27-32`
**Severity:** HIGH

**Code:**
```javascript
// Verify webhook signature (optional but recommended)
const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
if (webhookSecret) {
    const signature = req.headers['x-supabase-signature'];
    // TODO: Implement signature verification
    // For now, we'll trust the webhook (fine for internal network)
}
```

**Issue:** Anyone can send fake webhook requests to manipulate sync operations between SQL Server and Supabase.

**Recommendation:**
```javascript
import crypto from 'crypto';

const webhookSecret = process.env.SUPABASE_WEBHOOK_SECRET;
if (!webhookSecret) {
  return res.status(500).json({
    success: false,
    error: 'Webhook secret not configured'
  });
}

const signature = req.headers['x-supabase-signature'];
const payload = JSON.stringify(req.body);
const expectedSignature = crypto
  .createHmac('sha256', webhookSecret)
  .update(payload)
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).json({
    success: false,
    error: 'Invalid signature'
  });
}
```

---

### 4. ❌ No Rate Limiting
**Status:** 🔴 **TODO**
**File:** All routes
**Severity:** HIGH

**Issue:** No rate limiting on any endpoint. Attackers can:
- Brute force attempts
- DDoS the application
- Scrape entire patient database
- Spam WhatsApp messages

**Recommendation:**
```javascript
import rateLimit from 'express-rate-limit';

// General API rate limit
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per 15 minutes
  message: 'Too many requests from this IP'
});
app.use('/api/', apiLimiter);

// Strict rate limit for sensitive operations
const strictLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 5, // 5 requests per hour
  message: 'Too many attempts, please try again later'
});
router.post('/wa/send', strictLimiter, async (req, res) => { ... });
router.post('/addInvoice', strictLimiter, async (req, res) => { ... });
```

---

### 5. ❌ Google OAuth Tokens Exposed in HTML Response
**Status:** 🔴 **TODO**
**File:** `routes/admin.js:51-128`
**Severity:** HIGH

**Code:**
```javascript
res.send(`
  <h3>Refresh Token:</h3>
  <div class="token-box">
    ${tokens.refresh_token || 'No refresh token received...'}
  </div>
`);
```

**Issue:**
- OAuth tokens displayed in plain HTML (visible in browser history)
- No XSS escaping on token values
- Tokens could be logged by proxy servers

**Recommendation:**
```javascript
// Return JSON instead of HTML
res.json({
  success: true,
  message: 'Authorization successful',
  instruction: 'Token saved to .env file. Please restart the application.'
});

// Save token server-side automatically
const fs = require('fs');
const envPath = path.join(process.cwd(), '.env');
let envContent = fs.readFileSync(envPath, 'utf-8');
if (!envContent.includes('GOOGLE_DRIVE_REFRESH_TOKEN=')) {
  envContent += `\nGOOGLE_DRIVE_REFRESH_TOKEN=${tokens.refresh_token}`;
  fs.writeFileSync(envPath, envContent);
}
```

---

### 6. ❌ Excessive Request Body Size Limit
**Status:** 🔴 **TODO**
**File:** `middleware/index.js:27-28`
**Severity:** HIGH

**Code:**
```javascript
app.use(express.json({ limit: '200mb' }));
app.use(express.urlencoded({ extended: true, limit: '200mb' }));
```

**Issue:**
- Allows 200MB JSON payloads (enables DDoS via memory exhaustion)
- Typical API requests are < 1MB
- File uploads should use multipart/form-data, not JSON

**Recommendation:**
```javascript
app.use(express.json({ limit: '10mb' })); // Reasonable limit
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// For file uploads, use multer with separate limits
const upload = multer({
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB for files
});
```

---

## ⚠️ HIGH PRIORITY BUGS

### 7. ❌ Missing Input Validation on Date Parameters
**Status:** 🔴 **TODO**
**File:** `routes/api.js` (multiple endpoints)
**Severity:** HIGH

**Issue:** Not all date endpoints have validation. Some exist (line 425 - good), but missing in:
- `/api/getWebApps` (Line 801)
- `/api/getAllTodayApps` (Line 808)
- `/api/getPresentTodayApps` (Line 823)
- `/api/messaging/status/:date` (Line 2123)

**Recommendation:**
```javascript
// Create reusable validation middleware
function validateDateParam(paramName = 'date') {
  return (req, res, next) => {
    const dateValue = req.params[paramName] || req.query[paramName];
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;

    if (!dateValue || !dateRegex.test(dateValue)) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${paramName} format. Use YYYY-MM-DD`
      });
    }

    const date = new Date(dateValue);
    if (isNaN(date.getTime())) {
      return res.status(400).json({
        success: false,
        error: `Invalid ${paramName} value`
      });
    }

    next();
  };
}

// Use it
router.get('/getWebApps', validateDateParam('PDate'), async (req, res) => { ... });
```

---

### 8. ❌ Invoice Payment Uses parseInt() for Currency
**Status:** 🔴 **TODO**
**File:** `routes/api.js:1032-1034`
**Severity:** MEDIUM

**Code:**
```javascript
const usd = parseInt(usdReceived) || 0;
const iqd = parseInt(iqdReceived) || 0;
```

**Issue:**
- Uses `parseInt()` which truncates decimals (100.99 becomes 100)
- Should use `parseFloat()` for currency
- Missing validation for maximum amounts
- No check for overpayment beyond work total

**Recommendation:**
```javascript
// Use proper decimal parsing
const usd = parseFloat(usdReceived) || 0;
const iqd = parseFloat(iqdReceived) || 0;

// Round to 2 decimal places for currency
const roundedUSD = Math.round(usd * 100) / 100;
const roundedIQD = Math.round(iqd * 100) / 100;

// Validate against work total
const totalDue = workDetails.TotalCost - workDetails.PaidAmount;
const paymentValue = accountCurrency === 'USD'
  ? roundedUSD
  : roundedIQD;

if (paymentValue > totalDue * 1.1) { // Allow 10% overpayment buffer
  return res.status(400).json({
    status: 'error',
    message: `Payment amount (${paymentValue}) exceeds remaining balance (${totalDue})`,
    code: 'OVERPAYMENT'
  });
}
```

---

### 9. ❌ Unhandled Promise Rejections in Background Tasks
**Status:** 🔴 **TODO**
**File:** `routes/api.js:469-483, 1889-1910`
**Severity:** HIGH

**Code:**
```javascript
// Line 469 - Send process starts but errors are only logged
whatsapp.send(dateparam).catch(error => {
  console.error(`Error in WhatsApp send process: ${error.message}`);
  // Broadcast error to clients
  if (wsEmitter) { ... }
});
```

**Issue:**
- Errors are caught but not persisted
- No retry mechanism
- Client may not receive error if WebSocket is disconnected
- No database logging of failures

**Recommendation:**
```javascript
// Add error persistence
async function logErrorToDatabase(errorType, errorMessage, errorData) {
  await database.executeQuery(`
    INSERT INTO ErrorLog (ErrorType, ErrorMessage, ErrorData, Timestamp)
    VALUES (@type, @message, @data, GETDATE())
  `, [
    ['type', database.TYPES.NVarChar, errorType],
    ['message', database.TYPES.NVarChar, errorMessage],
    ['data', database.TYPES.NVarChar, JSON.stringify(errorData)]
  ]);
}

whatsapp.send(dateparam).catch(async (error) => {
  console.error(`Error in WhatsApp send process: ${error.message}`);

  // Log to database
  await logErrorToDatabase('WhatsAppSend', error.message, { date: dateparam });

  // Broadcast to clients
  if (wsEmitter) {
    wsEmitter.emit(WebSocketEvents.SYSTEM_ERROR, {
      error: error.message,
      date: dateparam,
      timestamp: new Date().toISOString()
    });
  }
});
```

---

### 10. ❌ Appointment Conflict Check Insufficient
**Status:** 🔴 **TODO**
**File:** `routes/api.js:1301-1316`
**Severity:** MEDIUM

**Code:**
```javascript
// Check for appointment conflicts (same patient, same day)
const conflictCheck = await database.executeQuery(`
  SELECT appointmentID
  FROM tblappointments
  WHERE PersonID = @personID AND CAST(AppDate AS DATE) = CAST(@appDate AS DATE)
`, [
  ['personID', database.TYPES.Int, parseInt(PersonID)],
  ['appDate', database.TYPES.DateTime, AppDate]
]);
```

**Issue:** Only checks for same day, doesn't check:
- Same time slot conflicts
- Doctor availability
- Overlapping appointments
- Clinic capacity limits

**Recommendation:**
```javascript
// Enhanced conflict checking
const conflictCheck = await database.executeQuery(`
  SELECT appointmentID, AppDetail, DrID
  FROM tblappointments
  WHERE PersonID = @personID
    AND CAST(AppDate AS DATE) = CAST(@appDate AS DATE)
    AND AppDate BETWEEN DATEADD(MINUTE, -30, @appDate)
                    AND DATEADD(MINUTE, 30, @appDate)
`, [...]);

if (conflictCheck && conflictCheck.length > 0) {
  return res.status(409).json({
    success: false,
    error: 'Patient already has an appointment within 30 minutes of this time',
    conflictingAppointment: conflictCheck[0]
  });
}

// Also check doctor availability
const doctorConflict = await database.executeQuery(`
  SELECT COUNT(*) as count
  FROM tblappointments
  WHERE DrID = @drID
    AND AppDate = @appDate
`, [...]);

if (doctorConflict[0].count >= MAX_CONCURRENT_APPOINTMENTS) {
  return res.status(409).json({
    success: false,
    error: 'Doctor is fully booked at this time'
  });
}
```

---

## 📊 CODE QUALITY ISSUES

### 11. ❌ Large File Size - api.js is 6708 Lines
**Status:** 🔴 **TODO**
**File:** `routes/api.js`
**Severity:** MEDIUM

**Issue:**
- Single file with 175+ endpoints
- Hard to maintain and review
- Violates Single Responsibility Principle
- Difficult to test

**Recommendation:**
```
routes/api/
  ├── index.js           # Main router
  ├── patients.js        # Patient endpoints (30 routes)
  ├── appointments.js    # Appointment endpoints (25 routes)
  ├── payments.js        # Payment/invoice endpoints (20 routes)
  ├── whatsapp.js        # WhatsApp endpoints (30 routes)
  ├── employees.js       # Employee endpoints (10 routes)
  ├── works.js           # Work/treatment endpoints (25 routes)
  ├── visits.js          # Visit endpoints (15 routes)
  ├── messaging.js       # Messaging endpoints (10 routes)
  └── health.js          # Health check endpoints (10 routes)
```

---

### 12. ❌ Excessive Console Logging (230+ occurrences)
**Status:** 🔴 **TODO**
**File:** `routes/api.js`
**Severity:** MEDIUM

**Issue:**
- 230+ console.log statements in api.js alone
- Logs may contain sensitive patient data
- Performance impact in production
- No log levels (info vs error vs debug)

**Recommendation:**
```javascript
// Use proper logging library
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.json(),
  transports: [
    new winston.transports.File({
      filename: 'error.log',
      level: 'error'
    }),
    new winston.transports.File({
      filename: 'combined.log'
    })
  ]
});

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }));
}

// Replace console.log
logger.info('WhatsApp send request', { date: dateparam });
logger.error('Failed to send message', { error: error.message, patientId });
```

---

### 13. ❌ No Database Query Result Pagination
**Status:** 🔴 **TODO**
**File:** Multiple endpoints
**Severity:** MEDIUM

**Examples:**
```javascript
// No limit on results
router.get("/patientsPhones", async (req, res) => {
  const phonesList = await getPatientsPhones(); // Could return 10,000+ records
  res.json(phonesList);
});

router.get("/getAllTodayApps", async (req, res) => {
  const result = await getAllTodayApps(AppsDate); // No pagination
  res.json(result);
});
```

**Recommendation:**
```javascript
router.get("/patientsPhones", async (req, res) => {
  const { page = 1, limit = 100 } = req.query;
  const offset = (page - 1) * limit;

  const phonesList = await getPatientsPhones(limit, offset);
  const total = await getPatientsCount();

  res.json({
    data: phonesList,
    pagination: {
      page: parseInt(page),
      limit: parseInt(limit),
      total,
      pages: Math.ceil(total / limit)
    }
  });
});
```

---

### 14. ❌ Inconsistent Error Response Format
**Status:** 🔴 **TODO**
**File:** All routes
**Severity:** LOW

**Examples:**
```javascript
// Some endpoints use:
res.status(400).json({ error: 'Message' });

// Others use:
res.status(400).json({ success: false, message: 'Message' });

// Others use:
res.status(400).json({ status: 'error', message: 'Message' });
```

**Recommendation:**
```javascript
// Standardize on one format
const ErrorResponse = {
  send: (res, statusCode, message, details = null) => {
    res.status(statusCode).json({
      success: false,
      error: message,
      details,
      timestamp: new Date().toISOString()
    });
  }
};

// Use it
ErrorResponse.send(res, 400, 'Invalid date format', {
  expected: 'YYYY-MM-DD',
  received: req.query.date
});
```

---

### 15. ❌ No Request Timeout Configuration
**Status:** 🔴 **TODO**
**File:** All routes
**Severity:** MEDIUM

**Issue:**
- Long-running requests can hang indefinitely
- WhatsApp send operation could take hours
- No timeout on database queries

**Recommendation:**
```javascript
// Set global request timeout
app.use((req, res, next) => {
  req.setTimeout(30000); // 30 seconds default
  next();
});

// Longer timeout for specific operations
router.get('/wa/send', (req, res, next) => {
  req.setTimeout(300000); // 5 minutes for WhatsApp
  next();
}, async (req, res) => { ... });

// Database query timeout
const result = await database.executeQuery(query, params, {
  timeout: 30000 // 30 second query timeout
});
```

---

### 16. ❌ Business Logic in Route Handlers
**Status:** 🔴 **TODO**
**File:** `routes/api.js` (multiple endpoints)
**Severity:** MEDIUM

**Issue:** Route handlers contain complex business logic instead of delegating to services.

**Example from api.js:1021-1152 (130+ lines in route handler):**
```javascript
router.post("/addInvoice", async (req, res) => {
  // 130+ lines of validation and business logic
  // Should be in a service layer
});
```

**Recommendation:**
```javascript
// services/payment-service.js
export class PaymentService {
  async processInvoice({ workid, amountPaid, paymentDate, ... }) {
    // All validation and business logic here
    // ...
    return result;
  }
}

// routes/api.js
router.post("/addInvoice", async (req, res) => {
  try {
    const result = await paymentService.processInvoice(req.body);
    res.json({ status: 'success', data: result });
  } catch (error) {
    ErrorResponse.send(res, 500, error.message);
  }
});
```

---

## 🟢 WHAT'S WORKING WELL

### ✅ Good Practices Found:
1. **Uses parameterized queries** - Prevents SQL injection
2. **Comprehensive error handling** - Most endpoints handle errors
3. **WebSocket events use standardized naming** - Clean event system
4. **Calendar routes have good validation** - Well structured
5. **Uses environment variables for config** - Secure configuration
6. **Transaction support for database operations** - Data integrity
7. **Good separation in smaller route files** - admin.js, calendar.js, etc. are clean

---

## 📋 ACTION PLAN

### 🔴 IMMEDIATE (This Week):
1. ❌ **Implement authentication middleware** (CRITICAL)
2. ❌ **Fix CORS policy** (CRITICAL)
3. ❌ **Add rate limiting** (HIGH)
4. ❌ **Reduce body size limit to 10MB** (HIGH)
5. ❌ **Implement webhook signature verification** (HIGH)
6. ❌ **Fix currency parsing - use parseFloat()** (HIGH)

### 🟡 MEDIUM-TERM (Next 2 Weeks):
7. ❌ Add date validation middleware
8. ❌ Implement error logging to database
9. ❌ Add query pagination
10. ❌ Standardize error responses
11. ❌ Add request timeouts
12. ❌ Improve appointment conflict checking

### 🟢 LONG-TERM (Next Month):
13. ❌ Split api.js into modules
14. ❌ Replace console.log with Winston logger
15. ❌ Move business logic to service layer
16. ❌ Add comprehensive input validation
17. ❌ Implement comprehensive test coverage
18. ❌ Add API documentation (OpenAPI/Swagger)

---

## 📊 OVERALL ASSESSMENT

**Security:** 🔴 **Critical** - No authentication is a showstopper
**Code Quality:** 🟡 **Moderate** - Needs refactoring but functional
**Maintainability:** 🟡 **Moderate** - Large files, needs modularization
**Performance:** 🟢 **Good** - Mostly efficient, needs pagination
**Best Practices:** 🟡 **Moderate** - Mixed adherence

**Status:** The application is **functional but NOT production-ready** without addressing the critical security issues first.

---

## 📝 NOTES
- Application is for internal use only via Cloudflare tunnel (local.shwan-orthodontics.com)
- Authentication implementation should be simple, minimal, and not affect performance
- Focus on backend issues first, frontend checked only when needed

---

**Last Updated:** 2025-11-14
**Next Review:** After authentication implementation
