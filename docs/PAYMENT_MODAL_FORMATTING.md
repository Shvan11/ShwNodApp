# Payment Modal - Number Formatting

## Overview
The Payment Modal uses formatted numbers with thousand separators for better readability, especially important for IQD (Iraqi Dinar) which uses large numbers.

## Formatting Functions

### `formatCurrency(amount, currency)`
Formats a number with thousand separators and currency label.

**Examples:**
```javascript
formatCurrency(100000, 'IQD')   // → "100,000 IQD"
formatCurrency(1420000, 'IQD')  // → "1,420,000 IQD"
formatCurrency(50, 'USD')       // → "50 USD"
formatCurrency(1500, 'USD')     // → "1,500 USD"
```

### `formatNumber(num)`
Formats a plain number with thousand separators (no currency).

**Examples:**
```javascript
formatNumber(1420)      // → "1,420"
formatNumber(100000)    // → "100,000"
formatNumber(50)        // → "50"
```

## Where Formatting is Applied

### 1. Exchange Rate Display
```
Exchange Rate: 1 USD = 1,420 IQD  ✓ Formatted
```

### 2. Amount Fields
```
Amount to Register: 200,000 IQD   ✓ Formatted
Balance: 500,000 IQD              ✓ Formatted
```

### 3. Suggestions
```
Suggested: Collect 140,600 IQD    ✓ Formatted
Still need: 130,000 IQD           ✓ Formatted
```

### 4. Real-time Calculations
```
Total Received: 220,000 IQD       ✓ Formatted
Overpaid by: 20,000 IQD           ✓ Formatted
```

### 5. Change Display
```
Change to Give: 50,000 IQD        ✓ Formatted
```

### 6. Payment Summary
```
USD: 50 USD                       ✓ Formatted
IQD: 150,000 IQD                  ✓ Formatted
Change: 20,000 IQD                ✓ Formatted
```

## Technical Details

- **Locale**: `en-US` (provides comma as thousand separator)
- **Decimal Places**: 0 (numbers are rounded to whole integers)
- **Rounding**: Uses `Math.round()` before formatting
- **Null Handling**: Returns "0" or "0 {currency}" for null/undefined/NaN values

## Why This Matters

### Iraqi Dinar (IQD)
IQD uses large numbers due to currency denomination:
- **Without formatting**: 1420000 IQD (hard to read)
- **With formatting**: 1,420,000 IQD (easy to read)

### US Dollar (USD)
USD typically uses smaller numbers:
- **Without formatting**: 1500 USD (readable)
- **With formatting**: 1,500 USD (even better)

## Consistency

All number displays in the Payment Modal use these formatting functions to ensure:
- ✅ Consistent appearance across the UI
- ✅ Easy readability for large IQD amounts
- ✅ Professional presentation
- ✅ Reduced errors in data entry and verification

---

**Last Updated**: October 29, 2025
