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
 * Boolean-success wrapper with a typed data payload. Used by the /api/templates
 * endpoints. Mirrors the backend `{ success, data, message?, error? }` envelope.
 */
export interface ApiStatusResponse<T> {
    success: boolean;
    data: T;
    message?: string;
    error?: string;
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

/** GET /api/getCurrentExchangeRate, GET /api/getExchangeRateForDate. */
export type ExchangeRateResult = ApiResponse<{ exchangeRate?: number; date?: string }>;

export interface HistoryEntry {
    date: string;
    exchangeRate: number;
}

/** GET /api/exchange-rates?from=&to=. */
export type HistoryResult = ApiResponse<{ rates?: HistoryEntry[] }>;

// =============================================================================
// PAYMENT
// =============================================================================

/**
 * Body of POST /api/aligner/payments from the aligner payment-form-drawer flow.
 * UI form state with `amount_paid: string | number` lives inline in
 * PaymentFormDrawer; this is the narrowed shape sent to the server.
 */
export interface PaymentSaveData {
    amount_paid: number;
    date_of_payment: string;
    actual_amount: null;
    actual_cur: string;
    change: null;
}

// =============================================================================
// AUTH / USER
// =============================================================================

/** GET /api/auth/me. */
export interface UserResponse {
    success: boolean;
    user?: {
        username?: string;
        fullName?: string;
        role: string;
    };
}

// =============================================================================
// PHOTO EDITOR (native photo-session layout manager)
// =============================================================================

/** The 8 fixed orthodontic view codes (layout slots). */
export type PhotoViewCode = 'i10' | 'i12' | 'i13' | 'i20' | 'i21' | 'i22' | 'i23' | 'i24';

/**
 * Per-slot render instruction (POST /api/photo-editor/:personId/render). The client
 * collapses pan+zoom+crop into a single `extract` rect in the source pixel space
 * AFTER EXIF-orient + flip + rotation; the server applies the same order with sharp.
 */
export interface SlotRenderSpec {
    view: PhotoViewCode;
    /** Path relative to clinic1/{personId}/, e.g. "Initial_01-01-2026/IMG_001.jpg". */
    sourceRelPath: string;
    flipH: boolean;
    flipV: boolean;
    rotation: number;
    /** Omit to let the server centre-crop to the view aspect (un-opened slot). */
    extract?: { left: number; top: number; width: number; height: number };
    output: { width: number; height: number };
}

/** POST /api/photo-editor/:personId/prepare request body. */
export interface PhotoPrepareRequest {
    tpDescription: string;
    tpDate: string;
}

/** POST /api/photo-editor/:personId/prepare response data (success or shwan-date conflict). */
export interface PhotoPrepareResult {
    tp_code?: number;
    conflict?: boolean;
    conflictSource?: 'shwan';
    existingDate?: string;
    requestedDate?: string;
}

/** POST /api/photo-editor/:personId/render request body. */
export interface PhotoRenderRequest {
    tpCode: number;
    tpName: string;
    tpDate: string;
    slots: SlotRenderSpec[];
}

/**
 * POST /api/photo-editor/:personId/render response (202 Accepted). The render runs
 * in the background; completion is announced over SSE (`photos_rendered`), so the
 * synchronous response only confirms the timepoint was resolved and work was queued.
 */
export interface PhotoRenderResult {
    success: true;
    queued: true;
    tp_code: number;
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
// The patient-facing portal response shapes are external/untrusted input, so
// they're validated at the fetch boundary with Zod and live (as the single
// source of truth, via `z.infer`) in `public/js/portal/portal.schemas.ts`.

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

// =============================================================================
// FILE EXPLORER (/api/patients/:id/files*)
// =============================================================================

/** Coarse file class that drives the explorer icon + preview strategy. */
export type FileCategory =
    | 'image'
    | 'video'
    | 'audio'
    | 'pdf'
    | 'text'
    | 'office'
    | 'archive'
    | 'other';

/** A single directory entry. `size`/`modified` are omitted in flat mode. */
export interface FileEntry {
    name: string;
    /** Path relative to the patient root, web-style `/` separators. */
    relPath: string;
    type: 'file' | 'dir' | 'symlink';
    size?: number;
    /** ISO timestamp. */
    modified?: string;
    ext: string;
    category: FileCategory;
}

/** GET /api/patients/:id/files → ApiResponse<FileListing>. */
export interface FileListing {
    /** Browsed path relative to the patient root (`''` = root). */
    path: string;
    parent: string | null;
    flat: boolean;
    truncated: boolean;
    entries: FileEntry[];
}

/** One entry's outcome in a bulk soft-delete. */
export interface FileDeleteResult {
    relPath: string;
    ok: boolean;
    error?: string;
}

/** POST /api/patients/:id/files/delete-batch → ApiResponse<FileBatchDeleteResult>. */
export interface FileBatchDeleteResult {
    results: FileDeleteResult[];
    succeeded: number;
    failed: number;
}
