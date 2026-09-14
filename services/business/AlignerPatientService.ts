/**
 * Aligner PATIENT search business logic.
 *
 * Split out of AlignerService.ts (S2/C4).
 */

import { log } from '../../utils/logger.js';
import * as alignerPatientQueries from '../database/queries/aligner-patient-queries.js';
import { AlignerValidationError } from './AlignerErrors.js';

// ==============================
// ALIGNER PATIENTS SEARCH LOGIC
// ==============================

/**
 * Search for aligner patients with validation
 *
 * Business Rules:
 * - Search term must be at least 2 characters
 *
 * @param searchTerm - Search term
 * @param doctorId - Optional doctor id
 * @returns Array of patients
 * @throws AlignerValidationError If validation fails
 */
export async function searchPatients(
  searchTerm: string,
  doctorId: number | null = null
) {
  if (!searchTerm || searchTerm.trim().length < 2) {
    throw new AlignerValidationError(
      'Search term must be at least 2 characters',
      'INVALID_SEARCH_TERM'
    );
  }

  const trimmedSearch = searchTerm.trim();
  log.info(
    `Searching for aligner patients: ${trimmedSearch}${doctorId ? ` (Doctor id: ${doctorId})` : ''}`
  );

  try {
    return await alignerPatientQueries.searchAlignerPatients(trimmedSearch, doctorId);
  } catch (error) {
    log.error('Error searching aligner patients:', { error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

