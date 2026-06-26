import React, { useState } from 'react';
import type { ChangeEvent, FormEvent, FocusEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApiResponse } from '@/types/api.types';
import styles from './PaymentModal.module.css';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import { parseFormattedNumber } from '../../utils/formatters';
import { formatISODate } from '../../core/utils';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import { qk } from '@/query/keys';
import { workForReceiptQuery, exchangeRateForDateQuery } from '@/query/queries';
import {
    updateExchangeRate as updateExchangeRateContract,
    addInvoice as addInvoiceContract,
    type AddInvoiceResponse,
} from '@shared/contracts/payment.contract';

// Types
interface WorkData {
    work_id: number;
    type_name?: string;
    total_required?: number;
    TotalPaid?: number;
    currency?: 'USD' | 'IQD';
    discount?: number | null;
    discount_date?: string | null;
    discount_reason?: string | null;
}

interface ReceiptData extends WorkData {
    amountPaidToday: number;
    paymentDate: string;
    paymentDateTime: string;
    usdReceived: number;
    iqdReceived: number;
    change: number;
    newBalance: number;
}

interface PaymentModalProps {
    workData: WorkData | null;
    onClose: () => void;
    onSuccess?: (result: ApiResponse) => void;
}

interface FormData {
    paymentDate: string;
    paymentCurrency: 'USD' | 'IQD' | 'MIXED';
    amountToRegister: number | string;
    actualUSD: number | string;
    actualIQD: number | string;
    change: number;
    changeManualOverride: boolean;
    cashOverrideEnabled: boolean;
}

interface DisplayValues {
    amountToRegister: string;
    actualUSD: string;
    actualIQD: string;
    change: string;
    newRateValue: string;
}

interface Calculations {
    accountCurrency: 'USD' | 'IQD';
    remainingBalance: number;
    suggestedUSD: number;
    suggestedIQD: number;
    calculatedChange: number;
    totalReceived: number;
    isShort: boolean;
    isExact: boolean;
    isOver: boolean;
}

type EntryMode = 'amount' | 'cash';

/**
 * Payment Modal Component
 * Memoized to prevent unnecessary re-renders
 * Re-renders only when workData, onClose, or onSuccess props change
 * Uses useCallback for event handlers to prevent breaking memoization
 */

// Pure display formatter — module-scoped so every reference (incl. the during-render
// display formatting below) is lexically after its declaration (react-hooks/immutability).
const formatNumber = (num: number | string | undefined): string => {
    const numVal = typeof num === 'string' ? parseFloat(num) : num;
    if (isNaN(numVal as number) || numVal === null || numVal === undefined) {
        return '0';
    }
    return Math.round(numVal as number).toLocaleString('en-US');
};

const PaymentModal = ({ workData, onClose, onSuccess }: PaymentModalProps) => {
    const { t } = useTranslation('payments');
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const [loading, setLoading] = useState(false);
    const [showRateInput, setShowRateInput] = useState(false);
    const [newRateValue, setNewRateValue] = useState('');
    const [paymentSuccess, setPaymentSuccess] = useState(false);
    const [receiptData, setReceiptData] = useState<ReceiptData | null>(null);

    // Entry mode: 'amount' = enter amount first (current), 'cash' = enter cash first (reverse)
    const [entryMode, setEntryMode] = useState<EntryMode>('amount');
    // Track if mode has been locked (after first input or manual toggle)
    const [modeLocked, setModeLocked] = useState(false);

    // Form state - numeric values for calculations
    const [formData, setFormData] = useState<FormData>({
        paymentDate: formatISODate(),
        paymentCurrency: 'IQD', // 'USD', 'IQD', 'MIXED'
        amountToRegister: '', // Amount in account currency
        actualUSD: '',
        actualIQD: '',
        change: 0,
        changeManualOverride: false,
        cashOverrideEnabled: false // For USD override in IQD account + Amount mode
    });

    // Display state - formatted strings for display
    const [displayValues, setDisplayValues] = useState<DisplayValues>({
        amountToRegister: '',
        actualUSD: '',
        actualIQD: '',
        change: '',
        newRateValue: ''
    });

    // Calculations and suggestions
    const [calculations, setCalculations] = useState<Calculations>({
        accountCurrency: 'IQD',
        remainingBalance: 0,
        suggestedUSD: 0,
        suggestedIQD: 0,
        calculatedChange: 0,
        totalReceived: 0,
        isShort: false,
        isExact: false,
        isOver: false
    });

    // Receipt-enriched work row + the exchange rate for the payment date, both on
    // useQuery. The contract response is a loose boundary guard (work_id); the richer
    // local WorkData stays the consumer type. The rate's expected 404 ("no rate set")
    // surfaces as `isError`, which drives the inline "Set Rate" prompt — no throw.
    const { data: completeWorkDataRaw } = useQuery(workForReceiptQuery(workData?.work_id ?? null));
    const completeWorkData = (completeWorkDataRaw ?? null) as WorkData | null;

    const {
        data: rateData,
        isError: rateIsError,
    } = useQuery(exchangeRateForDateQuery(formData.paymentDate));
    const exchangeRate = rateData?.exchangeRate ?? null;
    const exchangeRateError = rateIsError || (!!rateData && !rateData.exchangeRate);

    // The form/balance seed + the two recalculations below were setState-in-effect
    // cascades; they are now keyed adjust-during-render blocks (matching the display
    // formatting + rate blocks further down). Each runs the same logic on the same
    // inputs, but during render — so there is no setState-in-effect / immutability,
    // and React Compiler can optimise. The blocks form an acyclic cascade
    // (seed → suggested cash → total/change), each writing only state outside its
    // own key, so they converge in a couple of render passes.

    // Seed form + balance from the work when the modal opens or the work changes.
    const [seededInit, setSeededInit] = useState<{ work: WorkData | null; success: boolean }>({ work: null, success: false });
    if (seededInit.work !== workData || seededInit.success !== paymentSuccess) {
        setSeededInit({ work: workData, success: paymentSuccess });
        // Only initialize form data if not in payment success mode
        if (workData && !paymentSuccess) {
            const remainingBalance = (workData.total_required || 0) - Number(workData.discount ?? 0) - (workData.TotalPaid || 0);
            const accountCurrency = workData.currency || 'IQD';
            setCalculations(prev => ({ ...prev, accountCurrency: accountCurrency, remainingBalance: remainingBalance }));
            setFormData(prev => ({ ...prev, paymentCurrency: accountCurrency, amountToRegister: '' }));
        }
    }

    // Recalculate suggested cash when payment currency or amount changes, or when
    // switching to amount mode.
    const suggestKey = `${formData.amountToRegister}|${formData.paymentCurrency}|${exchangeRate}|${entryMode}|${calculations.accountCurrency}`;
    const [seededSuggestKey, setSeededSuggestKey] = useState<string | null>(null);
    if (suggestKey !== seededSuggestKey) {
        setSeededSuggestKey(suggestKey);
        if (entryMode === 'amount' && formData.amountToRegister && exchangeRate) {
            const amountToRegister = parseFloat(String(formData.amountToRegister)) || 0;
            const accountCurrency = calculations.accountCurrency;
            const paymentCurrency = formData.paymentCurrency;

            if (paymentCurrency === 'MIXED') {
                // For mixed, no suggestion - user must enter manually
                setCalculations(prev => ({ ...prev, suggestedUSD: 0, suggestedIQD: 0 }));
            } else {
                // Single currency payment
                let suggestedUSD = 0;
                let suggestedIQD = 0;

                if (paymentCurrency === 'USD') {
                    if (accountCurrency === 'USD') {
                        suggestedUSD = amountToRegister;
                    } else {
                        // Account is IQD, paying in USD - Round UP to collect more
                        suggestedUSD = Math.ceil(amountToRegister / exchangeRate);
                    }
                } else if (paymentCurrency === 'IQD') {
                    if (accountCurrency === 'IQD') {
                        suggestedIQD = amountToRegister;
                    } else {
                        // Account is USD, paying in IQD - Round UP to nearest 1000 to collect more
                        suggestedIQD = Math.ceil(amountToRegister * exchangeRate / 1000) * 1000;
                    }
                }

                // Auto-fill suggested amounts ONLY if cash override is not enabled
                if (!formData.cashOverrideEnabled) {
                    setFormData(prev => ({ ...prev, actualUSD: suggestedUSD || '', actualIQD: suggestedIQD || '' }));
                }

                setCalculations(prev => ({ ...prev, suggestedUSD, suggestedIQD }));
            }
        }
    }

    // Recalculate total + change when actual cash amounts change.
    const totalKey = `${formData.actualUSD}|${formData.actualIQD}|${formData.amountToRegister}|${exchangeRate}|${calculations.accountCurrency}`;
    const [seededTotalKey, setSeededTotalKey] = useState<string | null>(null);
    if (totalKey !== seededTotalKey) {
        setSeededTotalKey(totalKey);
        if (exchangeRate) {
            const actualUSD = parseFloat(String(formData.actualUSD)) || 0;
            const actualIQD = parseFloat(String(formData.actualIQD)) || 0;
            const amountToRegister = parseFloat(String(formData.amountToRegister)) || 0;
            const accountCurrency = calculations.accountCurrency;

            // Convert total received to account currency - Round DOWN what patient gave (you benefit)
            let totalInAccountCurrency: number;
            if (accountCurrency === 'USD') {
                // Patient gave IQD, convert to USD - Round DOWN
                const iqdValueInUSD = Math.floor(actualIQD / exchangeRate);
                totalInAccountCurrency = actualUSD + iqdValueInUSD;
            } else {
                // Patient gave USD, convert to IQD - Round DOWN to nearest 1000
                const usdValueInIQD = Math.floor(actualUSD * exchangeRate / 1000) * 1000;
                totalInAccountCurrency = usdValueInIQD + actualIQD;
            }

            // Calculate overpayment
            const overpayment = totalInAccountCurrency - amountToRegister;

            // Convert overpayment to IQD (change always in IQD) - Round DOWN to nearest 1000 (you give less)
            let changeInIQD = 0;
            if (overpayment > 0) {
                if (accountCurrency === 'USD') {
                    changeInIQD = Math.floor(overpayment * exchangeRate / 1000) * 1000;
                } else {
                    changeInIQD = Math.floor(overpayment / 1000) * 1000;
                }
            }

            // Update change only if not manually overridden
            if (!formData.changeManualOverride) {
                setFormData(prev => ({ ...prev, change: changeInIQD }));
            }

            setCalculations(prev => ({
                ...prev,
                totalReceived: Math.round(totalInAccountCurrency),
                calculatedChange: changeInIQD,
                isShort: totalInAccountCurrency < amountToRegister,
                isExact: Math.abs(totalInAccountCurrency - amountToRegister) < 0.01,
                isOver: totalInAccountCurrency > amountToRegister
            }));
        }
    }

    // Auto-format display values when formData changes (handles auto-population) —
    // done during render (keyed on the formatted fields) so there's no
    // setState-in-effect. Mirrors the prior effect exactly.
    const fmtKey = `${formData.amountToRegister}|${formData.actualUSD}|${formData.actualIQD}|${formData.change}`;
    const [seededFmtKey, setSeededFmtKey] = useState<string | null>(null);
    if (fmtKey !== seededFmtKey) {
        setSeededFmtKey(fmtKey);
        setDisplayValues(prev => ({
            ...prev,
            amountToRegister: formatNumber(formData.amountToRegister),
            actualUSD: formatNumber(formData.actualUSD),
            actualIQD: formatNumber(formData.actualIQD),
            change: formatNumber(formData.change)
        }));
    }

    // Auto-format exchange rate input.
    const [seededRateValue, setSeededRateValue] = useState<string | null>(null);
    if (newRateValue !== seededRateValue) {
        setSeededRateValue(newRateValue);
        setDisplayValues(prev => ({
            ...prev,
            newRateValue: formatNumber(newRateValue)
        }));
    }

    const handleSetExchangeRate = async () => {
        const rate = parseFormattedNumber(newRateValue);
        if (!rate || rate <= 0) {
            toast.warning(t('validation.enterValidRate'));
            return;
        }

        try {
            setLoading(true);
            // Enveloped (sendSuccess); a non-2xx now throws and is handled below.
            await postJSON('/api/updateExchangeRateForDate', {
                date: formData.paymentDate,
                exchangeRate: Math.round(rate)
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

    // Reverse mode: Calculate amount to register from cash received when in cash entry mode.
    // Uses same "benefit from conversion" rounding - round DOWN what patient gave. Keyed
    // adjust-during-render (not an effect); entryMode gates it so it never competes with
    // the amount-mode suggested-cash block above (the two are entry-mode-exclusive).
    const reverseKey = `${formData.actualUSD}|${formData.actualIQD}|${entryMode}|${exchangeRate}|${calculations.accountCurrency}`;
    const [seededReverseKey, setSeededReverseKey] = useState<string | null>(null);
    if (reverseKey !== seededReverseKey) {
        setSeededReverseKey(reverseKey);
        if (entryMode === 'cash' && exchangeRate) {
            const actualUSD = parseFloat(String(formData.actualUSD)) || 0;
            const actualIQD = parseFloat(String(formData.actualIQD)) || 0;
            const accountCurrency = calculations.accountCurrency;

            if (actualUSD === 0 && actualIQD === 0) {
                setFormData(prev => ({ ...prev, amountToRegister: '' }));
            } else {
                let amountToRegister: number;
                if (accountCurrency === 'USD') {
                    const iqdValueInUSD = Math.floor(actualIQD / exchangeRate);
                    amountToRegister = actualUSD + iqdValueInUSD;
                } else {
                    const usdValueInIQD = Math.floor(actualUSD * exchangeRate / 1000) * 1000;
                    amountToRegister = usdValueInIQD + actualIQD;
                }

                setFormData(prev => ({ ...prev, amountToRegister: amountToRegister }));
            }
        }
    }

    // Smart calculation for mixed payments
    const handleMixedUSDChange = (value: string) => {
        const usd = parseFormattedNumber(value) || 0;

        // Auto-detect mode for mixed payments (only if not locked)
        if (!modeLocked && usd > 0 && !formData.amountToRegister) {
            setEntryMode('cash');
            setModeLocked(true);
        }

        setFormData(prev => ({ ...prev, actualUSD: usd }));
        setDisplayValues(prev => ({ ...prev, actualUSD: value }));

        // Only calculate suggestions in amount mode
        if (entryMode === 'amount' && usd > 0 && !formData.actualIQD && exchangeRate) {
            // Calculate remaining IQD needed
            const amountToRegister = parseFloat(String(formData.amountToRegister)) || 0;
            const accountCurrency = calculations.accountCurrency;

            // Round DOWN what patient gave (you benefit)
            const usdValueInAccount = accountCurrency === 'USD'
                ? usd
                : Math.floor(usd * exchangeRate / 1000) * 1000;
            const remainingInAccount = amountToRegister - usdValueInAccount;

            if (remainingInAccount > 0) {
                // Round UP what patient owes (you benefit)
                const neededIQD = accountCurrency === 'USD'
                    ? Math.ceil(remainingInAccount * exchangeRate / 1000) * 1000
                    : Math.ceil(remainingInAccount / 1000) * 1000;

                setCalculations(prev => ({
                    ...prev,
                    suggestedIQD: neededIQD
                }));
            }
        }
    };

    const handleMixedIQDChange = (value: string) => {
        const iqd = parseFormattedNumber(value) || 0;

        // Auto-detect mode for mixed payments (only if not locked)
        if (!modeLocked && iqd > 0 && !formData.amountToRegister) {
            setEntryMode('cash');
            setModeLocked(true);
        }

        setFormData(prev => ({ ...prev, actualIQD: iqd }));
        setDisplayValues(prev => ({ ...prev, actualIQD: value }));

        // Only calculate suggestions in amount mode
        if (entryMode === 'amount' && iqd > 0 && !formData.actualUSD && exchangeRate) {
            // Calculate remaining USD needed
            const amountToRegister = parseFloat(String(formData.amountToRegister)) || 0;
            const accountCurrency = calculations.accountCurrency;

            // Round DOWN what patient gave (you benefit)
            const iqdValueInAccount = accountCurrency === 'IQD'
                ? iqd
                : Math.floor(iqd / exchangeRate);
            const remainingInAccount = amountToRegister - iqdValueInAccount;

            if (remainingInAccount > 0) {
                // Round UP what patient owes (you benefit)
                const neededUSD = accountCurrency === 'IQD'
                    ? Math.ceil(remainingInAccount / exchangeRate)
                    : Math.ceil(remainingInAccount);

                setCalculations(prev => ({
                    ...prev,
                    suggestedUSD: neededUSD
                }));
            }
        }
    };

    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;

        // When changing payment currency, clear the irrelevant cash field and reset override
        if (name === 'paymentCurrency') {
            // Check if switching to same-currency (need to force amount mode)
            const willBeSameCurrency =
                (calculations.accountCurrency === 'USD' && value === 'USD') ||
                (calculations.accountCurrency === 'IQD' && value === 'IQD');

            if (value === 'USD') {
                // Switching to USD only - clear IQD, reset override
                setFormData(prev => ({ ...prev, paymentCurrency: value as 'USD', actualIQD: '', cashOverrideEnabled: false }));
                setDisplayValues(prev => ({ ...prev, actualIQD: '' }));
            } else if (value === 'IQD') {
                // Switching to IQD only - clear USD, reset override
                setFormData(prev => ({ ...prev, paymentCurrency: value as 'IQD', actualUSD: '', cashOverrideEnabled: false }));
                setDisplayValues(prev => ({ ...prev, actualUSD: '' }));
            } else {
                // For MIXED, keep both values but reset override
                setFormData(prev => ({ ...prev, paymentCurrency: value as 'MIXED', cashOverrideEnabled: false }));
            }

            // Force amount mode for same-currency payments (cash mode doesn't make sense)
            if (willBeSameCurrency && entryMode === 'cash') {
                setEntryMode('amount');
                setModeLocked(false); // Allow re-detection on next input
            }
            return;
        }

        setFormData(prev => ({
            ...prev,
            [name]: value
        }));
    };

    // Handle formatted money input changes with auto-detect mode (only before mode is locked)
    const handleMoneyInputChange = (fieldName: keyof FormData, value: string) => {
        // Parse the formatted input
        const numericValue = parseFormattedNumber(value);

        // Auto-detect entry mode ONLY if mode is not locked yet
        if (!modeLocked && numericValue && numericValue > 0) {
            if (fieldName === 'amountToRegister') {
                // User typed in amount field first - lock to amount mode
                setEntryMode('amount');
                setModeLocked(true);
            } else if ((fieldName === 'actualUSD' || fieldName === 'actualIQD') && !formData.amountToRegister) {
                // User typed in cash field first (with empty amount) - lock to cash mode
                setEntryMode('cash');
                setModeLocked(true);
            }
        }

        // Update formData with numeric value for calculations
        setFormData(prev => ({
            ...prev,
            [fieldName]: numericValue
        }));

        // Update display value immediately (user is typing)
        setDisplayValues(prev => ({
            ...prev,
            [fieldName]: value
        }));
    };

    // Handle blur - ensure proper formatting
    const handleMoneyInputBlur = (fieldName: keyof FormData) => {
        const numericValue = formData[fieldName];
        // Only format if the value is a number or string (not boolean)
        if (typeof numericValue === 'number' || typeof numericValue === 'string') {
            const formatted = formatNumber(numericValue);
            setDisplayValues(prev => ({
                ...prev,
                [fieldName]: formatted
            }));
        }
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
        // Lock to amount mode so the value isn't recomputed from cash
        setModeLocked(true);
        if (entryMode !== 'amount') setEntryMode('amount');

        if (checked && calculations.remainingBalance > 0) {
            setFormData(prev => ({ ...prev, amountToRegister: calculations.remainingBalance }));
        } else {
            setFormData(prev => ({ ...prev, amountToRegister: '' }));
        }
    };

    const handleChangeOverride = (value: string) => {
        const numericValue = parseFormattedNumber(value) || 0;
        setFormData(prev => ({
            ...prev,
            change: numericValue,
            changeManualOverride: true
        }));
        setDisplayValues(prev => ({
            ...prev,
            change: value
        }));
    };

    // Toggle cash override mode (for USD bill override in IQD account + Amount mode)
    const handleCashOverrideToggle = () => {
        setFormData(prev => ({
            ...prev,
            cashOverrideEnabled: !prev.cashOverrideEnabled
        }));
    };

    // Handle USD input when in override mode - recalculates IQD change
    const handleOverrideUSDChange = (value: string) => {
        const usd = parseFormattedNumber(value) || 0;

        setFormData(prev => ({ ...prev, actualUSD: usd }));
        setDisplayValues(prev => ({ ...prev, actualUSD: value }));

        // Change will be auto-calculated by the total/change render block
    };

    // Handle entry mode toggle change (always locks mode after manual toggle)
    const handleEntryModeChange = (newMode: EntryMode) => {
        if (newMode === entryMode) return;

        // Lock mode after manual toggle
        setModeLocked(true);

        if (newMode === 'cash') {
            // Switching to cash mode
            // Clear amount (auto-calculated in cash mode), keep cash values
            // the reverse-mode render block will recalculate amount from cash
            setFormData(prev => ({
                ...prev,
                amountToRegister: '',
                change: 0,
                changeManualOverride: false,
                cashOverrideEnabled: false // Reset override when switching modes
            }));
            setDisplayValues(prev => ({
                ...prev,
                amountToRegister: '',
                change: ''
            }));
            setEntryMode(newMode);
        } else {
            // Switching to amount mode
            // Clear cash (auto-calculated in amount mode), keep amount value
            // the suggested-cash render block will recalculate cash from amount
            setFormData(prev => ({
                ...prev,
                actualUSD: '',
                actualIQD: '',
                change: 0,
                changeManualOverride: false,
                cashOverrideEnabled: false // Reset override when switching modes
            }));
            setDisplayValues(prev => ({
                ...prev,
                actualUSD: '',
                actualIQD: '',
                change: ''
            }));
            setEntryMode(newMode);
        }
    };

    const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        const actualUSD = parseInt(String(formData.actualUSD)) || 0;
        const actualIQD = parseInt(String(formData.actualIQD)) || 0;
        const amountPaid = parseInt(String(formData.amountToRegister)) || 0;

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

        if (calculations.remainingBalance > 0 && amountPaid > calculations.remainingBalance) {
            toast.error(t('validation.exceedsBalance', { balance: formatCurrency(calculations.remainingBalance, calculations.accountCurrency) }));
            return;
        }

        if (calculations.isShort) {
            if (!await confirm(t('confirm.underpaymentMessage'), { title: t('confirm.underpaymentTitle'), confirmText: t('confirm.underpaymentConfirm') })) return;
        }

        // Scenarios where change is not tracked (NULL):
        // 1. Cash mode: registering exactly what was given, no target amount
        // 2. IQD-to-IQD: same-currency, exact payments expected
        // 3. USD account + IQD payment: auto-calculated, no change needed
        // USD-to-USD in amount mode DOES track change (converted to IQD) because clinic uses $50/$100 bills
        const shouldDisableChange =
            entryMode === 'cash' ||
            (calculations.accountCurrency === 'IQD' && actualIQD > 0 && actualUSD === 0) ||
            (calculations.accountCurrency === 'USD' && actualIQD > 0 && actualUSD === 0);

        // For disabled scenarios: Force change to NULL
        // For all other scenarios: Use the change value (can be 0 or positive)
        const changeToSubmit = shouldDisableChange ? null : (parseInt(String(formData.change)) || 0);

        // Validate cross-currency change doesn't exceed received amounts
        if (!shouldDisableChange && changeToSubmit !== null && changeToSubmit > 0) {
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
                paymentDate: formData.paymentDate,
                usdReceived: actualUSD,
                iqdReceived: actualIQD,
                change: changeToSubmit  // NULL for same-currency, number for cross-currency
            };

            // Enveloped (sendSuccess) → postJSON unwraps to the inner result; a non-2xx
            // (validation/insufficient-balance) now throws and is handled in the catch.
            const result = await postJSON<AddInvoiceResponse>('/api/addInvoice', invoiceData, {
                schema: addInvoiceContract.response,
            });
            queryClient.invalidateQueries({ queryKey: qk.work.all(workData!.work_id) });

            // Set success state and prepare receipt data with complete work data
            setPaymentSuccess(true);
            setReceiptData({
                ...workData!,
                // Override with complete data from V_Report if available
                ...(completeWorkData || {}),
                amountPaidToday: amountPaid,
                paymentDate: formData.paymentDate,
                paymentDateTime: new Date().toISOString(),
                usdReceived: actualUSD,
                iqdReceived: actualIQD,
                change: parseInt(String(formData.change)) || 0,
                newBalance: ((workData!.total_required || 0) - Number(workData!.discount ?? 0) - (workData!.TotalPaid || 0) - amountPaid)
            });

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

            if (onSuccess) {
                // postJSON unwrapped the envelope; reconstruct an ApiResponse for the
                // (arg-ignoring) consumer so the prop type is honoured. `timestamp` is
                // required on the shared type (H4), so stamp one on the shim.
                onSuccess({ success: true, data: result, timestamp: new Date().toISOString() });
            }
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
        setReceiptData(null);
        onClose();
    };

    const formatCurrency = (amount: number | string | undefined, currency: string): string => {
        const numAmount = typeof amount === 'string' ? parseFloat(amount) : amount;
        if (isNaN(numAmount as number) || numAmount === null || numAmount === undefined) {
            return `0 ${currency}`;
        }
        // Use toLocaleString with 'en-US' for comma separators
        return `${Math.round(numAmount as number).toLocaleString('en-US')} ${currency}`;
    };

    if (!workData) return null;

    // Whether the amount field currently equals the full remaining balance
    // (drives the "Pay full balance" checkbox; auto-unticks when the user edits the amount)
    const amountEqualsBalance =
        calculations.remainingBalance > 0 &&
        (parseFloat(String(formData.amountToRegister)) || 0) === Math.round(calculations.remainingBalance);

    // Detect same-currency selection (for entry mode locking)
    // Cash mode doesn't make sense for same-currency - can't derive "amount owed" from "cash received"
    const isSameCurrencySelection =
        (calculations.accountCurrency === 'USD' && formData.paymentCurrency === 'USD') ||
        (calculations.accountCurrency === 'IQD' && formData.paymentCurrency === 'IQD');

    // Detect same-currency payment for change tracking (only IQD-to-IQD)
    // USD-to-USD tracks change as IQD because clinic uses $50/$100 bills
    const isSameCurrencyPayment =
        calculations.accountCurrency === 'IQD' && formData.paymentCurrency === 'IQD';

    // Disable change field for:
    // 1. Cash mode (registering exactly what was given, no target amount)
    // 2. IQD-to-IQD same currency (exact payments expected)
    // 3. USD account + IQD payment in amount mode (auto-calculated, no change needed)
    const isChangeDisabled =
        entryMode === 'cash' ||
        isSameCurrencyPayment ||
        (calculations.accountCurrency === 'USD' && formData.paymentCurrency === 'IQD');

    return (
        <Modal
            isOpen={true}
            onClose={paymentSuccess ? handleCloseAfterSuccess : onClose}
            contentClassName={`${styles.modalContent} ${styles.invoiceModal} ${styles.paymentModalCompact}`}
        >
                {!paymentSuccess ? (
                    <>
                        {/* Compact Header with Balance Info */}
                        <ModalHeader
                            dense
                            title={t('modal.title')}
                            icon={<i className="fas fa-credit-card" />}
                            subtitle={workData.type_name || t('modal.workFallback', { id: workData.work_id })}
                            onClose={onClose}
                            actions={
                                <div className={styles.paymentBalanceBadge}>
                                    <span className={styles.balanceLabel}>{t('balance.label')}</span>
                                    <span className={styles.balanceAmount}>{formatCurrency(calculations.remainingBalance, calculations.accountCurrency)}</span>
                                    {Number(workData.discount ?? 0) > 0 && (
                                        <span className={`${styles.balanceLabel} ${styles.discountNote}`}>
                                            <i className="fas fa-tag"></i> {formatCurrency(Number(workData.discount), calculations.accountCurrency)} {t('balance.discountApplied')}
                                        </span>
                                    )}
                                </div>
                            }
                        />

                        {/* Exchange Rate - Compact Inline */}
                        {exchangeRateError && !exchangeRate ? (
                            <div className={styles.exchangeRateErrorCompact}>
                                <i className="fas fa-exclamation-triangle"></i>
                                <span>{t('exchangeRate.noRate', { date: formData.paymentDate })}</span>
                                {!showRateInput ? (
                                    <button type="button" onClick={() => setShowRateInput(true)} className={styles.btnLink}>
                                        {t('exchangeRate.setRate')}
                                    </button>
                                ) : (
                                    <div className={styles.rateInputInline}>
                                        <input
                                            type="text"
                                            value={displayValues.newRateValue}
                                            onChange={(e) => {
                                                setNewRateValue(e.target.value);
                                                setDisplayValues(prev => ({ ...prev, newRateValue: e.target.value }));
                                            }}
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
                                )}
                            </div>
                        ) : exchangeRate ? (
                            <div className={styles.exchangeRateCompact}>
                                <i className="fas fa-exchange-alt"></i>
                                <span>{t('exchangeRate.display', { rate: formatNumber(exchangeRate) })}</span>
                                <span className={styles.rateDate}>({formData.paymentDate})</span>
                            </div>
                        ) : null}

                        <form onSubmit={handleSubmit} className={`${styles.invoiceForm} ${styles.paymentFormCompact}`}>
                            {/* Row 1: Currency + Entry Mode + Date */}
                            <div className={styles.paymentRowCompact}>
                                <div className={styles.paymentField}>
                                    <label htmlFor="payment-currency">{t('form.currency')}</label>
                                    <select
                                        id="payment-currency"
                                        name="paymentCurrency"
                                        value={formData.paymentCurrency}
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
                                        value={formData.paymentDate}
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
                                        {t('form.amountLabel', { currency: calculations.accountCurrency })}
                                        {entryMode === 'amount' && <span className={styles.required}>*</span>}
                                        {entryMode === 'cash' && <span className={styles.autoBadge}>{t('form.auto')}</span>}
                                    </label>
                                    <input
                                        type="text"
                                        value={displayValues.amountToRegister}
                                        onChange={(e) => handleMoneyInputChange('amountToRegister', e.target.value)}
                                        onBlur={() => handleMoneyInputBlur('amountToRegister')}
                                        onFocus={handleMoneyInputFocus}
                                        readOnly={entryMode === 'cash'}
                                        placeholder={entryMode === 'cash' ? t('form.auto') : t('form.enterAmount')}
                                        className={`${styles.inputLg} ${entryMode === 'cash' ? styles.inputReadonly : ''}`}
                                    />
                                    {entryMode === 'amount' && calculations.remainingBalance > 0 && (
                                        <label className={styles.payFullBalanceCheck}>
                                            <input
                                                type="checkbox"
                                                checked={amountEqualsBalance}
                                                onChange={(e) => handlePayFullBalanceToggle(e.target.checked)}
                                            />
                                            <span>{t('form.payFullBalance', { amount: formatCurrency(calculations.remainingBalance, calculations.accountCurrency) })}</span>
                                        </label>
                                    )}
                                </div>

                                {/* Cash Received - Dynamic based on currency */}
                                {formData.paymentCurrency !== 'MIXED' ? (
                                    <div className={`${styles.paymentField} ${styles.paymentFieldLg}`}>
                                        <label>
                                            {t('form.received', { currency: formData.paymentCurrency })}
                                            {entryMode === 'cash' && <span className={styles.required}>*</span>}
                                            {entryMode === 'amount' && !formData.cashOverrideEnabled && <span className={styles.autoBadge}>{t('form.auto')}</span>}
                                            {entryMode === 'amount' && formData.cashOverrideEnabled && <span className={styles.overrideBadge}>{t('form.override')}</span>}
                                        </label>
                                        {formData.paymentCurrency === 'USD' ? (
                                            /* USD field - check if cross-currency override is available */
                                            (() => {
                                                // Show lock icon only for: IQD account + USD payment + Amount mode
                                                const canOverride = calculations.accountCurrency === 'IQD' && entryMode === 'amount';
                                                const isLocked = canOverride && !formData.cashOverrideEnabled;
                                                const isOverriding = canOverride && formData.cashOverrideEnabled;

                                                return (
                                                    <div className={styles.inputWithLock}>
                                                        <input
                                                            type="text"
                                                            value={displayValues.actualUSD}
                                                            onChange={(e) => isOverriding
                                                                ? handleOverrideUSDChange(e.target.value)
                                                                : handleMoneyInputChange('actualUSD', e.target.value)}
                                                            onBlur={() => handleMoneyInputBlur('actualUSD')}
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
                                                const canOverrideIQD = calculations.accountCurrency === 'USD' && entryMode === 'amount';
                                                const isLockedIQD = canOverrideIQD && !formData.cashOverrideEnabled;

                                                return (
                                                    <div className={styles.inputWithLock}>
                                                        <input
                                                            type="text"
                                                            value={displayValues.actualIQD}
                                                            onChange={(e) => handleMoneyInputChange('actualIQD', e.target.value)}
                                                            onBlur={() => handleMoneyInputBlur('actualIQD')}
                                                            onFocus={handleMoneyInputFocus}
                                                            readOnly={isLockedIQD}
                                                            placeholder={entryMode === 'cash' ? t('form.enterIqd') : t('form.auto')}
                                                            className={`${styles.inputLg} ${isLockedIQD ? styles.inputReadonly : ''}`}
                                                        />
                                                        {canOverrideIQD && (
                                                            <button
                                                                type="button"
                                                                className={`${styles.lockToggleBtn} ${formData.cashOverrideEnabled ? styles.unlocked : styles.locked}`}
                                                                onClick={handleCashOverrideToggle}
                                                                title={formData.cashOverrideEnabled ? t('form.lockAuto') : t('form.unlockReceived')}
                                                            >
                                                                <i className={`fas fa-${formData.cashOverrideEnabled ? 'lock-open' : 'lock'}`}></i>
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        )}
                                        {/* Suggestion hint */}
                                        {entryMode === 'amount' && calculations.suggestedUSD > 0 && formData.paymentCurrency === 'USD' && !formData.cashOverrideEnabled && (
                                            <small className={styles.fieldHint}>{t('form.collectHint', { amount: formatNumber(calculations.suggestedUSD) })}</small>
                                        )}
                                        {entryMode === 'amount' && formData.paymentCurrency === 'USD' && formData.cashOverrideEnabled && (
                                            <small className={`${styles.fieldHint} ${styles.overrideHint}`}>{t('form.overrideHint')}</small>
                                        )}
                                        {entryMode === 'amount' && calculations.suggestedIQD > 0 && formData.paymentCurrency === 'IQD' && (
                                            <small className={styles.fieldHint}>{t('form.collectHint', { amount: formatNumber(calculations.suggestedIQD) })}</small>
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
                                                value={displayValues.actualUSD}
                                                onChange={(e) => handleMixedUSDChange(e.target.value)}
                                                onBlur={() => handleMoneyInputBlur('actualUSD')}
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
                                                value={displayValues.actualIQD}
                                                onChange={(e) => handleMixedIQDChange(e.target.value)}
                                                onBlur={() => handleMoneyInputBlur('actualIQD')}
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
                                            value={displayValues.change}
                                            onChange={(e) => handleChangeOverride(e.target.value)}
                                            onBlur={() => handleMoneyInputBlur('change')}
                                            onFocus={handleMoneyInputFocus}
                                            placeholder="0"
                                            className={styles.inputCompact}
                                        />
                                    )}
                                    {!isChangeDisabled && calculations.calculatedChange > 0 && !formData.changeManualOverride && (
                                        <small className={`${styles.fieldHint} ${styles.fieldHintSuccess}`}>{t('form.autoCalculated')}</small>
                                    )}
                                </div>
                            </div>

                            {/* Summary Strip - Only show when there's data */}
                            {(formData.actualUSD || formData.actualIQD) && (
                                <div className={`${styles.paymentSummaryStrip} ${calculations.isShort ? styles.summaryWarning : styles.summarySuccess}`}>
                                    <div className={styles.summaryItem}>
                                        <span className={styles.summaryLabel}>{t('summary.cashIn')}</span>
                                        <span className={styles.summaryValue}>
                                            {formData.actualUSD ? `$${formatNumber(formData.actualUSD)}` : ''}
                                            {formData.actualUSD && formData.actualIQD ? ' + ' : ''}
                                            {formData.actualIQD ? `${formatNumber(formData.actualIQD)} IQD` : ''}
                                        </span>
                                    </div>
                                    {!isChangeDisabled && formData.change > 0 && (
                                        <div className={styles.summaryItem}>
                                            <span className={styles.summaryLabel}>{t('summary.changeOut')}</span>
                                            <span className={styles.summaryValue}>{formatNumber(formData.change)} IQD</span>
                                        </div>
                                    )}
                                    <div className={`${styles.summaryItem} ${styles.summaryTotal}`}>
                                        <span className={styles.summaryLabel}>{t('summary.register')}</span>
                                        <span className={styles.summaryValue}>{formatCurrency(formData.amountToRegister || 0, calculations.accountCurrency)}</span>
                                    </div>
                                    {calculations.isShort && (
                                        <div className={styles.summaryWarningText}>
                                            <i className="fas fa-exclamation-triangle"></i>
                                            {t('summary.shortBy', { amount: formatCurrency((parseFloat(String(formData.amountToRegister)) || 0) - calculations.totalReceived, calculations.accountCurrency) })}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Actions - Compact */}
                            <div className={styles.paymentActionsCompact}>
                                <button type="button" className="btn btn-secondary" onClick={onClose}>
                                    {t('actions.cancel')}
                                </button>
                                <button type="submit" className="btn btn-primary" disabled={loading || !exchangeRate}>
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
                        <button className={styles.modalClose} onClick={handleCloseAfterSuccess} aria-label={t('success.close')}>{t('actions.closeX')}</button>
                        <div className={styles.paymentSuccessCompact}>
                        <div className={styles.successIcon}>
                            <i className="fas fa-check-circle"></i>
                        </div>
                        <h2>{t('success.title')}</h2>
                        <p className={styles.successAmount}>
                            {formatCurrency(receiptData?.amountPaidToday || 0, receiptData?.currency || 'IQD')}
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
                )}
        </Modal>
    );
};

export default PaymentModal;
