/**
 * Lookup Data Routes
 *
 * This module provides API endpoints for fetching lookup/reference data
 * such as referral sources, patient types, addresses, and genders.
 * These endpoints are primarily used for populating dropdowns and select fields
 * in the frontend application.
 */

import { Router, type Request, type Response } from 'express';
import { log } from '../../utils/logger.js';
import { ErrorResponses, sendSuccess } from '../../utils/error-response.js';
import {
  getReferralSources,
  getPatientTypes,
  getAddresses,
  getGenders
} from '../../services/database/queries/patient-queries.js';
import { getAlertTypes } from '../../services/database/queries/alert-queries.js';
import { getImplantManufacturers } from '../../services/database/queries/work-queries.js';

const router = Router();

/**
 * GET /referral-sources
 * Fetch all available referral sources for dropdown population
 */
router.get('/referral-sources', async (_req: Request, res: Response): Promise<void> => {
  try {
    const referralSources = await getReferralSources();
    sendSuccess(res, referralSources);
  } catch (error) {
    log.error('Error fetching referral sources:', error);
    ErrorResponses.internalError(res, 'Failed to fetch referral sources', error as Error);
  }
});

/**
 * GET /patient-types
 * Fetch all available patient types for dropdown population
 */
router.get('/patient-types', async (_req: Request, res: Response): Promise<void> => {
  try {
    const patientTypes = await getPatientTypes();
    sendSuccess(res, patientTypes);
  } catch (error) {
    log.error('Error fetching patient types:', error);
    ErrorResponses.internalError(res, 'Failed to fetch patient types', error as Error);
  }
});

/**
 * GET /addresses
 * Fetch all available addresses for dropdown population
 */
router.get('/addresses', async (_req: Request, res: Response): Promise<void> => {
  try {
    const addresses = await getAddresses();
    sendSuccess(res, addresses);
  } catch (error) {
    log.error('Error fetching addresses:', error);
    ErrorResponses.internalError(res, 'Failed to fetch addresses', error as Error);
  }
});

/**
 * GET /genders
 * Fetch all available genders for dropdown population
 */
router.get('/genders', async (_req: Request, res: Response): Promise<void> => {
  try {
    const genders = await getGenders();
    sendSuccess(res, genders);
  } catch (error) {
    log.error('Error fetching genders:', error);
    ErrorResponses.internalError(res, 'Failed to fetch genders', error as Error);
  }
});

/**
 * GET /alert-types
 * Fetch all available alert types for dropdown population
 */
router.get('/alert-types', async (_req: Request, res: Response): Promise<void> => {
  try {
    const alertTypes = await getAlertTypes();
    sendSuccess(res, alertTypes);
  } catch (error) {
    log.error('Error fetching alert types:', error);
    ErrorResponses.internalError(res, 'Failed to fetch alert types', error as Error);
  }
});

/**
 * GET /implant-manufacturers
 * Fetch all available implant manufacturers for dropdown population
 */
router.get('/implant-manufacturers', async (_req: Request, res: Response): Promise<void> => {
  try {
    const manufacturers = await getImplantManufacturers();
    sendSuccess(res, manufacturers);
  } catch (error) {
    log.error('Error fetching implant manufacturers:', error);
    ErrorResponses.internalError(res, 'Failed to fetch implant manufacturers', error as Error);
  }
});

export default router;
