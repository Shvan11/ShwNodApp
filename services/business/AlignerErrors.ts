/**
 * Aligner error taxonomy — shared by every Aligner*Service module and by the route
 * layer, which maps `AlignerValidationError.code` onto an HTTP status.
 *
 * Split out of AlignerService.ts (S2/C4): it was the one piece every section used.
 */

/**
 * Aligner error codes
 */
export type AlignerErrorCode =
  | 'MISSING_REQUIRED_FIELDS'
  | 'INVALID_SET_ID'
  | 'SET_NOT_FOUND'
  | 'INVALID_BATCH_ID'
  | 'BATCH_NOT_FOUND'
  | 'INVALID_SET_CHANGE'
  | 'UPPER_ALIGNER_LIMIT_EXCEEDED'
  | 'LOWER_ALIGNER_LIMIT_EXCEEDED'
  | 'BATCH_NOT_DELIVERED'
  | 'BATCH_NOT_MANUFACTURED'
  | 'INVALID_DATE_ORDER'
  | 'SEQUENCE_LOCKED'
  | 'VALIDATION_ERROR'
  | 'MISSING_DOCTOR_NAME'
  | 'EMAIL_ALREADY_EXISTS'
  | 'DOCTOR_HAS_SETS'
  | 'INVALID_NOTE_ID'
  | 'MISSING_NOTE_TEXT'
  | 'NOTE_NOT_FOUND'
  | 'SET_COST_NOT_DEFINED'
  | 'INVALID_AMOUNT'
  | 'PAYMENT_EXCEEDS_BALANCE'
  | 'SET_COST_BELOW_PAID'
  | 'INVALID_SEARCH_TERM';

/**
 * Aligner error details
 */
export interface AlignerErrorDetails {
  [key: string]: unknown;
  setId?: number;
  email?: string;
  setCount?: number;
  noteId?: number;
  batchId?: number;
  workId?: number;
  amount?: number;
  balance?: number;
}

/**
 * Validation error class for aligner business logic
 */
export class AlignerValidationError extends Error {
  public readonly code: AlignerErrorCode;
  public readonly details: AlignerErrorDetails;

  constructor(
    message: string,
    code: AlignerErrorCode,
    details: AlignerErrorDetails = {}
  ) {
    super(message);
    this.name = 'AlignerValidationError';
    this.code = code;
    this.details = details;
  }
}
