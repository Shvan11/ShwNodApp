import { describe, expect, it } from 'vitest';
import {
  cashTotals,
  digitsOnly,
  initialPaymentForm,
  paymentFormReducer,
  suggestedCash,
  type PaymentFormAction,
  type PaymentFormState,
} from './paymentForm';

const RATE = 1500;
const run = (s: PaymentFormState, ...actions: PaymentFormAction[]) => actions.reduce(paymentFormReducer, s);
const iqdWork = (rate: number | null = RATE) => initialPaymentForm('2026-10-03', 'IQD', rate);
const usdWork = (rate: number | null = RATE) => initialPaymentForm('2026-10-03', 'USD', rate);
const type = (field: 'amountToRegister' | 'actualUSD' | 'actualIQD', value: number | '', detectMode = true): PaymentFormAction =>
  ({ type: 'money', field, value, detectMode });

describe('paymentForm (FE-F8-13)', () => {
  it('digitsOnly keeps whole units only', () => {
    expect(digitsOnly('1,560')).toBe(1560);
    expect(digitsOnly('99.5')).toBe(995);
    expect(digitsOnly('')).toBe('');
  });

  describe('amount mode', () => {
    it('IQD work paid in IQD: cash follows the amount, no rate needed (FE-F8-5)', () => {
      const s = run(iqdWork(null), type('amountToRegister', 250000));
      expect(s).toMatchObject({ entryMode: 'amount', modeLocked: true, actualIQD: 250000, actualUSD: '' });
      expect(cashTotals(s)).toEqual({ totalReceived: 250000, calculatedChange: 0, isShort: false, isOver: false });
    });

    it('IQD work paid in USD rounds the dollars UP', () => {
      const s = run(iqdWork(), { type: 'paymentCurrency', value: 'USD' }, type('amountToRegister', 100000));
      expect(suggestedCash(s).suggestedUSD).toBe(67); // 100,000 / 1,500 = 66.67 → 67
      expect(s.actualUSD).toBe(67);
      // 67 × 1,500 = 100,500 → converted DOWN to 100,000; nothing over, no change
      expect(cashTotals(s)).toMatchObject({ totalReceived: 100000, isShort: false, isOver: false, calculatedChange: 0 });
    });

    it('USD work paid in IQD rounds the dinars UP to 1,000', () => {
      const s = run(usdWork(), { type: 'paymentCurrency', value: 'IQD' }, type('amountToRegister', 101));
      expect(s.actualIQD).toBe(152000); // 151,500 → 152,000
    });

    it('a cross-currency suggestion without a rate leaves the cash empty', () => {
      const s = run(iqdWork(null), { type: 'paymentCurrency', value: 'USD' }, type('amountToRegister', 100000));
      expect(s.actualUSD).toBe('');
    });

    it('the rate arriving later fills the suggestion in', () => {
      const s = run(iqdWork(null), { type: 'paymentCurrency', value: 'USD' }, type('amountToRegister', 150000), { type: 'rate', rate: RATE });
      expect(s.actualUSD).toBe(100);
    });

    it('a USD overpayment on a USD work owes change in IQD, rounded DOWN', () => {
      // $100 bill for a $90 payment: $10 over × 1,500 = 15,000
      const s = run(usdWork(), type('amountToRegister', 90), { type: 'toggleCashOverride' }, type('actualUSD', 100, false));
      expect(s.change).toBe(15000);
      expect(cashTotals(s)).toMatchObject({ totalReceived: 100, isOver: true });
    });
  });

  describe('cash mode', () => {
    it('cash typed first (no amount) locks cash mode and derives the amount, converted DOWN', () => {
      const s = run(iqdWork(), { type: 'paymentCurrency', value: 'MIXED' }, type('actualUSD', 100), type('actualIQD', 20000));
      expect(s).toMatchObject({ entryMode: 'cash', modeLocked: true });
      expect(s.amountToRegister).toBe(170000); // 100 × 1,500 = 150,000 + 20,000
    });

    it('clearing all the cash clears the amount', () => {
      const s = run(iqdWork(), { type: 'paymentCurrency', value: 'MIXED' }, type('actualIQD', 20000), type('actualIQD', ''));
      expect(s.amountToRegister).toBe('');
    });

    it('foreign cash with no rate leaves the amount and totals unknown', () => {
      const s = run(iqdWork(null), { type: 'paymentCurrency', value: 'MIXED' }, type('actualUSD', 100));
      expect(s.amountToRegister).toBe('');
      expect(cashTotals(s)).toBeNull();
    });

    it('switching to a same-currency payment drops back to amount mode, unlocked', () => {
      const s = run(iqdWork(), { type: 'paymentCurrency', value: 'MIXED' }, type('actualUSD', 100), { type: 'paymentCurrency', value: 'IQD' });
      expect(s).toMatchObject({ entryMode: 'amount', modeLocked: false, actualUSD: '' });
    });
  });

  describe('change override', () => {
    it('a manual change holds until the cash behind it moves, then is recomputed', () => {
      let s = run(usdWork(), type('amountToRegister', 90), { type: 'toggleCashOverride' }, type('actualUSD', 100, false));
      s = run(s, { type: 'changeOverride', value: 5000 });
      expect(s).toMatchObject({ change: 5000, changeManualOverride: true });
      s = run(s, { type: 'toggleCashOverride' }); // unrelated — the override holds
      expect(s.change).toBe(5000);
      s = run(s, type('actualUSD', 95, false)); // $5 over → 7,500 → 7,000
      expect(s).toMatchObject({ change: 7000, changeManualOverride: false });
    });
  });

  describe('mode toggles', () => {
    it('to cash keeps the cash and derives the amount; to amount keeps the amount and re-suggests the cash', () => {
      let s = run(iqdWork(), type('amountToRegister', 300000));
      expect(s.actualIQD).toBe(300000);
      s = run(s, { type: 'entryMode', mode: 'cash' });
      expect(s).toMatchObject({ entryMode: 'cash', amountToRegister: 300000, actualIQD: 300000 });
      s = run(s, { type: 'entryMode', mode: 'amount' });
      expect(s).toMatchObject({ entryMode: 'amount', amountToRegister: 300000, actualIQD: 300000 });
    });

    it('pay full balance fills the remaining balance in amount mode', () => {
      const s = run(iqdWork(), { type: 'payFullBalance', checked: true, remainingBalance: 450000 });
      expect(s).toMatchObject({ entryMode: 'amount', modeLocked: true, amountToRegister: 450000, actualIQD: 450000 });
      expect(run(s, { type: 'payFullBalance', checked: false, remainingBalance: 450000 }).amountToRegister).toBe('');
    });
  });

  it('re-seeding on a new work pays in its currency with an empty amount', () => {
    const s = run(iqdWork(), type('amountToRegister', 1000), { type: 'seed', accountCurrency: 'USD' });
    expect(s).toMatchObject({ accountCurrency: 'USD', paymentCurrency: 'USD', amountToRegister: '' });
  });

  it('a no-op event returns the same state object', () => {
    const s = iqdWork();
    expect(paymentFormReducer(s, { type: 'entryMode', mode: 'amount' })).toBe(s);
  });
});
