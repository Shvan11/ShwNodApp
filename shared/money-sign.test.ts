/**
 * The money boundary rejects negatives — regression pin.
 *
 * `moneyInt` shipped with only the fractional guard, and 6 of the 12 contract
 * fields using it never added a sign check, so `POST /api/addInvoice` accepted
 * `amountPaid: -100000`. That is not a cosmetic wrong number: neither
 * PaymentService's pre-check nor the locked re-check in
 * `addInvoiceWithBalanceGuard` tests a LOWER bound (both ask only
 * `amount > remaining`, which any negative passes), so the row was inserted and
 * a negative `amount_paid` RAISES the work's outstanding balance and skews every
 * report summing that column — the doctor-commission figures included.
 *
 * The floor now lives in `moneyInt` itself, so these assertions also pin the
 * DEFAULT: a money field added later inherits it without anyone remembering to.
 */
import { describe, it, expect } from 'vitest';
import { moneyInt } from './validation.js';
import { addInvoice } from './contracts/payment.contract.js';
import { addPayment } from './contracts/aligner.contract.js';
import * as stand from './contracts/stand.contract.js';
import { estimatedCost } from './contracts/patient.contract.js';

const invoice = (amountPaid: unknown) => ({
  workid: 1,
  amountPaid,
  paymentDate: '2026-09-09',
});

describe('moneyInt', () => {
  it('rejects a negative amount', () => {
    const r = moneyInt.safeParse(-1);
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe('Amount cannot be negative');
  });

  it('still rejects a fractional amount (the original F7.9 guard)', () => {
    expect(moneyInt.safeParse(12.99).success).toBe(false);
  });

  it('accepts zero and positive whole amounts', () => {
    expect(moneyInt.safeParse(0).success).toBe(true);
    expect(moneyInt.safeParse(2_500_000).success).toBe(true);
  });

  it('coerces a form-submitted string', () => {
    expect(moneyInt.parse('2500')).toBe(2500);
  });
});

describe('POST /api/addInvoice body', () => {
  it('rejects a negative payment', () => {
    expect(addInvoice.body.safeParse(invoice(-100000)).success).toBe(false);
  });

  it('rejects a zero payment — 0 is not a payment', () => {
    expect(addInvoice.body.safeParse(invoice(0)).success).toBe(false);
  });

  it('accepts a normal payment', () => {
    expect(addInvoice.body.safeParse(invoice(100000)).success).toBe(true);
  });

  it('rejects negative change — validated only when > 0 downstream', () => {
    expect(
      addInvoice.body.safeParse({ ...invoice(100000), change: -500 }).success
    ).toBe(false);
  });

  it('rejects a negative cash leg', () => {
    expect(
      addInvoice.body.safeParse({ ...invoice(100000), iqdReceived: -1 }).success
    ).toBe(false);
    expect(
      addInvoice.body.safeParse({ ...invoice(100000), usdReceived: -1 }).success
    ).toBe(false);
  });

  it('still allows the cash legs and change to be omitted', () => {
    expect(addInvoice.body.safeParse(invoice(100000)).success).toBe(true);
  });
});

describe('the other money boundaries', () => {
  it('rejects a negative aligner payment', () => {
    const base = {
      workid: 1,
      aligner_set_id: 1,
      date_of_payment: '2026-09-09',
    };
    expect(addPayment.body.safeParse({ ...base, amount_paid: -50 }).success).toBe(false);
    expect(addPayment.body.safeParse({ ...base, amount_paid: 0 }).success).toBe(false);
    expect(addPayment.body.safeParse({ ...base, amount_paid: 50 }).success).toBe(true);
  });

  it('rejects negative Stand prices and a negative tendered amount', () => {
    expect(stand.updateItem.body.safeParse({ costPrice: -5 }).success).toBe(false);
    expect(stand.updateItem.body.safeParse({ sellPrice: -5 }).success).toBe(false);
    expect(
      stand.createSale.body.safeParse({
        items: [{ itemId: 1, quantity: 1 }],
        amountPaid: -50,
      }).success
    ).toBe(false);
  });

  it('rejects a negative estimated cost', () => {
    expect(
      estimatedCost.body.safeParse({ estimatedCost: -900, currency: 'IQD' }).success
    ).toBe(false);
    expect(
      estimatedCost.body.safeParse({ estimatedCost: 900, currency: 'IQD' }).success
    ).toBe(true);
  });
});
