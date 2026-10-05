/**
 * User-facing wording shared by the slot's right-click menu and the top-bar actions,
 * so the two never explain the same state differently.
 */
import type { SlotState } from './photoEditorTypes';

/** Why "Continue editing" is unavailable for a saved slot, or null when it is available. */
export function continueBlockedReason(slot: SlotState): string | null {
  if (slot.canContinue) return null;
  if (!slot.canReEdit) return 'the original photo is missing';
  if (!slot.savedFraming) return 'saved before framing was recorded';
  return 'its original photo changed since';
}
