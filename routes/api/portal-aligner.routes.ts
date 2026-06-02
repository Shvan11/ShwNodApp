/**
 * External Aligner Portal — auth bridge
 *
 * Public (pre-auth-gate) endpoints consumed by the `aligner-portal-external`
 * Cloudflare-Pages app. The portal cannot read the raw Supabase mirror directly
 * because the mirror holds the ENTIRE clinic DB and is RLS-locked. Instead:
 *
 *   1. The portal authenticates the doctor via Cloudflare Access (a signed JWT
 *      in the `CF_Authorization` cookie on the portal's own origin).
 *   2. The portal forwards that JWT here. We verify it against Cloudflare's
 *      JWKS, map the email to an aligner `dr_id`, and mint a short-lived
 *      Supabase JWT carrying a `dr_id` claim (role=authenticated, HS256, signed
 *      with the failover project's JWT secret).
 *   3. The portal attaches that token to its Supabase client; RLS on the raw
 *      tables filters every row by the `dr_id` claim — a real, server-enforced
 *      doctor boundary (client-side filtering was not one).
 *
 * Writes are NOT handled here (Phase 1 is read-only); doctor-scoped write
 * endpoints land in a later phase.
 *
 * This router is mounted BEFORE the `/api` auth gate in index.ts — it is public
 * and performs its own Cloudflare-Access verification.
 */

import { Router, type Request, type Response, type NextFunction } from 'express';
import { SignJWT, jwtVerify, createRemoteJWKSet, type JWTPayload } from 'jose';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';
import * as alignerQueries from '../../services/database/queries/aligner-queries.js';

const router = Router();

const ADMIN_EMAIL = 'shwan.orthodontics@gmail.com';
const TOKEN_TTL = '30m';

// ---------------------------------------------------------------------------
// Configuration (optional service block — read from env at request time so the
// values are correct regardless of module import order vs. dotenv, and pick up
// a restart's .env without depending on evaluation timing).
// ---------------------------------------------------------------------------

/** Normalize the team domain into a full https origin (no trailing slash). */
function teamDomainUrl(): string | null {
  const raw = (process.env.CF_ACCESS_TEAM_DOMAIN || '').trim();
  if (!raw) return null;
  const withScheme = raw.startsWith('http') ? raw : `https://${raw}`;
  return withScheme.replace(/\/+$/, '');
}

// Lazily-built, cached remote JWKS for Cloudflare Access (jose caches the keys
// internally and refreshes on rotation). Built once per process.
let cfJwks: ReturnType<typeof createRemoteJWKSet> | null = null;
function getCfJwks(teamUrl: string): ReturnType<typeof createRemoteJWKSet> {
  if (!cfJwks) {
    cfJwks = createRemoteJWKSet(new URL(`${teamUrl}/cdn-cgi/access/certs`));
  }
  return cfJwks;
}

// ---------------------------------------------------------------------------
// CORS — the portal is a different origin (Cloudflare Pages). The CF Access JWT
// travels in the request body (cross-site cookies don't flow), so credentials
// are not required; we just allow the configured Pages origin.
// ---------------------------------------------------------------------------
function cors(req: Request, res: Response, next: NextFunction): void {
  // PORTAL_ALLOWED_ORIGIN may be a comma-separated allowlist (custom domain +
  // *.pages.dev preview). Reflect whichever request Origin matches.
  const allowed = (process.env.PORTAL_ALLOWED_ORIGIN || '*')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  const reqOrigin = req.headers.origin || '';
  const origin = allowed.includes('*')
    ? '*'
    : reqOrigin && allowed.includes(reqOrigin)
      ? reqOrigin
      : allowed[0] || '*';
  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}
router.use(cors);

// ---------------------------------------------------------------------------
// Cloudflare-Access verification → resolved email
// ---------------------------------------------------------------------------

/** Pull the CF Access JWT from the Authorization bearer, a known header, body, or query. */
function extractCfToken(req: Request): string | null {
  const auth = req.header('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7).trim();
  const headerToken = req.header('cf-access-jwt-assertion');
  if (headerToken) return headerToken.trim();
  const bodyToken = (req.body as { cfToken?: string } | undefined)?.cfToken;
  if (bodyToken) return bodyToken.trim();
  const queryToken = typeof req.query.cfToken === 'string' ? req.query.cfToken : null;
  if (queryToken) return queryToken.trim();
  return null;
}

/**
 * Resolve the authenticated doctor email. In production with CF Access
 * configured, this requires a valid Cloudflare-Access JWT. In development with
 * CF Access NOT configured, a plain `email` in the body is accepted so the
 * portal's `?email=` dev mode can exercise the full chain locally.
 *
 * Returns null on failure (caller responds 401).
 */
async function resolveEmail(req: Request): Promise<string | null> {
  const teamUrl = teamDomainUrl();
  const cfAud = process.env.CF_ACCESS_AUD || '';
  const isProduction = process.env.NODE_ENV === 'production';
  const cfConfigured = !!teamUrl && !!cfAud;

  if (cfConfigured) {
    const token = extractCfToken(req);
    if (!token) return null;
    try {
      const { payload } = await jwtVerify(token, getCfJwks(teamUrl), {
        issuer: teamUrl,
        audience: cfAud,
      });
      const email = (payload as JWTPayload & { email?: string }).email;
      return email ? email.toLowerCase() : null;
    } catch (err) {
      log.warn('Portal: Cloudflare Access JWT verification failed', {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  // Dev fallback — only when CF Access is unconfigured and not in production.
  if (!isProduction) {
    const devEmail =
      (req.body as { email?: string } | undefined)?.email ||
      (typeof req.query.email === 'string' ? req.query.email : undefined);
    if (devEmail) {
      log.warn('Portal: using DEV email fallback (Cloudflare Access not configured)', {
        email: devEmail,
      });
      return devEmail.toLowerCase();
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// POST /api/aligner-portal/token
//   body: { cfToken?, email? (dev), impersonateDrId? (admin only) }
//   → { success, token, doctor }
// ---------------------------------------------------------------------------
router.post('/token', async (req: Request, res: Response): Promise<void> => {
  try {
    const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET || '';
    if (!supabaseJwtSecret) {
      log.error('Portal token requested but SUPABASE_JWT_SECRET is not configured');
      ErrorResponses.internalError(res, 'Portal authentication is not configured');
      return;
    }

    const email = await resolveEmail(req);
    if (!email) {
      ErrorResponses.unauthorized(res, 'Cloudflare Access verification failed');
      return;
    }

    const isAdmin = email === ADMIN_EMAIL;

    // Resolve the effective doctor. Admins may impersonate any doctor by id;
    // everyone else is bound to their own email-mapped doctor.
    let doctor;
    if (isAdmin) {
      const impersonateDrId = Number(
        (req.body as { impersonateDrId?: number | string } | undefined)?.impersonateDrId
      );
      if (!impersonateDrId || Number.isNaN(impersonateDrId)) {
        // Admin without a selected doctor — return identity so the portal can
        // show the doctor picker (list comes from GET /doctors).
        res.json({ success: true, token: null, isAdmin: true, doctor: null });
        return;
      }
      const rows = await alignerQueries.getDoctorById(impersonateDrId);
      doctor = rows[0] ?? null;
    } else {
      doctor = await alignerQueries.getDoctorByEmail(email);
    }

    if (!doctor) {
      ErrorResponses.notFound(res, 'Doctor');
      return;
    }

    const secret = new TextEncoder().encode(supabaseJwtSecret);
    const token = await new SignJWT({
      role: 'authenticated',
      dr_id: doctor.dr_id,
      email: doctor.doctor_email ?? email,
    })
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setSubject(`portal-dr-${doctor.dr_id}`)
      .setAudience('authenticated')
      .setIssuedAt()
      .setExpirationTime(TOKEN_TTL)
      .sign(secret);

    res.json({ success: true, token, isAdmin, doctor });
  } catch (error) {
    log.error('Portal token minting failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    ErrorResponses.internalError(res, 'Failed to issue portal token', error as Error);
  }
});

// ---------------------------------------------------------------------------
// GET /api/aligner-portal/doctors  (admin only)
//   Full doctor list for the admin impersonation dropdown. RLS keeps regular
//   doctors from listing peers, so the admin list is sourced here instead.
// ---------------------------------------------------------------------------
router.get('/doctors', async (req: Request, res: Response): Promise<void> => {
  try {
    const email = await resolveEmail(req);
    if (!email) {
      ErrorResponses.unauthorized(res, 'Cloudflare Access verification failed');
      return;
    }
    if (email !== ADMIN_EMAIL) {
      ErrorResponses.forbidden(res, 'Admin access required');
      return;
    }

    const doctors = await alignerQueries.getAllDoctors();
    res.json({ success: true, doctors: doctors || [] });
  } catch (error) {
    log.error('Portal doctor list failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    ErrorResponses.internalError(res, 'Failed to fetch doctors', error as Error);
  }
});

export default router;
