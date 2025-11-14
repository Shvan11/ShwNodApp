/**
 * Aligner Service - Business Logic Layer
 *
 * This service handles all aligner-related business logic including:
 * - Aligner set creation with active set management
 * - Aligner doctor email validation
 * - Aligner doctor dependency checking
 * - Business rules enforcement
 *
 * This layer sits between route handlers and database queries,
 * encapsulating business rules and validation logic.
 */

import { log } from '../../utils/logger.js';
import * as database from '../database/index.js';

/**
 * Validation error class for aligner business logic
 */
export class AlignerValidationError extends Error {
    constructor(message, code, details = {}) {
        super(message);
        this.name = 'AlignerValidationError';
        this.code = code;
        this.details = details;
    }
}

/**
 * Validate and create a new aligner set
 *
 * Business Rules:
 * - If creating an active set (IsActive = 1), deactivates all other sets for the same work
 * - Initializes remaining aligners count equal to total count
 * - Sets creation date automatically
 *
 * @param {Object} setData
 * @param {number} setData.WorkID - Work ID (required)
 * @param {number} setData.SetSequence - Set sequence number
 * @param {string} setData.Type - Type of aligners
 * @param {number} setData.UpperAlignersCount - Number of upper aligners
 * @param {number} setData.LowerAlignersCount - Number of lower aligners
 * @param {number} setData.Days - Treatment days
 * @param {number} setData.AlignerDrID - Aligner doctor ID (required)
 * @param {string} setData.SetUrl - URL to set files
 * @param {string} setData.SetPdfUrl - URL to PDF
 * @param {number} setData.SetCost - Cost of set
 * @param {string} setData.Currency - Currency (USD/IQD)
 * @param {string} setData.Notes - Notes
 * @param {boolean} setData.IsActive - Whether this is the active set (default: true)
 * @returns {Promise<number>} New set ID
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreateSet(setData) {
    const {
        WorkID,
        SetSequence,
        Type,
        UpperAlignersCount,
        LowerAlignersCount,
        Days,
        AlignerDrID,
        SetUrl,
        SetPdfUrl,
        SetCost,
        Currency,
        Notes,
        IsActive
    } = setData;

    // Validation
    if (!WorkID || !AlignerDrID) {
        throw new AlignerValidationError(
            'WorkID and AlignerDrID are required',
            'MISSING_REQUIRED_FIELDS'
        );
    }

    log.info('Creating new aligner set with business logic:', setData);

    // Use database transaction to ensure atomicity of deactivation + insertion
    const query = `
        DECLARE @OutputTable TABLE (AlignerSetID INT);

        -- Business Rule: If creating a new active set, deactivate all other sets for this work
        IF @IsActive = 1
        BEGIN
            UPDATE tblAlignerSets
            SET IsActive = 0
            WHERE WorkID = @WorkID AND IsActive = 1;
        END

        -- Insert new set with remaining aligners = total aligners
        INSERT INTO tblAlignerSets (
            WorkID, SetSequence, Type, UpperAlignersCount, LowerAlignersCount,
            RemainingUpperAligners, RemainingLowerAligners, Days, AlignerDrID,
            SetUrl, SetPdfUrl, SetCost, Currency, Notes, IsActive, CreationDate
        )
        OUTPUT INSERTED.AlignerSetID INTO @OutputTable
        VALUES (
            @WorkID, @SetSequence, @Type, @UpperAlignersCount, @LowerAlignersCount,
            @UpperAlignersCount, @LowerAlignersCount, @Days, @AlignerDrID,
            @SetUrl, @SetPdfUrl, @SetCost, @Currency, @Notes, @IsActive, GETDATE()
        );

        SELECT AlignerSetID FROM @OutputTable;
    `;

    const result = await database.executeQuery(
        query,
        [
            ['WorkID', database.TYPES.Int, parseInt(WorkID)],
            ['SetSequence', database.TYPES.Int, SetSequence ? parseInt(SetSequence) : null],
            ['Type', database.TYPES.NVarChar, Type || null],
            ['UpperAlignersCount', database.TYPES.Int, UpperAlignersCount ? parseInt(UpperAlignersCount) : 0],
            ['LowerAlignersCount', database.TYPES.Int, LowerAlignersCount ? parseInt(LowerAlignersCount) : 0],
            ['Days', database.TYPES.Int, Days ? parseInt(Days) : null],
            ['AlignerDrID', database.TYPES.Int, parseInt(AlignerDrID)],
            ['SetUrl', database.TYPES.NVarChar, SetUrl || null],
            ['SetPdfUrl', database.TYPES.NVarChar, SetPdfUrl || null],
            ['SetCost', database.TYPES.Decimal, SetCost ? parseFloat(SetCost) : null],
            ['Currency', database.TYPES.NVarChar, Currency || null],
            ['Notes', database.TYPES.NVarChar, Notes || null],
            ['IsActive', database.TYPES.Bit, IsActive !== undefined ? IsActive : true]
        ],
        (columns) => columns[0].value
    );

    const newSetId = result && result.length > 0 ? result[0] : null;

    log.info(`Aligner set created successfully: Set ${newSetId} for Work ${WorkID}`);

    return newSetId;
}

/**
 * Check if email is already taken by another aligner doctor
 * @param {string} email - Email to check
 * @param {number} excludeDrID - Doctor ID to exclude from check (for updates)
 * @returns {Promise<boolean>} True if email exists
 */
async function isEmailTaken(email, excludeDrID = null) {
    if (!email || email.trim() === '') {
        return false; // Email is optional
    }

    let query = 'SELECT DrID FROM AlignerDoctors WHERE DoctorEmail = @email';
    const params = [['email', database.TYPES.NVarChar, email.trim()]];

    if (excludeDrID) {
        query += ' AND DrID != @drID';
        params.push(['drID', database.TYPES.Int, parseInt(excludeDrID)]);
    }

    const result = await database.executeQuery(
        query,
        params,
        (columns) => columns[0].value
    );

    return result && result.length > 0;
}

/**
 * Validate and create a new aligner doctor
 *
 * Business Rules:
 * - Email must be unique (if provided)
 * - Doctor name is required
 *
 * @param {Object} doctorData
 * @param {string} doctorData.DoctorName - Doctor name (required)
 * @param {string} doctorData.DoctorEmail - Doctor email (optional, must be unique)
 * @param {string} doctorData.LogoPath - Path to doctor's logo (optional)
 * @returns {Promise<number>} New doctor ID
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndCreateDoctor(doctorData) {
    const { DoctorName, DoctorEmail, LogoPath } = doctorData;

    if (!DoctorName || DoctorName.trim() === '') {
        throw new AlignerValidationError(
            'Doctor name is required',
            'MISSING_DOCTOR_NAME'
        );
    }

    // Business Rule: Email must be unique
    const emailExists = await isEmailTaken(DoctorEmail);
    if (emailExists) {
        throw new AlignerValidationError(
            'A doctor with this email already exists',
            'EMAIL_ALREADY_EXISTS',
            { email: DoctorEmail }
        );
    }

    // Insert doctor
    const insertQuery = `
        DECLARE @OutputTable TABLE (DrID INT);

        INSERT INTO AlignerDoctors (DoctorName, DoctorEmail, LogoPath)
        OUTPUT INSERTED.DrID INTO @OutputTable
        VALUES (@name, @email, @logo);

        SELECT DrID FROM @OutputTable;
    `;

    const result = await database.executeQuery(
        insertQuery,
        [
            ['name', database.TYPES.NVarChar, DoctorName.trim()],
            ['email', database.TYPES.VarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
            ['logo', database.TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null]
        ],
        (columns) => columns[0].value
    );

    const newDrID = result && result.length > 0 ? result[0] : null;

    log.info(`Aligner doctor created successfully: Dr ${newDrID} - ${DoctorName}`);

    return newDrID;
}

/**
 * Validate and update an aligner doctor
 *
 * Business Rules:
 * - Email must be unique among other doctors (if provided)
 * - Doctor name is required
 *
 * @param {number} drID - Doctor ID
 * @param {Object} doctorData
 * @param {string} doctorData.DoctorName - Doctor name (required)
 * @param {string} doctorData.DoctorEmail - Doctor email (optional, must be unique)
 * @param {string} doctorData.LogoPath - Path to doctor's logo (optional)
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If validation fails
 */
export async function validateAndUpdateDoctor(drID, doctorData) {
    const { DoctorName, DoctorEmail, LogoPath } = doctorData;

    if (!DoctorName || DoctorName.trim() === '') {
        throw new AlignerValidationError(
            'Doctor name is required',
            'MISSING_DOCTOR_NAME'
        );
    }

    // Business Rule: Email must be unique (excluding this doctor)
    const emailExists = await isEmailTaken(DoctorEmail, drID);
    if (emailExists) {
        throw new AlignerValidationError(
            'Another doctor with this email already exists',
            'EMAIL_ALREADY_EXISTS',
            { email: DoctorEmail }
        );
    }

    // Update doctor
    const updateQuery = `
        UPDATE AlignerDoctors
        SET DoctorName = @name,
            DoctorEmail = @email,
            LogoPath = @logo
        WHERE DrID = @drID
    `;

    await database.executeQuery(
        updateQuery,
        [
            ['name', database.TYPES.NVarChar, DoctorName.trim()],
            ['email', database.TYPES.NVarChar, DoctorEmail && DoctorEmail.trim() !== '' ? DoctorEmail.trim() : null],
            ['logo', database.TYPES.NVarChar, LogoPath && LogoPath.trim() !== '' ? LogoPath.trim() : null],
            ['drID', database.TYPES.Int, parseInt(drID)]
        ]
    );

    log.info(`Aligner doctor updated successfully: Dr ${drID} - ${DoctorName}`);
}

/**
 * Check if doctor has any aligner sets
 * @param {number} drID - Doctor ID
 * @returns {Promise<number>} Number of sets
 */
async function getDoctorSetCount(drID) {
    const result = await database.executeQuery(
        'SELECT COUNT(*) as SetCount FROM tblAlignerSets WHERE AlignerDrID = @drID',
        [['drID', database.TYPES.Int, parseInt(drID)]],
        (columns) => columns[0].value
    );

    return result && result.length > 0 ? result[0] : 0;
}

/**
 * Validate and delete an aligner doctor
 *
 * Business Rules:
 * - Cannot delete doctor if they have aligner sets
 * - Must reassign or delete sets first
 *
 * @param {number} drID - Doctor ID
 * @returns {Promise<void>}
 * @throws {AlignerValidationError} If doctor has dependencies
 */
export async function validateAndDeleteDoctor(drID) {
    // Business Rule: Check for dependencies
    const setCount = await getDoctorSetCount(drID);

    if (setCount > 0) {
        throw new AlignerValidationError(
            `Cannot delete doctor. They have ${setCount} aligner set(s) associated with them. Please reassign or delete those sets first.`,
            'DOCTOR_HAS_SETS',
            { setCount }
        );
    }

    // Delete doctor
    const deleteQuery = 'DELETE FROM AlignerDoctors WHERE DrID = @drID';

    await database.executeQuery(
        deleteQuery,
        [['drID', database.TYPES.Int, parseInt(drID)]]
    );

    log.info(`Aligner doctor deleted successfully: Dr ${drID}`);
}

export default {
    validateAndCreateSet,
    validateAndCreateDoctor,
    validateAndUpdateDoctor,
    validateAndDeleteDoctor,
    AlignerValidationError
};
