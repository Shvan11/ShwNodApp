/**
 * Centralized API contract types for the staff and patient-portal frontends.
 *
 * Imported as: `import type { ... } from '@/types/api.types';`
 *
 * Aligner-specific types live in `pages/aligner/aligner.types.ts` and are
 * not re-exported from here.
 */

// =============================================================================
// GENERIC RESPONSE WRAPPERS
// =============================================================================

/**
 * Status-string convention used by older /api/payment, /api/exchangeRate, and
 * /api/templates endpoints. Prefer ApiResponse<T> in new code.
 */
export interface ApiResult {
    status: 'success' | 'error';
    message?: string;
}

/**
 * Status-convention with a typed data payload. Used by /api/templates endpoints.
 * For the boolean-success variant, use ApiResponse<T>.
 */
export interface ApiStatusResponse<T> {
    status: 'success' | 'error';
    data: T;
    message?: string;
}

/**
 * Boolean-success convention — mirrors backend types/api.types.ts ApiResponse<T>.
 * New code should prefer this shape.
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    code?: string;
    details?: Record<string, unknown>;
}

export interface ApiSuccessResponse<T = unknown> {
    success: true;
    data?: T;
    message?: string;
}

export interface ApiErrorResponse {
    success: false;
    error: string;
    message?: string;
    code?: string;
}

// =============================================================================
// EXCHANGE RATE
// =============================================================================

/** GET /api/getCurrentExchangeRate, POST /api/updateExchangeRateForDate. */
export interface ExchangeRateResult {
    status: 'success' | 'error';
    exchangeRate?: number;
    message?: string;
}

export interface HistoryEntry {
    date: string;
    exchangeRate: number;
}

/** GET /api/exchange-rates?from=&to=. */
export interface HistoryResult {
    status: 'success' | 'error';
    rates?: HistoryEntry[];
    message?: string;
}

// =============================================================================
// PAYMENT
// =============================================================================

/**
 * Body of POST /api/Addinvoice from the aligner payment-form-drawer flow.
 * UI form state with `Amountpaid: string | number` lives inline in
 * PaymentFormDrawer; this is the narrowed shape sent to the server.
 */
export interface PaymentSaveData {
    Amountpaid: number;
    Dateofpayment: string;
    ActualAmount: null;
    ActualCur: string;
    Change: null;
}

// =============================================================================
// AUTH / USER
// =============================================================================

/** GET /api/auth/me. */
export interface UserResponse {
    success: boolean;
    user?: {
        role: string;
    };
}

/** POST /api/portal/login (patient portal). */
export interface LoginResponse {
    success: boolean;
    patientName?: string | null;
    language?: number | null;
    error?: string;
    lockedUntil?: string;
}

// =============================================================================
// PORTAL ACCESS (staff side — managing a patient's portal access)
// =============================================================================

/** Read-shape returned by GET /api/patients/:id/portal. */
export interface PortalStatus {
    enabled: boolean;
    hasPin: boolean;
    lockedUntil: string | null;
    lastLoginAt: string | null;
    failedAttempts: number;
    qrDataUrl: string;
    portalUrl: string;
}

/** Wrapper for PortalStatus — fields beyond `success` may be missing on error. */
export interface PortalStatusResponse extends Partial<PortalStatus> {
    success: boolean;
    error?: string;
}

/** POST /api/patients/:id/portal/reset-pin. Distinct from WhatsAppResetResponse. */
export interface PortalPinResetResponse {
    success: boolean;
    pin?: string;
    error?: string;
}

// =============================================================================
// PORTAL — PATIENT-FACING DATA TABS
// =============================================================================

export interface PortalPaymentRow {
    Payment: number;
    Date: string;
}

/** GET /api/portal/payments. */
export interface PortalPaymentsResponse {
    success: boolean;
    payments?: PortalPaymentRow[];
    error?: string;
}

export interface PortalNextAppointment {
    appointmentID: number;
    AppDate: string;
    AppDetail: string | null;
    DrName: string | null;
}

/** GET /api/portal/appointments/next. */
export interface PortalNextAppointmentResponse {
    success: boolean;
    appointment: PortalNextAppointment | null;
    error?: string;
}

/**
 * Visit summary returned by the patient portal.
 * Distinct from the staff-side VisitSummary in services/appointment.ts — different shape.
 */
export interface PortalVisitSummary {
    PatientName: string;
    WorkID: number;
    ID: number;
    VisitDate: string;
    OPG: boolean;
    IPhoto: boolean;
    FPhoto: boolean;
    PPhoto: boolean;
    ApplianceRemoved: boolean;
    Summary: string | null;
}

/** GET /api/portal/visits. */
export interface PortalVisitsResponse {
    success: boolean;
    visits?: PortalVisitSummary[];
    error?: string;
}

// =============================================================================
// MESSAGING / WHATSAPP (HTTP only — WebSocket payloads are not in scope)
// =============================================================================

/** POST /api/messages/reset/:date. Distinct from PortalPinResetResponse. */
export interface WhatsAppResetResponse {
    success: boolean;
    data?: {
        appointmentsReset?: number;
    };
    error?: string;
}

/** POST /api/email/send/:date. */
export interface EmailResponse {
    success: boolean;
    appointmentCount?: number;
    error?: string;
}
