/**
 * Centralized API contract types for the staff and patient-portal frontends.
 *
 * Imported as: `import type { ... } from '@/types/api.types';`
 *
 * Aligner-specific types live in `pages/aligner/aligner.types.ts` and are
 * not re-exported from here.
 */

// =============================================================================
// PRIMITIVE STRING ALIASES (documentation-only — structurally just `string`)
// =============================================================================

/** A calendar date with no time or zone, formatted `YYYY-MM-DD` (matches PG `date` columns). */
export type DateOnly = string;

/** An ISO-8601 timestamp, e.g. `2026-06-04T12:00:00.000Z` (PG `timestamp` columns / envelope `timestamp`). */
export type IsoTimestamp = string;

// =============================================================================
// GENERIC RESPONSE WRAPPERS
// =============================================================================

/**
 * Boolean-success convention — mirrors backend types/api.types.ts ApiResponse<T>.
 * New code should prefer this shape.
 */
export interface ApiResponse<T = unknown> {
    success: boolean;
    data?: T;
    error?: string;
    message?: string;
    /**
     * Legacy/fallback location for a machine-readable error code. The canonical
     * place is `details.code` — every conflict route nests it there — so read
     * defensively as `details?.code ?? code`.
     */
    code?: string;
    /** Structured error context; conflict routes carry the error code here as `details.code`. */
    details?: { code?: string } & Record<string, unknown>;
    /**
     * ISO timestamp emitted by the backend envelope (sendSuccess / ErrorResponses).
     * Required as of H4 — every staff route now rides the envelope, which always
     * stamps `timestamp`. (Raw-consumer exceptions — whatsapp/portal — don't use
     * this shared type.)
     */
    timestamp: IsoTimestamp;
}

export interface ApiErrorResponse {
    success: false;
    error: string;
    message?: string;
    /** Legacy/fallback location — canonical error code is `details.code`. Read as `details?.code ?? code`. */
    code?: string;
    /** Structured error context; conflict routes nest the error code here as `details.code`. */
    details?: { code?: string } & Record<string, unknown>;
    /** ISO timestamp emitted by ErrorResponses — always present (every error rides the envelope). */
    timestamp: IsoTimestamp;
}

// =============================================================================
// EXCHANGE RATE
// =============================================================================

/** GET /api/getCurrentExchangeRate, GET /api/getExchangeRateForDate. */
export type ExchangeRateResult = ApiResponse<{ exchangeRate?: number; date?: DateOnly }>;

export interface HistoryEntry {
    date: DateOnly;
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

/**
 * POST /api/photo-editor/:personId/prepare response payload — the inner `data` of
 * the `sendSuccess` envelope (unwrapped by `core/http.ts`). A discriminated union
 * of the three normal outcomes, so a new outcome is a compile error until handled:
 *  - `{ tp_code }`          — timepoint prepared, hand off to the editor;
 *  - `{ conflict: true }`   — an Initial/Final date already exists; confirm override;
 *  - `{ needsName: true }`  — patient has no English name (Dolphin can't store Arabic).
 * Genuine failures are non-2xx (thrown as `HttpError`), never this shape.
 */
export type PhotoPrepareResult =
    | { tp_code: number }
    | {
          conflict: true;
          conflictType: string;
          conflictSource: 'shwan';
          existingDate: DateOnly;
          requestedDate: DateOnly;
          message: string;
      }
    | { needsName: true; message: string };

// =============================================================================
// PORTAL ACCESS (staff side — managing a patient's portal access)
// =============================================================================
// The staff-side portal read shapes (PortalStatus / PortalStatusResponse /
// PortalPinResetResponse) are co-located with their sole consumer,
// components/react/PortalAccessCard.tsx — they annotate the long tail of the
// loose `portalStatus.response` contract container, so they belong with the
// component, not in this envelope/utility-only file.

// =============================================================================
// PORTAL — PATIENT-FACING DATA TABS
// =============================================================================
// The patient-facing portal response shapes are external/untrusted input, so
// they're validated at the fetch boundary with Zod and live (as the single
// source of truth, via `z.infer`) in `public/js/portal/portal.schemas.ts`.

// =============================================================================
// MESSAGING / WHATSAPP (HTTP only — SSE payloads are not in scope)
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

// The file-explorer shapes (FileEntry/FileListing/FileBatchDeleteResult + the
// FileCategory/FileEntryType/FileDeleteResult helpers) are now authored once as Zod
// in the shared contract and re-exported here so existing `@/types/api.types`
// imports keep working — the contract is the single source of truth (same fold as
// pages/aligner/aligner.types.ts). `modified` is a plain ISO string there.
export type {
    FileCategory,
    FileEntryType,
    FileEntry,
    FileListing,
    FileDeleteResult,
    FileBatchDeleteResult,
} from '@shared/contracts/file-explorer.contract';
