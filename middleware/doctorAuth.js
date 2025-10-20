import { executeQuery, TYPES } from '../services/database/index.js';

/**
 * Authentication middleware for doctor portal
 * Validates doctor email from request header and attaches doctor info to req.doctor
 */
export const authenticateDoctor = async (req, res, next) => {
    try {
        // Extract email from Cloudflare Access header
        const doctorEmail = req.headers['cf-access-authenticated-user-email'];

        if (!doctorEmail) {
            return res.status(401).json({
                success: false,
                error: 'Authentication required. No doctor email found in Cloudflare Access headers.'
            });
        }

        // Validate: Check if this email exists in AlignerDoctors table
        const query = `
            SELECT
                DrID,
                DoctorName,
                DoctorEmail,
                LogoPath
            FROM AlignerDoctors
            WHERE DoctorEmail = @email AND DoctorEmail IS NOT NULL
        `;

        const result = await executeQuery(
            query,
            [['email', TYPES.NVarChar, doctorEmail.toLowerCase().trim()]],
            (columns) => ({
                DrID: columns[0].value,
                DoctorName: columns[1].value,
                DoctorEmail: columns[2].value,
                LogoPath: columns[3].value
            })
        );

        if (!result || result.length === 0) {
            console.warn(`Unauthorized portal access attempt with email: ${doctorEmail}`);
            return res.status(403).json({
                success: false,
                error: 'Access denied. Doctor not found or not authorized for portal access.'
            });
        }

        // Attach doctor info to request object for use in subsequent handlers
        req.doctor = result[0];

        // Continue to next handler
        next();

    } catch (error) {
        console.error('Doctor authentication error:', error);
        res.status(500).json({
            success: false,
            error: 'Authentication service error. Please try again later.'
        });
    }
};

/**
 * Development mode bypass that also works in production for testing
 * Allows testing with ?email= parameter while still supporting Cloudflare Access headers
 */
export const authenticateDoctorDev = async (req, res, next) => {
    // Allow email as query parameter for testing: ?email=doctor@example.com
    // This takes precedence over Cloudflare headers if both exist
    const devEmail = req.query.email;
    if (devEmail) {
        req.headers['cf-access-authenticated-user-email'] = devEmail;
    }
    return authenticateDoctor(req, res, next);
};
