import { useReducer, useState } from 'react';
import type { ChangeEvent, FormEvent, FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import styles from './PaymentModal.module.css';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { formatNumber, formatCurrency } from '../../utils/formatters';
import { workBalance } from '../../utils/workBalance';
import { ENTRY_DATE_MIN, unusualEntryDate } from '../../utils/entryDate';
import { formatISODate } from '../../core/utils';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { exchangeRateForDateQuery } from '@/query/queries';
import {
    updateExchangeRate as updateExchangeRateContract,
    addInvoice as addInvoiceContract,
    type AddInvoiceResponse,
} from '@shared/contracts/payment.contract';
import type { WorkRow } from '@shared/contracts/work.contract';
import { parseWorkCurrency } from '@shared/work-currency';
import {
    cashTotals,
    digitsOnly,
    initialPaymentForm,
    paymentFormReducer,
    suggestedCash,
    type EntryMode,
    type MoneyField,
    type PaymentCurrency,
} from '../../utils/paymentForm';

// Types
/** The fields of a works-list row this modal reads (the row itself is passed in). */
type WorkData = Pick<WorkRow, 'work_id' | 'type_name' | 'total_required' | 'TotalPaid' | 'currency' | 'discount'>;

/** What the success view shows: the amount just registered, in the work's currency. */
interface PaidToday {
    amount: number;
    currency: 'USD' | 'IQD';
}

interface PaymentModalProps {
    workData: WorkData | null;
    onClose: () => void;
    onSuccess?: () => void;
}

/** Ask before recording a rate this far from the one in use (FE-F8-3). */
const RATE_DEVIATION_CONFIRM = 0.1;

const PaymentModal = ({ workData, onClose, onSuccess }: PaymentModalProps) => {
    const { t } = useTranslation('payments');
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(false);
    const [showRateInput, setShowRateInput] = useState(false);
    // The rate being typed, digits only (`''` = empty).
    const [newRateValue, setNewRateValue] = useState<number | ''>('');
    const [paymentSuccess, setPaymentSuccess] = useState(false);
    const [paidToday, setPaidToday] = useState<PaidToday | null>(null);

    // The form is one state machine (utils/paymentForm.ts): every input is an
    // event, the auto-fills (suggested cash, cash → amount, change) run inside
    // the reducer, and everything purely derived is computed below instead of
    // stored. It was 18 useStates and six keyed render-phase blocks feeding each
    // other over several render passes (audit FE-F8-13).
    const accountCurrencyOfWork = parseWorkCurrency(workData?.currency) ?? 'IQD';
    const [form, dispatch] = useReducer(paymentFormReducer, undefined, () =>
        initialPaymentForm(formatISODate(), accountCurrencyOfWork, null)
    );

    // The exchange rate in force on the payment date. The endpoint carries the last
    // known rate forward, so its 404 — which drives the inline "Set Rate" prompt, no
    // throw — means no rate has EVER been recorded, not just none for this day.
    const { data: rateData } = useQuery(exchangeRateForDateQuery(form.paymentDate));
    const exchangeRate = rateData?.exchangeRate ?? null;
    // True when the day has no rate of its own and an earlier one stood in for it.
    const rateIsCarriedForward = !!rateData?.isCarriedForward;

    // Outside inputs enter the machine as events, during render, keyed on the
    // machine's own copy — no setState-in-effect.
    if (form.rate !== exchangeRate) {
        dispatch({ type: 'rate', rate: exchangeRate });
    }
    // Re-seed when the modal opens on another work (not while showing a success).
    const [seededInit, setSeededInit] = useState<{ work: WorkData | null; success: boolean }>({ work: workData, success: paymentSuccess });
    if (seededInit.work !== workData || seededInit.success !== paymentSuccess) {
        setSeededInit({ work: workData, success: paymentSuccess });
        if (workData && !paymentSuccess) dispatch({ type: 'seed', accountCurrency: accountCurrencyOfWork });
    }

    const accountCurrency = form.accountCurrency;
    const entryMode = form.entryMode;
    const remainingBalance = workData ? workBalance(workData).remaining : 0;
    const suggested = suggestedCash(form);
    // Null while foreign cash waits for a rate (the Save button is gated on it then).
    const totals = cashTotals(form);
    const isShort = totals?.isShort ?? false;
    const isOver = totals?.isOver ?? false;
    // Each field shows exactly the number it will send, grouped.
    const display = {
        amountToRegister: formatNumber(form.amountToRegister),
        actualUSD: formatNumber(form.actualUSD),
        actualIQD: formatNumber(form.actualIQD),
        change: formatNumber(form.change),
    };

    const handleSetExchangeRate = async () => {
        const rate = newRateValue;
        if (!rate || rate <= 0) {
            toast.warning(t('validation.enterValidRate'));
            return;
        }

        // Never overwrite a rate the day already owns. `sms` keeps ONE rate per date and
        // the statistics rows convert each day at its own rate, so rewriting a stored
        // rate silently restates that day's Grand Total. The editor is only offered when
        // the day has no rate of its own (none at all, or one carried forward), and this
        // re-checks it against the rate actually loaded at save time.
        if (exchangeRate && !rateIsCarriedForward) {
            toast.warning(t('validation.rateAlreadySet', { date: form.paymentDate }));
            setShowRateInput(false);
            setNewRateValue('');
            return;
        }

        // A rate far from the one in use (the carried-forward rate it replaces) is far
        // more likely a typo than a market move — one digit short converts every
        // cross-currency payment that day at a tenth of the real rate. Ask first.
        if (exchangeRate && Math.abs(rate - exchangeRate) / exchangeRate > RATE_DEVIATION_CONFIRM) {
            const proceed = await confirm(
                t('confirm.rateDeviationMessage', {
                    rate: formatNumber(rate),
                    current: formatNumber(exchangeRate),
                    percent: Math.round(Math.abs(rate - exchangeRate) / exchangeRate * 100),
                }),
                { title: t('confirm.rateDeviationTitle'), confirmText: t('confirm.rateDeviationConfirm') }
            );
            if (!proceed) return;
        }

        // Recording a rate for a PAST day is legitimate (it's the rate that really stood
        // that day) but it does restate that day's totals — so it's confirmed, not silent.
        if (form.paymentDate < formatISODate()) {
            const proceed = await confirm(
                t('confirm.backdatedRateMessage', { date: form.paymentDate, rate: formatNumber(rate) }),
                { title: t('confirm.backdatedRateTitle'), confirmText: t('confirm.backdatedRateConfirm') }
            );
            if (!proceed) return;
        }

        try {
            setLoading(true);
            // Enveloped (sendSuccess); a non-2xx now throws and is handled below.
            await postJSON('/api/updateExchangeRateForDate', {
                date: form.paymentDate,
                exchangeRate: rate
            }, { schema: updateExchangeRateContract.response });

            // Invalidate the exchange-rate cache so this date's rate (and every other
            // observer, e.g. ExchangeRatesSettings) refetches and the derived
            // `exchangeRate` updates. Matches ExchangeRatesSettings' own write path.
            await queryClient.invalidateQueries({ queryKey: qk.exchangeRates.all() });
            setShowRateInput(false);
            setNewRateValue('');
        } catch (error) {
            console.error('Error setting exchange rate:', error);
            toast.error(t('toast.rateError', { error: httpErrorMessage(error, 'unknown error') }));
        } finally {
            setLoading(false);
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        if (name === 'paymentCurrency') {
            dispatch({ type: 'paymentCurrency', value: value as PaymentCurrency });
        } else if (name === 'paymentDate') {
            dispatch({ type: 'date', paymentDate: value });
            // The rate editor writes to whatever date the form holds, so it must never
            // outlive the date it was opened for: open it on a day with no rate, switch
            // to an earlier date that HAS one, and the save would silently rewrite that
            // day's recorded rate.
            setShowRateInput(false);
            setNewRateValue('');
        }
    };

    // A typed money field; the first value typed picks the entry mode until it is locked.
    const handleMoneyInputChange = (field: MoneyField, value: string) => {
        dispatch({ type: 'money', field, value: digitsOnly(value), detectMode: true });
    };

    // Handle focus - select all text only when value is "0"
    const handleMoneyInputFocus = (e: FocusEvent<HTMLInputElement>) => {
        // If value is "0", select it so user can immediately type to replace (no cursor confusion)
        if (e.target.value === '0') {
            e.target.select();
        }
    };

    // Toggle: fill the amount field with the exact remaining balance (zeroes the balance)
    const handlePayFullBalanceToggle = (checked: boolean) => {
        dispatch({ type: 'payFullBalance', checked, remainingBalance });
    };

    const handleChangeOverride = (value: string) => {
        dispatch({ type: 'changeOverride', value: digitsOnly(value) || 0 });
    };

    // Toggle cash override mode (for USD bill override in IQD account + Amount mode)
    const handleCashOverrideToggle = () => dispatch({ type: 'toggleCashOverride' });

    // The USD bill typed in override mode — the change is recomputed from it.
    const handleOverrideUSDChange = (value: string) => {
        dispatch({ type: 'money', field: 'actualUSD', value: digitsOnly(value), detectMode: false });
    };

    // Handle entry mode toggle change (always locks mode after manual toggle)
    const handleEntryModeChange = (newMode: EntryMode) => dispatch({ type: 'entryMode', mode: newMode });

    // Detect same-currency payment for change tracking (only IQD-to-IQD)
    // USD-to-USD tracks change as IQD because clinic uses $50/$100 bills
    const isSameCurrencyPayment =
        accountCurrency === 'IQD' && form.paymentCurrency === 'IQD';

    // THE single source of truth for whether change is tracked on this payment —
    // read by the Change field, the summary strip AND handleSubmit. Change is not
    // tracked for:
    // 1. Cash mode (registering exactly what was given, no target amount)
    // 2. IQD-to-IQD same currency (exact payments expected)
    // 3. USD account + IQD payment in amount mode (auto-calculated, no change needed)
    //
    // Submit used to re-derive this from the cash amounts instead (`actualIQD > 0 &&
    // actualUSD === 0`), which disagreed with the UI on a MIXED payment settled in IQD
    // only: the field showed and auto-calculated change, then submit sent null. The cash
    // handed back went unrecorded and ExpectedCashIQD overstated the drawer by it.
    const isChangeDisabled =
        entryMode === 'cash' ||
        isSameCurrencyPayment ||
        (accountCurrency === 'USD' && form.paymentCurrency === 'IQD');

    // Whether this payment genuinely needs an exchange rate. Only two things convert:
    // cash taken in a currency other than the work's, and change (always handed back in
    // IQD) owed on a USD-denominated overpayment. Saving was previously gated on the
    // rate unconditionally, so an IQD work being paid in IQD — nothing to convert —
    // could not be registered at all until someone entered the day's rate.
    const usdCash = parseFloat(String(form.actualUSD)) || 0;
    const iqdCash = parseFloat(String(form.actualIQD)) || 0;
    const foreignCashEntered =
        accountCurrency === 'USD' ? iqdCash > 0 : usdCash > 0;
    const rateRequired =
        (form.paymentCurrency === 'MIXED'
            // MIXED only converts once foreign cash is actually entered.
            ? foreignCashEntered
            : form.paymentCurrency !== accountCurrency) ||
        (accountCurrency === 'USD' && !isChangeDisabled && isOver);

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const actualUSD = parseInt(String(form.actualUSD), 10) || 0;
        const actualIQD = parseInt(String(form.actualIQD), 10) || 0;
        const amountPaid = parseInt(String(form.amountToRegister), 10) || 0;

        // Validation based on entry mode
        if (entryMode === 'amount') {
            // Amount mode: Must have amount entered
            if (!amountPaid) {
                toast.warning(t('validation.enterAmount'));
                return;
            }
        } else {
            // Cash mode: Must have cash entered (amount will be calculated)
            if (actualUSD === 0 && actualIQD === 0) {
                toast.warning(t('validation.enterCash'));
                return;
            }
            // In cash mode, amountPaid should have been calculated - validate it exists
            if (!amountPaid) {
                toast.warning(t('validation.cantCalculate'));
                return;
            }
        }

        if (actualUSD === 0 && actualIQD === 0) {
            toast.warning(t('validation.enterAtLeastOne'));
            return;
        }

        if (rateRequired && !exchangeRate) {
            toast.warning(t('validation.rateRequired', { date: form.paymentDate }));
            return;
        }

        if (remainingBalance > 0 && amountPaid > remainingBalance) {
            toast.error(t('validation.exceedsBalance', { balance: formatCurrency(remainingBalance, accountCurrency) }));
            return;
        }

        if (isShort) {
            if (!await confirm(t('confirm.underpaymentMessage'), { title: t('confirm.underpaymentTitle'), confirmText: t('confirm.underpaymentConfirm') })) return;
        }

        // A slipped year digit saves silently otherwise, outside every daily total (FE-F8-9).
        const unusualDate = unusualEntryDate(form.paymentDate, formatISODate());
        if (unusualDate) {
            const message = unusualDate === 'future'
                ? t('confirm.futureDateMessage', { date: form.paymentDate })
                : t('confirm.oldDateMessage', { date: form.paymentDate });
            if (!await confirm(message, { title: t('confirm.unusualDateTitle'), confirmText: t('confirm.unusualDateConfirm') })) return;
        }

        // Change is saved exactly when the form tracked it (see isChangeDisabled above):
        // NULL for the untracked scenarios, the entered/auto-calculated value otherwise.
        const changeToSubmit = isChangeDisabled ? null : (parseInt(String(form.change), 10) || 0);

        // Validate cross-currency change doesn't exceed received amounts
        if (changeToSubmit !== null && changeToSubmit > 0) {
            // Simple case: IQD only payment
            if (actualUSD === 0 && changeToSubmit > actualIQD) {
                toast.error(t('validation.invalidChange', { change: changeToSubmit, received: actualIQD }));
                return;
            }
        }

        try {
            setLoading(true);

            const invoiceData = {
                workid: workData!.work_id,
                amountPaid: amountPaid,
                paymentDate: form.paymentDate,
                usdReceived: actualUSD,
                iqdReceived: actualIQD,
                change: changeToSubmit  // NULL for same-currency, number for cross-currency
            };

            // Enveloped (sendSuccess) → postJSON unwraps to the inner result; a non-2xx
            // (validation/insufficient-balance) now throws and is handled in the catch.
            await postJSON<AddInvoiceResponse>('/api/addInvoice', invoiceData, {
                schema: addInvoiceContract.response,
            });
            queryClient.invalidateQueries({ queryKey: qk.work.all(workData!.work_id) });

            // The success view shows what was registered, in the work's currency. (The
            // printed receipt is rendered server-side from the saved invoice.)
            setPaymentSuccess(true);
            setPaidToday({ amount: amountPaid, currency: accountCurrency });

            // Flat { success, messageId } / { success:false, message } at HTTP 200 → passthrough.
            postJSON<{ success: boolean; message?: string }>('/api/wa/send-receipt', { workId: workData!.work_id })
                .then((waResult) => {
                    if (waResult.success) {
                        toast.success(t('toast.receiptSent'));
                    } else {
                        toast.warning(waResult.message || t('toast.whatsappFailed'));
                    }
                })
                .catch(err => {
                    toast.error(t('toast.whatsappError', { error: httpErrorMessage(err, 'unknown error') }));
                });

            onSuccess?.();
        } catch (error) {
            console.error('Error adding payment:', error);
            toast.error(t('toast.paymentError', { error: httpErrorMessage(error, 'unknown error') }));
        } finally {
            setLoading(false);
        }
    };

    const handlePrint = async () => {
        try {
            // Fetch receipt HTML from template-based system using work ID.
            // eslint-disable-next-line no-restricted-syntax -- returns raw HTML text (res.type('html').send), not JSON; the envelope-unwrapping client doesn't apply (cf. GrapesJSEditor /html).
            const response = await fetch(`/api/templates/receipt/work/${workData!.work_id}`);
            if (!response.ok) throw new Error('Failed to generate receipt');

            const html = await response.text();

            // Create print window
            const printWindow = window.open('', '_blank', 'width=800,height=600');
            if (!printWindow) {
                throw new Error(t('toast.popupBlocked'));
            }

            // Write content
            printWindow.document.open();
            printWindow.document.write(html);
            printWindow.document.close();

            // Wait for load, then print and close (matches Videos.tsx pattern)
            printWindow.onload = function() {
                printWindow.focus();
                printWindow.print();
                printWindow.close();
            };
        } catch (err) {
            console.error('Error printing receipt:', err);
            toast.error(t('toast.printFailed', { error: (err as Error).message }));
        }
    };

    const handleCloseAfterSuccess = () => {
        setPaymentSuccess(false);
        setPaidToday(null);
        onClose();
    };

    if (!workData) return null;

    // Whether the amount field currently equals the full remaining balance
    // (drives the "Pay full balance" checkbox; auto-unticks when the user edits the amount)
    const amountEqualsBalance =
        remainingBalance > 0 &&
        (parseFloat(String(form.amountToRegister)) || 0) === Math.round(remainingBalance);

    // Detect same-currency selection (for entry mode locking)
    // Cash mode doesn't make sense for same-currency - can't derive "amount owed" from "cash received"
    const isSameCurrencySelection =
        (accountCurrency === 'USD' && form.paymentCurrency === 'USD') ||
        (accountCurrency === 'IQD' && form.paymentCurrency === 'IQD');

    // "Set Rate" link → inline rate input. Shared by the no-rate banner and the
    // carried-forward one (both let staff record this day's actual rate).
    const rateEditor = !showRateInput ? (
        <button type="button" onClick={() => setShowRateInput(true)} className={styles.btnLink}>
            {t('exchangeRate.setRate')}
        </button>
    ) : (
        <div className={styles.rateInputInline}>
            <input
                type="text"
                inputMode="numeric"
                aria-label={t('exchangeRate.setRate')}
                value={formatNumber(newRateValue)}
                onChange={(e) => setNewRateValue(digitsOnly(e.target.value))}
                placeholder="1,406"
                className={styles.rateInputSmall}
            />
            <button type="button" onClick={handleSetExchangeRate} disabled={loading} className={styles.btnSmPrimary}>
                {loading ? '...' : t('exchangeRate.save')}
            </button>
            <button type="button" onClick={() => { setShowRateInput(false); setNewRateValue(''); }} className={styles.btnSmGhost}>
                {t('actions.closeX')}
            </button>
        </div>
    );

    return (
        <Modal
            isOpen={true}
            onClose={paymentSuccess ? handleCloseAfterSuccess : onClose}
            contentClassName={`${styles.modalContent} ${styles.invoiceModal} ${styles.paymentModalCompact}`}
            ariaLabelledBy="payment-modal-title"
            // A stray backdrop click or Escape must not destroy a filled payment.
            // `resetKey` flips once the payment is saved: the receipt view is not
            // unsaved work, so closing it must not ask about the typing behind it.
            unsavedGuard={{ watchInput: true, resetKey: paymentSuccess ? 1 : 0 }}
        >
            {(dismiss) => (!paymentSuccess ? (
                    <>
                        {/* Compact Header with Balance Info */}
                        <ModalHeader
                            dense
                            titleId="payment-modal-title"
                            title={t('modal.title')}
                            icon={<i className="fas fa-credit-card" />}
                            subtitle={workData.type_name || t('modal.workFallback', { id: workData.work_id })}
                            onClose={dismiss}
                            actions={
                                <div className={styles.paymentBalanceBadge}>
                                    <span className={styles.balanceLabel}>{t('balance.label')}</span>
                                    <span className={styles.balanceAmount}>{formatCurrency(remainingBalance, accountCurrency)}</span>
                                    {Number(workData.discount ?? 0) > 0 && (
                                        <span className={`${styles.balanceLabel} ${styles.discountNote}`}>
                                            <i className="fas fa-tag"></i> {formatCurrency(Number(workData.discount), accountCurrency)} {t('balance.discountApplied')}
                                        </span>
                                    )}
                                </div>
                            }
                        />

                        {/* Exchange Rate - Compact Inline. Shown in three states: no rate on
                            record at all, a rate carried forward from an earlier day (offer to
                            set the real one), or this day's own rate. */}
                        {!exchangeRate ? (
                            <div className={styles.exchangeRateErrorCompact}>
                                <i className="fas fa-exclamation-triangle"></i>
                                <span>{t('exchangeRate.noRate', { date: form.paymentDate })}</span>
                                {rateEditor}
                            </div>
                        ) : (
                            <div className={styles.exchangeRateCompact}>
                                <i className="fas fa-exchange-alt"></i>
                                <span>{t('exchangeRate.display', { rate: formatNumber(exchangeRate) })}</span>
                                {rateIsCarriedForward ? (
                                    <>
                                        <span className={styles.rateDate}>
                                            {t('exchangeRate.carriedForward', { date: rateData?.rateDate ?? '' })}
                                        </span>
                                        {rateEditor}
                                    </>
                                ) : (
                                    <span className={styles.rateDate}>({form.paymentDate})</span>
                                )}
                            </div>
                        )}

                        <form onSubmit={handleSubmit} className={`${styles.invoiceForm} ${styles.paymentFormCompact}`}>
                            {/* Row 1: Currency + Entry Mode + Date */}
                            <div className={styles.paymentRowCompact}>
                                <div className={styles.paymentField}>
                                    <label htmlFor="payment-currency">{t('form.currency')}</label>
                                    <select
                                        id="payment-currency"
                                        name="paymentCurrency"
                                        value={form.paymentCurrency}
                                        onChange={handleInputChange}
                                        className={styles.selectCompact}
                                    >
                                        <option value="USD">{t('form.usdOnly')}</option>
                                        <option value="IQD">{t('form.iqdOnly')}</option>
                                        <option value="MIXED">{t('form.mixed')}</option>
                                    </select>
                                </div>

                                <div className={`${styles.paymentField} ${styles.entryModeField}`}>
                                    <label>{t('form.entryMode')} {isSameCurrencySelection && <span className={styles.lockedBadge}>{t('form.locked')}</span>}</label>
                                    <div className={`${styles.entryModeToggle} ${isSameCurrencySelection ? styles.entryModeDisabled : ''}`}>
                                        <span className={`${styles.toggleLabel} ${entryMode === 'amount' ? styles.toggleLabelActive : ''}`}>{t('form.amount')}</span>
                                        <label className={styles.entryModeSwitch} aria-label={t('form.entryModeAria')}>
                                            <input
                                                type="checkbox"
                                                checked={entryMode === 'cash'}
                                                onChange={(e) => handleEntryModeChange(e.target.checked ? 'cash' : 'amount')}
                                                disabled={isSameCurrencySelection}
                                            />
                                            <span className={styles.slider}></span>
                                        </label>
                                        <span className={`${styles.toggleLabel} ${entryMode === 'cash' ? styles.toggleLabelActive : ''}`}>{t('form.cash')}</span>
                                    </div>
                                </div>

                                <div className={styles.paymentField}>
                                    <label htmlFor="payment-date">{t('form.date')}</label>
                                    <input
                                        id="payment-date"
                                        type="date"
                                        name="paymentDate"
                                        min={ENTRY_DATE_MIN}
                                        value={form.paymentDate}
                                        onChange={handleInputChange}
                                        className={styles.inputCompact}
                                    />
                                </div>
                            </div>

                            {/* Row 2: Amount + Cash Received + Change */}
                            <div className={`${styles.paymentRowCompact} ${styles.paymentMainRow}`}>
                                {/* Amount to Register */}
                                <div className={`${styles.paymentField} ${styles.paymentFieldLg}`}>
                                    <label>
                                        {t('form.amountLabel', { currency: accountCurrency })}
                                        {entryMode === 'amount' && <span className={styles.required}>*</span>}
                                        {entryMode === 'cash' && <span className={styles.autoBadge}>{t('form.auto')}</span>}
                                    </label>
                                    <input
                                        type="text"
                                        inputMode="numeric"
                                        value={display.amountToRegister}
                                        onChange={(e) => handleMoneyInputChange('amountToRegister', e.target.value)}
                                        onFocus={handleMoneyInputFocus}
                                        readOnly={entryMode === 'cash'}
                                        placeholder={entryMode === 'cash' ? t('form.auto') : t('form.enterAmount')}
                                        className={`${styles.inputLg} ${entryMode === 'cash' ? styles.inputReadonly : ''}`}
                                    />
                                    {entryMode === 'amount' && remainingBalance > 0 && (
                                        <label className={styles.payFullBalanceCheck}>
                                            <input
                                                type="checkbox"
                                                checked={amountEqualsBalance}
                                                onChange={(e) => handlePayFullBalanceToggle(e.target.checked)}
                                            />
                                            <span>{t('form.payFullBalance', { amount: formatCurrency(remainingBalance, accountCurrency) })}</span>
                                        </label>
                                    )}
                                </div>

                                {/* Cash Received - Dynamic based on currency */}
                                {form.paymentCurrency !== 'MIXED' ? (
                                    <div className={`${styles.paymentField} ${styles.paymentFieldLg}`}>
                                        <label>
                                            {t('form.received', { currency: form.paymentCurrency })}
                                            {entryMode === 'cash' && <span className={styles.required}>*</span>}
                                            {entryMode === 'amount' && !form.cashOverrideEnabled && <span className={styles.autoBadge}>{t('form.auto')}</span>}
                                            {entryMode === 'amount' && form.cashOverrideEnabled && <span className={styles.overrideBadge}>{t('form.override')}</span>}
                                        </label>
                                        {form.paymentCurrency === 'USD' ? (
                                            /* USD field - check if cross-currency override is available */
                                            (() => {
                                                // Show lock icon only for: IQD account + USD payment + Amount mode
                                                const canOverride = accountCurrency === 'IQD' && entryMode === 'amount';
                                                const isLocked = canOverride && !form.cashOverrideEnabled;
                                                const isOverriding = canOverride && form.cashOverrideEnabled;

                                                return (
                                                    <div className={styles.inputWithLock}>
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={display.actualUSD}
                                                            onChange={(e) => isOverriding
                                                                ? handleOverrideUSDChange(e.target.value)
                                                                : handleMoneyInputChange('actualUSD', e.target.value)}
                                                            onFocus={handleMoneyInputFocus}
                                                            readOnly={isLocked}
                                                            placeholder={entryMode === 'cash' ? t('form.enterUsd') : (isOverriding ? t('form.enterBill') : t('form.auto'))}
                                                            className={`${styles.inputLg} ${isLocked ? styles.inputReadonly : ''}`}
                                                        />
                                                        {canOverride && (
                                                            <button
                                                                type="button"
                                                                className={`${styles.lockToggleBtn} ${isOverriding ? styles.unlocked : styles.locked}`}
                                                                onClick={handleCashOverrideToggle}
                                                                title={isOverriding ? t('form.lockAuto') : t('form.unlockBill')}
                                                            >
                                                                <i className={`fas fa-${isOverriding ? 'lock-open' : 'lock'}`}></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        ) : (
                                            /* IQD field - check if cross-currency override is available */
                                            (() => {
                                                // Show lock icon only for: USD account + IQD payment + Amount mode
                                                const canOverrideIQD = accountCurrency === 'USD' && entryMode === 'amount';
                                                const isLockedIQD = canOverrideIQD && !form.cashOverrideEnabled;

                                                return (
                                                    <div className={styles.inputWithLock}>
                                                        <input
                                                            type="text"
                                                            inputMode="numeric"
                                                            value={display.actualIQD}
                                                            onChange={(e) => handleMoneyInputChange('actualIQD', e.target.value)}
                                                            onFocus={handleMoneyInputFocus}
                                                            readOnly={isLockedIQD}
                                                            placeholder={entryMode === 'cash' ? t('form.enterIqd') : t('form.auto')}
                                                            className={`${styles.inputLg} ${isLockedIQD ? styles.inputReadonly : ''}`}
                                                        />
                                                        {canOverrideIQD && (
                                                            <button
                                                                type="button"
                                                                className={`${styles.lockToggleBtn} ${form.cashOverrideEnabled ? styles.unlocked : styles.locked}`}
                                                                onClick={handleCashOverrideToggle}
                                                                title={form.cashOverrideEnabled ? t('form.lockAuto') : t('form.unlockReceived')}
                                                            >
                                                                <i className={`fas fa-${form.cashOverrideEnabled ? 'lock-open' : 'lock'}`}></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        )}
                                        {/* Suggestion hint */}
                                        {entryMode === 'amount' && suggested.suggestedUSD > 0 && form.paymentCurrency === 'USD' && !form.cashOverrideEnabled && (
                                            <small className={styles.fieldHint}>{t('form.collectHint', { amount: formatNumber(suggested.suggestedUSD) })}</small>
                                        )}
                                        {entryMode === 'amount' && form.paymentCurrency === 'USD' && form.cashOverrideEnabled && (
                                            <small className={`${styles.fieldHint} ${styles.overrideHint}`}>{t('form.overrideHint')}</small>
                                        )}
                                        {entryMode === 'amount' && suggested.suggestedIQD > 0 && form.paymentCurrency === 'IQD' && (
                                            <small className={styles.fieldHint}>{t('form.collectHint', { amount: formatNumber(suggested.suggestedIQD) })}</small>
                                        )}
                                    </div>
                                ) : (
                                    /* Mixed Payment - Two smaller fields */
                                    <div className={styles.paymentFieldGroup}>
                                        <div className={styles.paymentField}>
                                            <label htmlFor="payment-usd-received">{t('form.usdReceived')}</label>
                                            <input
                                                id="payment-usd-received"
                                                type="text"
                                                inputMode="numeric"
                                                value={display.actualUSD}
                                                onChange={(e) => handleMoneyInputChange('actualUSD', e.target.value)}
                                                onFocus={handleMoneyInputFocus}
                                                placeholder="USD"
                                                className={styles.inputMd}
                                            />
                                        </div>
                                        <div className={styles.paymentField}>
                                            <label htmlFor="payment-iqd-received">{t('form.iqdReceived')}</label>
                                            <input
                                                id="payment-iqd-received"
                                                type="text"
                                                inputMode="numeric"
                                                value={display.actualIQD}
                                                onChange={(e) => handleMoneyInputChange('actualIQD', e.target.value)}
                                                onFocus={handleMoneyInputFocus}
                                                placeholder="IQD"
                                                className={styles.inputMd}
                                            />
                                        </div>
                                    </div>
                                )}

                                {/* Change Field */}
                                <div className={styles.paymentField}>
                                    <label>
                                        {t('form.change')}
                                        {isChangeDisabled && <span className={styles.naBadge}>{t('form.na')}</span>}
                                    </label>
                                    {isChangeDisabled ? (
                                        <input
                                            type="text"
                                            value={t('form.disabledDash')}
                                            disabled
                                            className={`${styles.inputCompact} ${styles.inputDisabled}`}
                                        />
                                    ) : (
                                        <input
                                            type="text"
                                            inputMode="numeric"
                                            value={display.change}
                                            onChange={(e) => handleChangeOverride(e.target.value)}
                                            onFocus={handleMoneyInputFocus}
                                            placeholder="0"
                                            className={styles.inputCompact}
                                        />
                                    )}
                                    {!isChangeDisabled && (totals?.calculatedChange ?? 0) > 0 && !form.changeManualOverride && (
                                        <small className={`${styles.fieldHint} ${styles.fieldHintSuccess}`}>{t('form.autoCalculated')}</small>
                                    )}
                                </div>
                            </div>

                            {/* Summary Strip - Only show when there's data */}
                            {(form.actualUSD || form.actualIQD) && (
                                <div className={`${styles.paymentSummaryStrip} ${isShort ? styles.summaryWarning : styles.summarySuccess}`}>
                                    <div className={styles.summaryItem}>
                                        <span className={styles.summaryLabel}>{t('summary.cashIn')}</span>
                                        <span className={styles.summaryValue}>
                                            {form.actualUSD ? `$${formatNumber(form.actualUSD)}` : ''}
                                            {form.actualUSD && form.actualIQD ? ' + ' : ''}
                                            {form.actualIQD ? `${formatNumber(form.actualIQD)} IQD` : ''}
                                        </span>
                                    </div>
                                    {!isChangeDisabled && form.change > 0 && (
                                        <div className={styles.summaryItem}>
                                            <span className={styles.summaryLabel}>{t('summary.changeOut')}</span>
                                            <span className={styles.summaryValue}>{formatNumber(form.change)} IQD</span>
                                        </div>
                                    )}
                                    <div className={`${styles.summaryItem} ${styles.summaryTotal}`}>
                                        <span className={styles.summaryLabel}>{t('summary.register')}</span>
                                        <span className={styles.summaryValue}>{formatCurrency(Number(form.amountToRegister) || 0, accountCurrency)}</span>
                                    </div>
                                    {isShort && (
                                        <div className={styles.summaryWarningText}>
                                            <i className="fas fa-exclamation-triangle"></i>
                                            {t('summary.shortBy', { amount: formatCurrency((parseFloat(String(form.amountToRegister)) || 0) - (totals?.totalReceived ?? 0), accountCurrency) })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Actions - Compact */}
                            <div className={styles.paymentActionsCompact}>
                                <button type="button" className={`btn ${styles.btnCancel}`} onClick={dismiss}>
                                    {t('actions.cancel')}
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={loading || (rateRequired && !exchangeRate)}>
                                    {loading ? (
                                        <><i className="fas fa-spinner fa-spin"></i> {t('actions.saving')}</>
                                    ) : (
                                        <><i className="fas fa-check"></i> {t('actions.savePayment')}</>
                                    )}
                                </button>
                            </div>
                        </form>
                    </>
                ) : (
                    /* Payment Success State - Compact */
                    <>
                        <ModalHeader
                            dense
                            variant="success"
                            titleId="payment-modal-title"
                            title={t('success.title')}
                            closeLabel={t('success.close')}
                            onClose={handleCloseAfterSuccess}
                        />
                        <div className={styles.paymentSuccessCompact}>
                        <div className={styles.successIcon}>
                            <i className="fas fa-check-circle"></i>
                        </div>
                        <p className={styles.successAmount}>
                            {formatCurrency(paidToday?.amount ?? 0, paidToday?.currency ?? accountCurrency)}
                        </p>
                        <div className={styles.successActions}>
                            <button onClick={handlePrint} className="btn btn-primary">
                                <i className="fas fa-print"></i> {t('success.printReceipt')}
                            </button>
                            <button onClick={handleCloseAfterSuccess} className="btn btn-secondary">
                                {t('success.done')}
                            </button>
                        </div>
                        </div>
                    </>
                ))}
        </Modal>
    );
};

export default PaymentModal;
