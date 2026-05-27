/**
 * Feature-flag route guards.
 *
 * These return 404 (not 403) when a flag is off, so a dark feature's API surface
 * is invisible rather than merely forbidden — matching the "dark by default"
 * posture of the native photo editor (Phase 4 of the Dolphin-native migration).
 */
import type { Request, Response, NextFunction } from 'express';
import config from '../config/config.js';
import { ErrorResponses } from '../utils/error-response.js';

/**
 * Gate routes behind the native-photo-editor flag
 * (`NATIVE_PHOTO_EDITOR_ENABLED=true`). 404 when the flag is off.
 */
export function requireNativePhotoEditor(_req: Request, res: Response, next: NextFunction): void {
  if (!config.featureFlags.nativePhotoEditor) {
    ErrorResponses.notFound(res);
    return;
  }
  next();
}
