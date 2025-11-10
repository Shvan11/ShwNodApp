# Invoice Payment Validation - Implementation Guide

**Date:** 2025-01-11
**Feature:** Smart invoice validation with same-currency detection

---

## Overview

This enhancement adds comprehensive validation to prevent invalid invoice payments:

1. **Database constraints** - Enforces basic rules at the lowest level
2. **Backend API validation** - Context-aware business logic validation
3. **Frontend UI** - Smart UX that hides/shows fields based on payment type

---

## Key Business Rules

### Same-Currency Payments
- **Rule:** When patient pays in same currency as account (USD→USD or IQD→IQD)
- **Behavior:** Change field = NULL (not tracked)
- **Reason:** Cash change given is standard cash handling, not relevant to accounting

### Cross-Currency Payments
- **Rule:** When patient pays in different currency (USD→IQD or IQD→USD)
- **Behavior:** Change field enabled and validated
- **Reason:** Tracks currency conversion effects for reconciliation

### Invalid Scenarios Blocked
- ❌ No cash received (both USD and IQD = 0)
- ❌ Negative amounts
- ❌ Change exceeds received amount
- ❌ Zero or negative payment amounts

---

## Implementation Steps

### Step 1: Audit Old Records (REQUIRED FIRST!)

Before applying constraints, check for existing invalid data:

```sql
-- Run this first to identify problems
sqlcmd -S your-server -d your-database -i audit-and-fix-old-invoices.sql
```

**OR using MCP:**
```javascript
// Execute via MCP MSSQL tool
mcp__mssql__exec_sql_json("SELECT * FROM dbo.tblInvoice WHERE USDReceived = 0 AND IQDReceived = 0")
```

This will show:
- Records with no cash received
- Records with negative amounts
- Records with invalid change values

**Choose a fix strategy:**
- **Option A:** Delete invalid records (if data errors)
- **Option B:** Auto-fix by inferring IQD = AmountPaid (for old records)
- **Option C:** Manual review and correction

Edit `audit-and-fix-old-invoices.sql` and uncomment your chosen fix option.

---

### Step 2: Apply Database Constraints

After fixing old records, apply the constraints:

```sql
-- Update the database name at top of file, then run:
sqlcmd -S your-server -d your-database -i add-invoice-validation-constraints.sql
```

**OR manually execute via SSMS or MCP:**

```sql
-- 1. Must receive cash
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_MustReceiveCash
CHECK (USDReceived > 0 OR IQDReceived > 0);

-- 2. Non-negative amounts
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_USDNonNegative CHECK (USDReceived >= 0);

ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_IQDNonNegative CHECK (IQDReceived >= 0);

ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_ChangeNonNegative CHECK (Change >= 0 OR Change IS NULL);

-- 3. Amount paid must be positive
ALTER TABLE dbo.tblInvoice
ADD CONSTRAINT CHK_Invoice_AmountPaidPositive CHECK (Amountpaid > 0);
```

**Verify constraints:**
```sql
SELECT name, definition
FROM sys.check_constraints
WHERE parent_object_id = OBJECT_ID('dbo.tblInvoice')
  AND name LIKE 'CHK_Invoice_%';
```

---

### Step 3: Deploy Backend Code

Backend changes are already in place in `routes/api.js` (lines 1022-1153).

**No deployment action needed** - code changes are ready.

**What changed:**
- Added account currency detection
- Same-currency payments force Change = NULL
- Cross-currency payments validate change against exchange rates
- Better error messages with error codes

---

### Step 4: Deploy Frontend Code

Frontend changes are already in place in `PaymentModal.jsx`.

**No deployment action needed** - code changes are ready.

**What changed:**
- Change field automatically hides for same-currency payments
- Shows helpful explanation instead
- Cross-currency payments show validation hints
- Better UX for preventing errors

---

### Step 5: Restart Application

After database constraints are applied:

```bash
# If running as service
npm run service:restart

# OR if running manually
# Stop the application (Ctrl+C)
node index.js
```

---

## Testing Checklist

### Test Case 1: Same-Currency USD Payment
- Account: USD, Balance: $100
- Payment: $50 USD, 0 IQD
- **Expected:** Change field hidden, shows "Not Applicable"
- **Database:** Change = NULL

### Test Case 2: Same-Currency IQD Payment
- Account: IQD, Balance: 100,000 IQD
- Payment: 0 USD, 50,000 IQD
- **Expected:** Change field hidden, shows "Not Applicable"
- **Database:** Change = NULL

### Test Case 3: Cross-Currency USD→IQD
- Account: IQD, Balance: 71,000 IQD
- Payment: $60 USD, 0 IQD (at rate 1,420 = 85,200 IQD)
- Register: 71,000 IQD
- **Expected:** Change field enabled, auto-calculated ~14,000 IQD
- **Database:** Change = 14000

### Test Case 4: Cross-Currency IQD→USD
- Account: USD, Balance: $100
- Payment: 0 USD, 150,000 IQD (at rate 1,420 = ~$105)
- Register: $100
- **Expected:** Change field enabled, auto-calculated ~7,100 IQD
- **Database:** Change = 7100

### Test Case 5: Invalid - No Cash
- Payment: 0 USD, 0 IQD
- **Expected:** Error: "At least one currency amount must be greater than zero"
- **Database:** Insert blocked

### Test Case 6: Invalid - Excessive Change
- Account: IQD, Payment: 0 USD, 50,000 IQD
- Register: 50,000 IQD, Change: 100,000 IQD
- **Expected:** Error: "Change cannot exceed IQD received"
- **Database:** Insert blocked

---

## Rollback Plan

If issues occur, rollback in reverse order:

### 1. Remove Database Constraints
```sql
ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_MustReceiveCash;
ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_USDNonNegative;
ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_IQDNonNegative;
ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_ChangeNonNegative;
ALTER TABLE dbo.tblInvoice DROP CONSTRAINT CHK_Invoice_AmountPaidPositive;
```

### 2. Revert Backend Code
```bash
git checkout HEAD~1 routes/api.js
```

### 3. Revert Frontend Code
```bash
git checkout HEAD~1 public/js/components/react/PaymentModal.jsx
```

### 4. Restart Application
```bash
npm run service:restart
# OR
node index.js
```

---

## Troubleshooting

### Constraint Violation on Insert
**Error:** "The INSERT statement conflicted with the CHECK constraint 'CHK_Invoice_MustReceiveCash'"

**Cause:** Trying to insert invoice with USDReceived=0 AND IQDReceived=0

**Fix:** Update frontend/backend to ensure at least one currency > 0

---

### Old Records Causing Constraint Failure
**Error:** "ALTER TABLE statement conflicted with the CHECK constraint"

**Cause:** Existing data violates new constraint

**Fix:** Run `audit-and-fix-old-invoices.sql` and fix problematic records first

---

### Change Field Not Hiding
**Cause:** Frontend not detecting same-currency correctly

**Check:**
1. Verify `calculations.accountCurrency` is set correctly
2. Verify `formData.paymentCurrency` matches selection
3. Check browser console for errors

---

## Database Schema Reference

### tblInvoice Structure (Relevant Fields)
```
InvoiceID       INT           PRIMARY KEY
workid          INT           NOT NULL (FK to tblWork)
Amountpaid      INT           NOT NULL (Amount registered to account)
Dateofpayment   DATE          NOT NULL
USDReceived     INT           NOT NULL DEFAULT 0
IQDReceived     INT           NOT NULL DEFAULT 0
Change          INT           NULL (NULL = no tracking, >=0 = tracked)
```

### New Constraints
```
CHK_Invoice_MustReceiveCash      - USDReceived > 0 OR IQDReceived > 0
CHK_Invoice_USDNonNegative       - USDReceived >= 0
CHK_Invoice_IQDNonNegative       - IQDReceived >= 0
CHK_Invoice_ChangeNonNegative    - Change >= 0 OR Change IS NULL
CHK_Invoice_AmountPaidPositive   - Amountpaid > 0
```

---

## Support

For issues or questions:
1. Check troubleshooting section above
2. Review audit script output: `audit-and-fix-old-invoices.sql`
3. Check application logs for detailed error messages
4. Review code comments in `routes/api.js` lines 1022-1153

---

## Files Modified

- ✅ `migrations/add-invoice-validation-constraints.sql` - Database constraints
- ✅ `migrations/audit-and-fix-old-invoices.sql` - Old record fixes
- ✅ `routes/api.js` - Backend validation (lines 1022-1153)
- ✅ `public/js/components/react/PaymentModal.jsx` - Frontend UI (lines 333-383, 839-914)
