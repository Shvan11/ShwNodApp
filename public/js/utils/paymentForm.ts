/**
 * The Payment Modal's form, as one pure state machine (audit FE-F8-13).
 *
 * `PaymentModal` used to hold this in 18 `useState`s plus six keyed
 * render-phase blocks that fed each other (seed → suggested cash → total/change,
 * cash → amount in cash mode, display formatting), converging over several
 * render passes. Now:
 *  - every input is an EVENT through `paymentFormReducer`;
 *  - the three auto-fill rules run once per event, in dependency order
 *    (`settle`), each only when one of ITS inputs changed — the same triggers
 *    the render blocks were keyed on;
 *  - what is purely derived — the suggestions, the totals, the display strings —
 *    is computed by the functions below instead of being stored.
 *
 * Money is whole units in both currencies (digits only — see `digitsOnly`).
 * Rounding always favours the clinic: cash asked for rounds UP, cash received
 * converts DOWN, change handed back (always IQD) rounds DOWN to 1,000.
 */

export type Currency = 'USD' | 'IQD';
export type PaymentCurrency = Currency | 'MIXED';
export type EntryMode = 'amount' | 'cash';
/** A whole-unit amount, or `''` for an empty field. */
export type Money = number | '';
export type MoneyField = 'amountToRegister' | 'actualUSD' | 'actualIQD';

export interface PaymentFormState {
  paymentDate: string;
  paymentCurrency: PaymentCurrency;
  /** In the work's (account) currency. */
  amountToRegister: Money;
  actualUSD: Money;
  actualIQD: Money;
  /** Change handed back, always IQD. */
  change: number;
  changeManualOverride: boolean;
  /** USD bill override in an IQD account, amount mode. */
  cashOverrideEnabled: boolean;
  /** 'amount' = enter the amount, cash is suggested · 'cash' = enter the cash, amount is derived. */
  entryMode: EntryMode;
  /** Set after the first typed value or a manual toggle — stops auto-detecting the mode. */
  modeLocked: boolean;
  /** The work's currency. Mirrored in so every rule reads one state. */
  accountCurrency: Currency;
  /** The exchange rate in force on `paymentDate` (IQD per USD), or null when none exists. */
  rate: number | null;
}

export type PaymentFormAction =
  /** The modal opened on (or switched to) a work: pay in its currency, amount empty. */
  | { type: 'seed'; accountCurrency: Currency }
  | { type: 'rate'; rate: number | null }
  | { type: 'date'; paymentDate: string }
  | { type: 'paymentCurrency'; value: PaymentCurrency }
  /**
   * A money field typed into. `detectMode` = let the first value pick the entry
   * mode (amount first → amount mode, cash first with no amount → cash mode).
   */
  | { type: 'money'; field: MoneyField; value: Money; detectMode: boolean }
  | { type: 'changeOverride'; value: number }
  | { type: 'payFullBalance'; checked: boolean; remainingBalance: number }
  | { type: 'toggleCashOverride' }
  | { type: 'entryMode'; mode: EntryMode };

/** Digits only — the field shows exactly the number it will send (FE-F8-3/-4). */
export const digitsOnly = (raw: string): Money => {
  const digits = raw.replace(/\D/g, '');
  return digits ? Number(digits) : '';
};

const num = (m: Money): number => (m === '' ? 0 : m);

export function initialPaymentForm(paymentDate: string, accountCurrency: Currency, rate: number | null): PaymentFormState {
  return {
    paymentDate,
    paymentCurrency: accountCurrency,
    amountToRegister: '',
    actualUSD: '',
    actualIQD: '',
    change: 0,
    changeManualOverride: false,
    cashOverrideEnabled: false,
    entryMode: 'amount',
    modeLocked: false,
    accountCurrency,
    rate,
  };
}

// ============================================================================
// DERIVED VALUES
// ============================================================================

/** Cash to ask for in amount mode (0 where there is nothing to suggest). */
export function suggestedCash(s: PaymentFormState): { suggestedUSD: number; suggestedIQD: number } {
  const none = { suggestedUSD: 0, suggestedIQD: 0 };
  if (s.entryMode !== 'amount' || !s.amountToRegister || s.paymentCurrency === 'MIXED') return none;
  const amount = s.amountToRegister;
  // Only the CROSS-currency arms need a rate: an IQD work paid in IQD (or USD in
  // USD) suggests the amount itself, so a deployment that has never recorded a
  // rate can still take its first payments (FE-F8-5).
  if (s.paymentCurrency === 'USD') {
    if (s.accountCurrency === 'USD') return { ...none, suggestedUSD: amount };
    // IQD work paid in USD — round UP to collect more.
    return s.rate ? { ...none, suggestedUSD: Math.ceil(amount / s.rate) } : none;
  }
  if (s.accountCurrency === 'IQD') return { ...none, suggestedIQD: amount };
  // USD work paid in IQD — round UP to the next 1,000.
  return s.rate ? { ...none, suggestedIQD: Math.ceil((amount * s.rate) / 1000) * 1000 } : none;
}

/** The cash given, in the account currency — converted DOWN. Null when that needs a rate there isn't. */
function receivedInAccountCurrency(s: PaymentFormState): number | null {
  const usd = num(s.actualUSD);
  const iqd = num(s.actualIQD);
  const foreign = s.accountCurrency === 'USD' ? iqd : usd;
  if (!s.rate && foreign !== 0) return null;
  const rate = s.rate ?? 0; // only ever applied to a zero foreign leg when 0
  if (s.accountCurrency === 'USD') return usd + (rate ? Math.floor(iqd / rate) : 0);
  return (rate ? Math.floor((usd * rate) / 1000) * 1000 : 0) + iqd;
}

export interface CashTotals {
  /** Received, in the account currency. */
  totalReceived: number;
  /** Change owed, in IQD (0 when there is no overpayment or no rate to express it). */
  calculatedChange: number;
  isShort: boolean;
  isOver: boolean;
}

/** Totals for the cash entered; null when foreign cash was entered and there is no rate to convert it. */
export function cashTotals(s: PaymentFormState): CashTotals | null {
  const received = receivedInAccountCurrency(s);
  if (received === null) return null;
  const amount = num(s.amountToRegister);
  const overpayment = received - amount;
  let changeInIQD = 0;
  if (overpayment > 0) {
    changeInIQD =
      s.accountCurrency === 'USD'
        ? (s.rate ? Math.floor((overpayment * s.rate) / 1000) * 1000 : 0)
        : Math.floor(overpayment / 1000) * 1000;
  }
  return {
    totalReceived: Math.round(received),
    calculatedChange: changeInIQD,
    isShort: received < amount,
    isOver: received > amount,
  };
}

// ============================================================================
// TRANSITIONS
// ============================================================================

const changed = <K extends keyof PaymentFormState>(a: PaymentFormState, b: PaymentFormState, keys: K[]) =>
  keys.some((k) => a[k] !== b[k]);

/**
 * The auto-fill rules, in dependency order, each run only when one of its own
 * inputs moved between `prev` and `next`:
 *  1. amount mode — the cash fields follow the suggestion (unless overridden);
 *  2. cash mode — the amount follows the cash;
 *  3. the change follows cash/amount/rate. A manual override holds until one of
 *     those moves, then is recomputed: it used to stick, so lowering the cash
 *     after overriding 5,000 still submitted 5,000 (FE-F8-13).
 */
function settle(prev: PaymentFormState, next: PaymentFormState): PaymentFormState {
  let s = next;

  if (changed(prev, s, ['amountToRegister', 'paymentCurrency', 'rate', 'entryMode', 'accountCurrency'])) {
    if (s.entryMode === 'amount' && s.amountToRegister && s.paymentCurrency !== 'MIXED' && !s.cashOverrideEnabled) {
      const { suggestedUSD, suggestedIQD } = suggestedCash(s);
      s = { ...s, actualUSD: suggestedUSD || '', actualIQD: suggestedIQD || '' };
    }
  }

  if (changed(prev, s, ['actualUSD', 'actualIQD', 'entryMode', 'rate', 'accountCurrency'])) {
    if (s.entryMode === 'cash') {
      if (num(s.actualUSD) === 0 && num(s.actualIQD) === 0) {
        s = { ...s, amountToRegister: '' };
      } else {
        const received = receivedInAccountCurrency(s);
        if (received !== null) s = { ...s, amountToRegister: received };
      }
    }
  }

  if (changed(prev, s, ['actualUSD', 'actualIQD', 'amountToRegister', 'rate', 'accountCurrency'])) {
    const totals = cashTotals(s);
    if (totals) s = { ...s, change: totals.calculatedChange, changeManualOverride: false };
  }

  return s;
}

function step(s: PaymentFormState, a: PaymentFormAction): PaymentFormState {
  switch (a.type) {
    case 'seed':
      return { ...s, accountCurrency: a.accountCurrency, paymentCurrency: a.accountCurrency, amountToRegister: '' };

    case 'rate':
      return { ...s, rate: a.rate };

    case 'date':
      return { ...s, paymentDate: a.paymentDate };

    case 'paymentCurrency': {
      // Switching currency clears the cash field that no longer applies and the override.
      let next: PaymentFormState =
        a.value === 'USD' ? { ...s, paymentCurrency: 'USD', actualIQD: '', cashOverrideEnabled: false }
        : a.value === 'IQD' ? { ...s, paymentCurrency: 'IQD', actualUSD: '', cashOverrideEnabled: false }
        : { ...s, paymentCurrency: 'MIXED', cashOverrideEnabled: false };
      // Same-currency payments can't run in cash mode — "amount owed" can't be
      // derived from cash in the same currency — so drop back to amount mode.
      if (a.value === s.accountCurrency && s.entryMode === 'cash') {
        next = { ...next, entryMode: 'amount', modeLocked: false };
      }
      return next;
    }

    case 'money': {
      let next: PaymentFormState = { ...s, [a.field]: a.value };
      if (a.detectMode && !s.modeLocked && a.value) {
        if (a.field === 'amountToRegister') {
          next = { ...next, entryMode: 'amount', modeLocked: true };
        } else if (!s.amountToRegister) {
          next = { ...next, entryMode: 'cash', modeLocked: true };
        }
      }
      return next;
    }

    case 'changeOverride':
      return { ...s, change: a.value, changeManualOverride: true };

    case 'payFullBalance':
      return {
        ...s,
        modeLocked: true,
        entryMode: 'amount',
        amountToRegister: a.checked && a.remainingBalance > 0 ? a.remainingBalance : '',
      };

    case 'toggleCashOverride':
      return { ...s, cashOverrideEnabled: !s.cashOverrideEnabled };

    case 'entryMode':
      if (a.mode === s.entryMode) return s;
      // A manual toggle locks the mode. The side being auto-derived is cleared
      // and recomputed from the side being typed.
      return a.mode === 'cash'
        ? { ...s, entryMode: 'cash', modeLocked: true, amountToRegister: '', change: 0, changeManualOverride: false, cashOverrideEnabled: false }
        : { ...s, entryMode: 'amount', modeLocked: true, actualUSD: '', actualIQD: '', change: 0, changeManualOverride: false, cashOverrideEnabled: false };
  }
}

export function paymentFormReducer(s: PaymentFormState, a: PaymentFormAction): PaymentFormState {
  const next = step(s, a);
  return next === s ? s : settle(s, next);
}
