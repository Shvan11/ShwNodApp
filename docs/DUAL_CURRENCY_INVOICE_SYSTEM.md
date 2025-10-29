# Dual-Currency Invoice System Documentation

## Overview

The Shwan Orthodontics application now features a comprehensive dual-currency invoice system that supports both Iraqi Dinar (IQD) and US Dollar (USD) transactions. This system intelligently handles currency conversion and allows for flexible payment scenarios where patients can pay in either currency regardless of their account currency.

---

## Key Features

### ✅ **Smart Currency Conversion**
- Automatic exchange rate lookup from database
- Real-time conversion calculations
- Support for all currency combinations (USD→IQD, IQD→USD, USD→USD, IQD→IQD)

### ✅ **Dual Recording System**
- Records **actual amount received** (in payment currency)
- Separately tracks **amount registered** (in account currency)
- Maintains accurate financial records for both currencies

### ✅ **User-Friendly Interface**
- Clear 3-step workflow
- Visual payment suggestions
- Automatic balance calculation
- Real-time currency conversion display

### ✅ **Exchange Rate Management**
- Daily exchange rate storage in `tblsms` table
- Easy rate updates through UI
- Historical rate tracking

---

## Database Schema

### Tables Involved

#### 1. **tblsms** - Exchange Rate Storage
```sql
CREATE TABLE tblsms (
    id INT PRIMARY KEY,
    date DATE NOT NULL,
    ExchangeRate INT NULL,  -- USD to IQD rate
    smssent BIT DEFAULT 0,
    emailsent BIT DEFAULT 0
)
```
- **Purpose**: Stores daily exchange rates
- **Example**: `ExchangeRate = 1406` means 1 USD = 1406 IQD

#### 2. **tblwork** - Patient Account
```sql
CREATE TABLE tblwork (
    workid INT PRIMARY KEY,
    PersonID INT NOT NULL,
    TotalRequired INT NOT NULL,      -- Total cost in account currency
    Currency NVARCHAR(255) NULL,     -- Account currency (USD/IQD)
    ...
)
```
- **Purpose**: Patient treatment account and currency
- **Currency Field**: Defines the patient's account currency

#### 3. **tblInvoice** - Payment Records
```sql
CREATE TABLE tblInvoice (
    invoiceID INT PRIMARY KEY,
    workid INT NOT NULL,
    Amountpaid INT NOT NULL,           -- Amount registered (account currency)
    ActualAmount INT NULL,             -- Actual cash received
    ActualCur NVARCHAR(255) NULL,      -- Currency actually received (USD/IQD)
    Change INT NULL,                   -- Change given (in payment currency)
    Dateofpayment DATE NOT NULL,
    ...
)
```
- **Amountpaid**: What gets registered to patient file (in account currency)
- **ActualAmount**: Physical cash received (in payment currency)
- **ActualCur**: Currency of the physical cash

---

## Usage Scenarios

### Scenario 1: USD Account, Installment in IQD
**Patient Account**: 1,900 USD
**Remaining Balance**: 1,600 USD
**Exchange Rate**: 1 USD = 1,406 IQD
**Patient Pays**: 140,600 IQD installment

**Steps**:
1. Open payment form
2. Select "Payment Currency" → IQD
3. Enter "Amount Received" → 140,600 IQD
4. System shows: **"Will register: 100 USD to patient account"** (140,600 ÷ 1,406)
5. Click "Save Payment"
6. System records:
   - `Amountpaid`: 100 USD (registered to account)
   - `ActualAmount`: 140,600 IQD (cash received)
   - `ActualCur`: IQD
   - New Balance: 1,500 USD remaining

---

### Scenario 2: IQD Account, Installment in USD
**Patient Account**: 140,600 IQD
**Remaining Balance**: 140,600 IQD
**Exchange Rate**: 1 USD = 1,406 IQD
**Patient Pays**: 50 USD installment

**Steps**:
1. Open payment form
2. Select "Payment Currency" → USD
3. Enter "Amount Received" → 50 USD
4. System shows: **"Will register: 70,300 IQD to patient account"** (50 × 1,406)
5. Click "Save Payment"
6. System records:
   - `Amountpaid`: 70,300 IQD (registered to account)
   - `ActualAmount`: 50 USD (cash received)
   - `ActualCur`: USD
   - New Balance: 70,300 IQD remaining

---

### Scenario 3: Same Currency Installment (No Conversion)
**Patient Account**: 1,600 USD
**Remaining Balance**: 1,600 USD
**Patient Pays**: 200 USD installment

**Steps**:
1. Open payment form
2. Select "Payment Currency" → USD (same as account)
3. Enter "Amount Received" → 200 USD
4. No conversion needed - amount is same in both currencies
5. Click "Save Payment"
6. System records:
   - `Amountpaid`: 200 USD
   - `ActualAmount`: 200 USD
   - `ActualCur`: USD
   - New Balance: 1,400 USD remaining

---

### Scenario 4: Full Balance Payment (Final Payment)
**Patient Account**: 1,900 USD
**Remaining Balance**: 200 USD (last payment)
**Exchange Rate**: 1 USD = 1,406 IQD

**Steps**:
1. Open payment form
2. Select "Payment Currency" → USD
3. Enter "Amount Received" → 200 USD
4. **Check** "This pays off full balance" checkbox
5. Click "Save Payment"
6. System records:
   - `Amountpaid`: 200 USD
   - `ActualAmount`: 200 USD
   - `ActualCur`: USD
   - New Balance: 0 USD (Paid in Full!)

---

## User Interface Guide

### Simplified Invoice Form - 2-Step Process (for Installment Payments)

#### **Exchange Rate Check**
- System automatically checks if exchange rate is set for today
- **If NOT set**: Red warning box appears with inline rate setting
  - Click "Set Exchange Rate" button
  - Enter rate (e.g., 1406 for 1 USD = 1,406 IQD)
  - Click "Save" - rate is stored for today
- **If set**: Green info box shows current rate

#### **STEP 1: Payment Currency**
- **Purpose**: Select which currency patient is paying with today
- **Options**: USD or IQD dropdown
- **Default**: Same as patient's account currency

#### **STEP 2: Payment Details**
- **Amount Received**: Enter installment amount in selected currency
  - Large input field for easy entry
  - Placeholder shows currency (e.g., "Enter installment amount in IQD")
- **Automatic Conversion**:
  - If payment currency differs from account currency
  - Blue info box shows: "Will register: [converted amount] to patient account"
- **Full Balance Checkbox**:
  - Optional: Check if this payment pays off the full remaining balance
- **Change Given**: Enter any change given back to patient
- **Payment Date**: Select payment date (defaults to today)

---

## Exchange Rate Management

### Setting Today's Exchange Rate

1. Click **"Update Exchange Rate"** button
2. Enter rate in format: `1 USD = ? IQD`
   - Example: `1406` (meaning 1 USD = 1,406 IQD)
3. Click **"Update Rate"**
4. Rate is stored for today's date in `tblsms` table

### Rate Retrieval Logic
```javascript
// Automatic rate lookup
GET /api/getCurrentExchangeRate
// Returns: { status: 'success', exchangeRate: 1406 }

// If no rate exists for today, returns warning
// User must set rate before adding invoices
```

### Historical Rates
Exchange rates are stored daily and can be queried:
```sql
SELECT date, ExchangeRate
FROM tblsms
WHERE ExchangeRate IS NOT NULL
ORDER BY date DESC
```

---

## API Endpoints

### 1. Get Active Work for Invoice
```http
GET /api/getActiveWorkForInvoice?PID={patientId}
```
**Response**:
```json
{
  "status": "success",
  "data": [{
    "workid": 10819,
    "PersonID": 1234,
    "TotalRequired": 1900,
    "Currency": "USD",
    "TotalPaid": 300,
    "PatientName": "John Doe",
    "Phone": "1234567890"
  }]
}
```

### 2. Get Current Exchange Rate
```http
GET /api/getCurrentExchangeRate
```
**Response**:
```json
{
  "status": "success",
  "exchangeRate": 1406
}
```

### 3. Add Invoice
```http
POST /api/addInvoice
Content-Type: application/json

{
  "workid": 10819,
  "amountPaid": 100,              // In account currency
  "paymentDate": "2025-10-27",
  "actualAmount": 140600,          // In payment currency
  "actualCurrency": "IQD",
  "change": 0
}
```

### 4. Update Exchange Rate
```http
POST /api/updateExchangeRate
Content-Type: application/json

{
  "exchangeRate": 1406
}
```

---

## Frontend Components

### InvoiceComponent.jsx
**Location**: `/public/js/components/react/InvoiceComponent.jsx`

**Features**:
- 3-step invoice form
- Real-time currency conversion
- Exchange rate management
- Modal-based UI

**Key Functions**:
```javascript
calculateSuggestedPayment()   // Convert required → payment currency
calculateAmountToRegister()    // Convert actual → account currency
handleUseBalanceToggle()       // Quick-fill with balance
```

### PaymentsComponent.jsx
**Location**: `/public/js/components/react/PaymentsComponent.jsx`

**Integration**:
```jsx
import InvoiceComponent from './InvoiceComponent.jsx'

<InvoiceComponent patientId={patientId} />
```

---

## Styling

### CSS File
**Location**: `/public/css/components/invoice-form.css`

**Key Classes**:
- `.invoice-modal` - Main modal container
- `.form-section` - Step containers
- `.suggested-payment-box` - Prominent suggestion display
- `.conversion-info` - Conversion feedback
- `.account-summary` - Patient account overview

**Design Features**:
- Gradient backgrounds for visual hierarchy
- Step numbers with circular badges
- Large, readable fonts for important amounts
- Color-coded information (blue for info, yellow for suggestions)
- Responsive design for mobile devices

---

## Calculation Logic

### USD to IQD Conversion
```javascript
if (accountCurrency === 'USD' && paymentCurrency === 'IQD') {
    suggestedPayment = requiredPayment * exchangeRate
    // Example: 100 USD × 1,406 = 140,600 IQD
}
```

### IQD to USD Conversion
```javascript
if (accountCurrency === 'IQD' && paymentCurrency === 'USD') {
    suggestedPayment = requiredPayment / exchangeRate
    // Example: 140,600 IQD ÷ 1,406 = 100 USD
}
```

### Rounding
All amounts are rounded to nearest integer:
```javascript
Math.round(convertedAmount)
```

---

## Best Practices

### 1. **Always Set Exchange Rate**
- Update exchange rate daily or as needed
- System will warn if rate is not set for today

### 2. **Verify Conversions**
- Check the suggested payment amount
- Confirm conversion calculations before submitting

### 3. **Record Actual Amounts**
- Enter the exact cash received
- Record any change given

### 4. **Use Remaining Balance**
- Default option for full payments
- Reduces data entry errors

### 5. **Handle Partial Payments**
- Uncheck "Use Balance" checkbox
- Enter custom amount
- System still tracks accurately

---

## Troubleshooting

### Issue: "No exchange rate set for today"
**Solution**: Click "Update Exchange Rate" and set today's rate

### Issue: Conversion seems incorrect
**Check**:
1. Exchange rate is correct for today
2. Account currency matches patient's account
3. Payment currency matches selected option

### Issue: Invoice not saving
**Check**:
1. All required fields are filled
2. Amounts are positive numbers
3. Network connection is stable

---

## Technical Notes

### Currency Precision
- All amounts stored as `INT` (no decimals)
- Suitable for IQD (no fractional units)
- USD stored as whole dollars (no cents)

### Database Transactions
All invoice insertions are atomic:
```sql
INSERT INTO dbo.tblInvoice (...)
VALUES (...);
SELECT SCOPE_IDENTITY() as invoiceID;
```

### State Management
React component uses multiple `useState` hooks:
- `formData` - User inputs
- `calculations` - Computed values
- `workData` - Patient account info
- `exchangeRate` - Current rate

### Effect Hooks
- Auto-load data when modal opens
- Calculate suggestions when amounts change
- Calculate registration when actuals change

---

## Future Enhancements

### Potential Improvements
1. **Multi-currency support**: Add more currencies (EUR, GBP, etc.)
2. **Exchange rate history**: Chart showing rate trends
3. **Receipt generation**: Print/PDF invoice receipts
4. **Payment analytics**: Currency usage statistics
5. **Bulk exchange rate import**: Import rates from external API

---

## Support

For questions or issues with the dual-currency system:
1. Check this documentation first
2. Verify exchange rate is set correctly
3. Review the calculation examples
4. Test with small amounts first

---

## Changelog

### Version 1.0 (October 2025)
- ✅ Initial implementation
- ✅ Support for USD/IQD
- ✅ Automatic conversion
- ✅ 3-step UI workflow
- ✅ Exchange rate management
- ✅ Comprehensive documentation

---

**Last Updated**: October 28, 2025
**Maintained by**: Shwan Orthodontics Development Team
