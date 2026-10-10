/**
 * API contract — photo slot names (`/api/photo-slots`).
 *
 * Dolphin files every photo under a 2-digit slot code. Only the 8 grid views and the X-ray
 * slots say what is in them, so a clinic names the others itself: this clinic keeps smile
 * close-ups in `02`, which Dolphin calls "Ceph Front". The names live in `image_types.label`,
 * are edited in Settings → Lookups → Photo Slot Names (`PhotoSlotNamesEditor.tsx`) and reach
 * the screens through the working-files listing (`file-explorer.contract.ts`), not through
 * these endpoints.
 */
import { z } from 'zod';

/** A slot outside the 8 grid views. Closed and fully modeled, so a plain `z.object`. */
export const photoSlot = z.object({
  /** Dolphin's 2-digit code: `02`, `51`, … (the files are `.I02`/`.V02`). */
  code: z.string(),
  /** Dolphin's own name for the slot (`image_types.description`). */
  dolphinName: z.string().nullable(),
  /** The clinic's name; null = the app's built-in one (an X-ray's name, otherwise "Image"). */
  label: z.string().nullable(),
  /** Photo records filed under the code, across every session. */
  images: z.number(),
});
export type PhotoSlot = z.infer<typeof photoSlot>;

// GET /api/photo-slots → every slot outside the grid views, by code.
export const listSlots = {
  response: z.array(photoSlot),
} as const;

// PUT /api/photo-slots/:code { label } → the slot as saved. A blank or null label clears the
// clinic's name. A grid view's code is refused (400): those names are the app's own.
export const updateSlot = {
  params: z.object({ code: z.string().regex(/^\d{2}$/, 'Invalid slot code') }),
  body: z.object({ label: z.string().trim().max(40, 'Keep the name to 40 characters').nullable() }),
  response: photoSlot,
} as const;
export type UpdateSlotParams = z.infer<typeof updateSlot.params>;
export type UpdateSlotBody = z.infer<typeof updateSlot.body>;
