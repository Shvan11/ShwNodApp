# Time-Based Role Privileges Implementation Plan

## Overview

Implement a two-tier role system (Admin, Secretary) with **date-based restrictions** where Secretary role cannot delete or edit records **not created today**.

**KEEP IT SIMPLE:**
- ✅ Today = Can edit/delete
- ❌ Not today = Cannot edit/delete (admin only)
- No complex calculations, no logging, no notifications

## Role Definitions

### Admin Role
- **Unrestricted access** to all operations
- Can delete/edit ANY record regardless of age
- Full system access

### Secretary Role
- **Full access** to create new records
- **Full access** to edit/delete records **created today**
- **Restricted access** for records **not created today** (old):
  - ❌ Cannot delete patients
  - ❌ Cannot delete old work/treatments
  - ❌ Cannot edit money-related fields (Total Required, Paid, Discount) in old works
  - ❌ Cannot delete old invoices (solution: delete + create new invoice)
  - ❌ Cannot delete old expenses
  - ❌ Cannot edit old expenses
  - ✅ CAN delete work details anytime (not money-critical)
  - ✅ CAN delete visits anytime (not money-critical)

## Current System Analysis

### Operations Requiring Protection

Based on codebase analysis, here are ALL operations that need time-based restrictions:

#### 1. PATIENT OPERATIONS
| Operation | Route | File:Line | Restrict for Secretary? |
|-----------|-------|-----------|------------------------|
| Delete Patient | `DELETE /patients/:personId` | `routes/api.js:2671` | ✅ YES (if patient created >24h ago) |
| Update Patient | `PUT /patients/:personId` | `routes/api.js:2648` | ❌ NO (allowed) |

#### 2. WORK/TREATMENT OPERATIONS
| Operation | Route | File:Line | Restrict for Secretary? |
|-----------|-------|-----------|------------------------|
| Delete Work | `DELETE /deletework` | `routes/api.js:3281` | ✅ YES (if work created >24h ago) |
| Update Work | `PUT /updatework` | `routes/api.js:3210` | ⚠️ PARTIAL (block money fields if not today) |
| Finish Work | `POST /finishwork` | `routes/api.js:3256` | ❌ NO (allowed) |
| Delete Work Detail | `DELETE /deleteworkdetail` | `routes/api.js:3456` | ❌ NO (allowed - not money-critical) |
| Update Work Detail | `PUT /updateworkdetail` | `routes/api.js:3421` | ❌ NO (allowed) |

#### 3. VISIT OPERATIONS
| Operation | Route | File:Line | Restrict for Secretary? |
|-----------|-------|-----------|------------------------|
| Delete Visit | `DELETE /deletevisitbywork` | `routes/api.js:745` | ❌ NO (allowed - not money-critical) |
| Update Visit | `PUT /updatevisitbywork` | `routes/api.js:730` | ❌ NO (allowed) |

#### 4. INVOICE/PAYMENT OPERATIONS
| Operation | Route | File:Line | Restrict for Secretary? |
|-----------|-------|-----------|------------------------|
| Delete Invoice | `DELETE /deleteInvoice/:invoiceId` | `routes/api.js:1154` | ✅ YES (if invoice created >24h ago) |
| Update Invoice | Need to find | TBD | ✅ YES (if invoice created >24h ago) |

#### 5. EXPENSE OPERATIONS
| Operation | Route | File:Line | Restrict for Secretary? |
|-----------|-------|-----------|------------------------|
| Delete Expense | `DELETE /expenses/:id` | `routes/api.js:6461` | ✅ YES (if not created today) |
| Update Expense | `PUT /expenses/:id` | `routes/api.js:6410` | ✅ YES (if not created today) |

## Technical Implementation Plan

### Phase 1: Database Schema Changes

#### 1.1 Update tblUsers Table
```sql
-- Update existing users to new role system
UPDATE dbo.tblUsers
SET Role = CASE
  WHEN Role = 'admin' THEN 'admin'
  WHEN Role IN ('doctor', 'receptionist', 'user') THEN 'secretary'
  ELSE 'secretary'
END;

-- Simplify to only two roles: admin, secretary
```

**Files to modify:**
- `scripts/setup-auth.js` - Update default role to 'secretary'
- `routes/user-management.js` - Update role validation to only allow 'admin', 'secretary'
- Frontend user management component - Update role dropdown

---

### Phase 2: Middleware Enhancement

#### 2.1 Create Time-Based Authorization Middleware

**New file:** `middleware/time-based-auth.js`

```javascript
/**
 * SIMPLE Date-based authorization middleware
 * Rule: Secretary can only edit/delete records created TODAY
 */

// Check if date is today (simple!)
function isToday(date) {
  const today = new Date();
  const recordDate = new Date(date);

  return today.getFullYear() === recordDate.getFullYear() &&
         today.getMonth() === recordDate.getMonth() &&
         today.getDate() === recordDate.getDate();
}

// Middleware factory - returns configured middleware
export function requireRecordAge(options) {
  const {
    resourceType,    // 'patient' | 'work' | 'invoice' | 'visit' | 'expense'
    operation,       // 'delete' | 'update'
    getRecordDate,   // async function(req) => Date
    restrictedFields // array of field names (for partial updates)
  } = options;

  return async (req, res, next) => {
    // Admin bypasses all restrictions
    if (req.session.user.role === 'admin') {
      return next();
    }

    // Secretary: check if record was created today
    try {
      const recordDate = await getRecordDate(req);

      if (!isToday(recordDate)) {
        // Record is old (not created today)
        if (operation === 'delete') {
          return res.status(403).json({
            error: 'Forbidden',
            message: `Cannot delete ${resourceType} not created today. Contact admin.`
          });
        }

        if (operation === 'update' && restrictedFields) {
          // Check if trying to update restricted fields
          const updatingRestrictedField = restrictedFields.some(
            field => req.body.hasOwnProperty(field)
          );

          if (updatingRestrictedField) {
            return res.status(403).json({
              error: 'Forbidden',
              message: `Cannot edit money-related fields for ${resourceType} not created today. Contact admin.`
            });
          }
        }
      }

      // Record created today - allow operation
      next();
    } catch (error) {
      console.error('Date-based auth error:', error);
      res.status(500).json({ error: 'Authorization check failed' });
    }
  };
}
```

**Helper functions in same file:**

```javascript
// Get patient creation date
export async function getPatientCreationDate(req) {
  const { personId } = req.params;
  const result = await executeQuery(
    'SELECT CreatedAt FROM dbo.tblpatients WHERE PersonID = @personId',
    [['personId', TYPES.Int, personId]],
    (columns) => ({ createdAt: columns[0].value })
  );
  return result[0]?.createdAt || new Date();
}

// Get work creation date
export async function getWorkCreationDate(req) {
  const { workid } = req.body; // or req.params depending on route
  const result = await executeQuery(
    'SELECT CreatedAt FROM dbo.tblwork WHERE WorkID = @workId',
    [['workId', TYPES.Int, workid]],
    (columns) => ({ createdAt: columns[0].value })
  );
  return result[0]?.createdAt || new Date();
}

// Get invoice creation date
export async function getInvoiceCreationDate(req) {
  const { invoiceId } = req.params;
  const result = await executeQuery(
    'SELECT CreatedAt FROM dbo.tblInvoice WHERE InvoiceID = @invoiceId',
    [['invoiceId', TYPES.Int, invoiceId]],
    (columns) => ({ createdAt: columns[0].value })
  );
  return result[0]?.createdAt || new Date();
}

// Get visit creation date
export async function getVisitCreationDate(req) {
  const { workid } = req.body;
  const result = await executeQuery(
    'SELECT v.CreatedAt FROM dbo.tblvisits v WHERE v.WorkID = @workId',
    [['workId', TYPES.Int, workid]],
    (columns) => ({ createdAt: columns[0].value })
  );
  return result[0]?.createdAt || new Date();
}

// Get expense creation date
export async function getExpenseCreationDate(req) {
  const { id } = req.params;
  const result = await executeQuery(
    'SELECT CreatedAt FROM dbo.tblExpenses WHERE ExpenseID = @expenseId',
    [['expenseId', TYPES.Int, id]],
    (columns) => ({ createdAt: columns[0].value })
  );
  return result[0]?.createdAt || new Date();
}
```

---

### Phase 3: Apply Middleware to Routes

**File:** `routes/api.js`

#### 3.1 Import Middleware
```javascript
import {
  requireRecordAge,
  getPatientCreationDate,
  getWorkCreationDate,
  getInvoiceCreationDate,
  getVisitCreationDate,
  getExpenseCreationDate
} from '../middleware/time-based-auth.js';
```

#### 3.2 Protect Patient Routes
```javascript
// DELETE /patients/:personId
router.delete('/patients/:personId',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'patient',
    operation: 'delete',
    getRecordDate: getPatientCreationDate
  }),
  async (req, res) => { /* existing code */ }
);
```

#### 3.3 Protect Work Routes
```javascript
// DELETE /deletework
router.delete('/deletework',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'work',
    operation: 'delete',
    getRecordDate: getWorkCreationDate
  }),
  async (req, res) => { /* existing code */ }
);

// PUT /updatework - Block editing money fields for old works
router.put('/updatework',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'work',
    operation: 'update',
    getRecordDate: getWorkCreationDate,
    restrictedFields: ['totalrequired', 'paid', 'discount'] // Money-related fields
  }),
  async (req, res) => { /* existing code */ }
);

// DELETE /deleteworkdetail - No restriction (not money-critical)
// Secretary can delete work details anytime
router.delete('/deleteworkdetail',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req, res) => { /* existing code */ }
);
```

#### 3.4 Protect Invoice Routes
```javascript
// DELETE /deleteInvoice/:invoiceId
router.delete('/deleteInvoice/:invoiceId',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'invoice',
    operation: 'delete',
    getRecordDate: getInvoiceCreationDate
  }),
  async (req, res) => { /* existing code */ }
);

// NOTE: No invoice update route - if secretary needs to fix old invoice,
// they should delete it and create a new one (admin only for old invoices)
```

#### 3.5 Visit Routes - No Restriction Needed
```javascript
// DELETE /deletevisitbywork - No restriction (not money-critical)
// Secretary can delete visits anytime
router.delete('/deletevisitbywork',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req, res) => { /* existing code */ }
);
```

#### 3.6 Protect Expense Routes
```javascript
// DELETE /expenses/:id
router.delete('/expenses/:id',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'expense',
    operation: 'delete',
    getRecordDate: getExpenseCreationDate
  }),
  async (req, res) => { /* existing code */ }
);

// PUT /expenses/:id - Secretary cannot edit old expenses
router.put('/expenses/:id',
  authenticate,
  authorize(['admin', 'secretary']),
  requireRecordAge({
    resourceType: 'expense',
    operation: 'update',
    getRecordDate: getExpenseCreationDate
  }),
  async (req, res) => { /* existing code */ }
);
```

---

### Phase 4: Frontend Updates

#### 4.1 Update User Management Component

**File:** `public/js/components/react/UserManagement.jsx` or `AdminUserManagement.jsx`

```javascript
// Update role options
const roleOptions = [
  { value: 'admin', label: 'Admin - Full Access' },
  { value: 'secretary', label: 'Secretary - Time-restricted' }
];
```

#### 4.2 Add Permission Checks in Components

**Pattern for all delete/edit buttons:**

```javascript
// Simple check: is record created today?
const isToday = (date) => {
  const today = new Date();
  const recordDate = new Date(date);
  return today.toDateString() === recordDate.toDateString();
};

const canDelete = useMemo(() => {
  if (currentUser.role === 'admin') return true;
  if (currentUser.role === 'secretary') {
    return isToday(record.createdAt);
  }
  return false;
}, [currentUser.role, record.createdAt]);

// Disable delete button
<button
  disabled={!canDelete}
  onClick={handleDelete}
  title={!canDelete ? 'Cannot delete records not created today' : 'Delete'}
>
  Delete
</button>
```

**Files requiring frontend updates:**
1. `public/js/components/react/PatientManagement.jsx:378` - Patient delete
2. `public/js/components/react/WorkComponent.jsx:128` - Work delete
3. `public/js/components/react/WorkComponent.jsx:923` - Invoice delete
4. `public/js/components/react/NewWorkComponent.jsx:156` - Work edit (money fields: Total Required, Paid, Discount)
5. `public/js/hooks/useExpenses.js` - Expense delete/edit
6. ~~Visit delete~~ - No restriction needed (not money-critical)
7. ~~Work detail delete~~ - No restriction needed (not money-critical)

#### 4.3 Error Handling for 403 Responses

Add consistent error handling when secretary tries forbidden operation:

```javascript
try {
  await axios.delete(`/api/patients/${patientId}`);
  // Success
} catch (error) {
  if (error.response?.status === 403) {
    // Show user-friendly message
    alert(error.response.data.message ||
      'You do not have permission to perform this action on old records.');
  } else {
    alert('Error deleting patient');
  }
}
```

---

### Phase 5: Database Schema Verification

#### 5.1 Ensure CreatedAt Columns Exist

Verify all tables have `CreatedAt` timestamp column:

```sql
-- Check existing columns
SELECT
  t.name AS TableName,
  c.name AS ColumnName,
  ty.name AS DataType
FROM sys.tables t
JOIN sys.columns c ON t.object_id = c.object_id
JOIN sys.types ty ON c.user_type_id = ty.user_type_id
WHERE t.name IN ('tblpatients', 'tblwork', 'tblInvoice', 'tblvisits', 'tblExpenses')
  AND c.name LIKE '%Created%'
ORDER BY t.name;
```

#### 5.2 Add Missing CreatedAt Columns (if needed)

```sql
-- Add CreatedAt to tables if missing
IF NOT EXISTS (
  SELECT * FROM sys.columns
  WHERE object_id = OBJECT_ID('dbo.tblpatients')
  AND name = 'CreatedAt'
)
BEGIN
  ALTER TABLE dbo.tblpatients
  ADD CreatedAt DATETIME DEFAULT GETDATE() NOT NULL;
END

-- Repeat for tblwork, tblInvoice, tblvisits, tblExpenses
```

**Note:** Verify exact column names in database (might be `CreatedDate`, `DateCreated`, etc.)

---

## Implementation Checklist

### Phase 1: Database & User Roles
- [ ] Verify CreatedAt columns exist in all required tables
- [ ] Add CreatedAt columns if missing
- [ ] Update existing user roles to 'admin' or 'secretary'
- [ ] Update setup-auth.js to use new role system
- [ ] Update user-management.js role validation

### Phase 2: Backend Middleware
- [ ] Create `middleware/time-based-auth.js`
- [ ] Implement `requireRecordAge()` middleware factory
- [ ] Implement helper functions for getting record dates
- [ ] Write unit tests for middleware logic

### Phase 3: Route Protection
- [ ] Protect patient delete route
- [ ] Protect work delete route
- [ ] Protect work update route (money fields: totalrequired, paid, discount)
- [ ] ~~Protect work detail delete route~~ - NOT NEEDED (not money-critical)
- [ ] Protect invoice delete route
- [ ] Protect invoice update route (verify route exists)
- [ ] ~~Protect visit delete route~~ - NOT NEEDED (not money-critical)
- [ ] Protect expense delete route
- [ ] Protect expense update route (if required)

### Phase 4: Frontend Updates
- [ ] Update user management role dropdown
- [ ] Add permission checks to PatientManagement delete button
- [ ] Add permission checks to WorkComponent delete button
- [ ] Add permission checks to WorkComponent invoice delete
- [ ] ~~Add permission checks to VisitsComponent delete button~~ - NOT NEEDED
- [ ] Add permission checks to NewWorkComponent money fields edit (Total Required, Paid, Discount)
- [ ] Add permission checks to Expenses delete/edit
- [ ] Implement 403 error handling in all API calls
- [ ] Add visual indicators (disabled buttons, tooltips)

### Phase 5: Testing
- [ ] Test admin can delete/edit old records
- [ ] Test secretary can delete/edit recent records (<24h)
- [ ] Test secretary CANNOT delete/edit old records (≥24h)
- [ ] Test error messages are clear and helpful
- [ ] Test frontend buttons are properly disabled
- [ ] Verify no console errors
- [ ] Test with different timezones (server vs client)

### Phase 6: Documentation
- [ ] Update user manual with role descriptions
- [ ] Document time-based restrictions for secretary
- [ ] Add troubleshooting guide
- [ ] Update API documentation

---

## Security Considerations

1. **Server-side enforcement only** - Never trust frontend checks alone
2. **Date verification** - Use server database timestamps, not client-provided dates
3. **Role validation** - Always verify user role on every protected route
4. **Session security** - Ensure session cannot be tampered with
5. **Simple = Fast** - Date comparison is extremely fast, no performance impact

---

## Clarifications (ANSWERED)

1. ✅ **Work editing** - Block ONLY money-related fields (totalrequired, paid, discount) for old works
2. ✅ **Invoice updates** - No update route needed. Secretary deletes old invoice + creates new (admin only for old)
3. ✅ **Date calculation** - Simple: If CreatedAt date = Today's date → OK, else → BLOCKED
4. ✅ **Notifications** - NONE (keep it simple)
5. ✅ **Logging** - NONE (keep it simple)
6. ✅ **Performance** - Minimal impact (simple date comparison only)

---

## Estimated Timeline

- **Phase 1** (Database): 2-4 hours
- **Phase 2** (Middleware): 4-6 hours
- **Phase 3** (Routes): 4-6 hours
- **Phase 4** (Frontend): 6-8 hours
- **Phase 5** (Testing): 4-6 hours
- **Phase 6** (Documentation): 2-3 hours

**Total:** ~22-33 hours of development + testing time

---

**Last Updated:** 2025-11-14
