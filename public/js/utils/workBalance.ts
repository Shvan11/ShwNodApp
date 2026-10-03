/**
 * What a work still owes — the one place the card, the payment-history box and
 * PaymentModal compute it.
 *
 * The three used to compute it separately, and the history box left out the
 * discount (audit FE-F7-6): a work with a 50,000 discount read *Remaining 0* on
 * its card and *Balance Remaining 50,000* in its payment history, which also
 * offered "Add New Payment" for it.
 */

/** The work-row fields the balance is made of (the works read's `WorkRow`). */
export interface WorkBalanceSource {
  total_required?: number | null;
  discount?: number | null;
  TotalPaid?: number | null;
}

export interface WorkBalance {
  total: number;
  discount: number;
  /** total − discount: what the patient agreed to pay. */
  net: number;
  paid: number;
  /** net − paid; negative when overpaid. */
  remaining: number;
  fullyPaid: boolean;
}

export function workBalance(work: WorkBalanceSource): WorkBalance {
  const total = Number(work.total_required ?? 0);
  const discount = Number(work.discount ?? 0);
  const paid = Number(work.TotalPaid ?? 0);
  const net = total - discount;
  const remaining = net - paid;
  return { total, discount, net, paid, remaining, fullyPaid: remaining <= 0 };
}
