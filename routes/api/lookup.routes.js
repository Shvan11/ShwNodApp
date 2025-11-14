/**
 * Lookup Data Routes
 *
 * This module provides API endpoints for fetching lookup/reference data
 * such as referral sources, patient types, addresses, and genders.
 * These endpoints are primarily used for populating dropdowns and select fields
 * in the frontend application.
 */

import express from 'express';
import { getReferralSources, getPatientTypes, getAddresses, getGenders } from '../../services/database/queries/patient-queries.js';

const router = express.Router();

/**
 * GET /referral-sources
 * Fetch all available referral sources for dropdown population
 */
router.get('/referral-sources', async (req, res) => {
    try {
        const referralSources = await getReferralSources();
        res.json(referralSources);
    } catch (error) {
        console.error('Error fetching referral sources:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch referral sources"
        });
    }
});

/**
 * GET /patient-types
 * Fetch all available patient types for dropdown population
 */
router.get('/patient-types', async (req, res) => {
    try {
        const patientTypes = await getPatientTypes();
        res.json(patientTypes);
    } catch (error) {
        console.error('Error fetching patient types:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch patient types"
        });
    }
});

/**
 * GET /addresses
 * Fetch all available addresses for dropdown population
 */
router.get('/addresses', async (req, res) => {
    try {
        const addresses = await getAddresses();
        res.json(addresses);
    } catch (error) {
        console.error('Error fetching addresses:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch addresses"
        });
    }
});

/**
 * GET /genders
 * Fetch all available genders for dropdown population
 */
router.get('/genders', async (req, res) => {
    try {
        const genders = await getGenders();
        res.json(genders);
    } catch (error) {
        console.error('Error fetching genders:', error);
        res.status(500).json({
            error: error.message || "Failed to fetch genders"
        });
    }
});

export default router;
