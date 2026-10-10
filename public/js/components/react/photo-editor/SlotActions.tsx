/**
 * Active-slot action bar, rendered in the editor topbar next to the title. These
 * quick actions (90° rotate, mirror, flip, reset framing, discard/remove) moved up
 * here from under each slot to reclaim vertical space, so the whole grid fits without
 * scrolling. They operate on the currently selected slot — pan and zoom are done
 * directly on the slot with the mouse, and the fine-rotation slider stays under
 * each slot because it has no mouse equivalent. The selected slot's framing readout
 * (SlotReadout) sits right after them.
 *
 * A saved slot offers three re-edit routes: "Continue editing" (its original, framed as
 * saved — when the save recorded its framing), "Start over" (its original at the
 * default framing), and "Recrop saved photo" (the saved photo itself — the one that
 * needs no original, so a view whose original is gone can still be re-cropped).
 */
import styles from './SlotActions.module.css';
import { labelForView, type PhotoViewCode } from './photoEditorTypes';
import type { PhotoEditorState } from './usePhotoEditorState';
import SlotReadout from './SlotReadout';
import { continueBlockedReason } from './slotLabels';

interface Props {
  personId: number;
  editor: PhotoEditorState;
  activeView: PhotoViewCode | null;
  /** Framing against the 2048 px proxy — the readout then asks the server for the original's size. */
  proxyMode: boolean;
  /** Remove a SAVED photo (server delete, after a confirm). */
  onRemoveSaved: (view: PhotoViewCode) => void;
}

const SlotActions = ({ personId, editor, activeView, proxyMode, onRemoveSaved }: Props) => {
  const slot = activeView ? editor.slots[activeView] : null;
  const hasImage = !!slot?.sourceRelPath;
  // A saved slot with no live edit: Restore and Remove used to exist only in the
  // right-click menu (FE-F14-13b); they are buttons here too.
  const saved = !!slot && !slot.sourceRelPath && !!slot.savedImageUrl;
  const canRestore = saved && !!slot?.canReEdit && !!slot?.reEditRelPath;
  const continueBlocked = slot ? continueBlockedReason(slot) : null;

  return (
    <div className={styles.actions} role="toolbar" aria-label="Selected photo tools">
      <span className={styles.target} title="Quick actions apply to the selected slot">
        {activeView ? labelForView(activeView) : 'No slot selected'}
      </span>
      <div className={styles.group}>
        <button
          type="button"
          className={styles.btn}
          disabled={!hasImage}
          title="Rotate left 90°"
          aria-label="Rotate left 90°"
          onClick={() => activeView && editor.setRotation(activeView, editor.slots[activeView].rotation - 90)}
        >
          <i className="fas fa-rotate-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!hasImage}
          title="Rotate right 90°"
          aria-label="Rotate right 90°"
          onClick={() => activeView && editor.setRotation(activeView, editor.slots[activeView].rotation + 90)}
        >
          <i className="fas fa-rotate-right" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${hasImage && slot?.flipH ? styles.active : ''}`}
          disabled={!hasImage}
          title="Mirror (horizontal)"
          aria-label="Mirror (horizontal)"
          onClick={() => activeView && editor.toggleFlipH(activeView)}
        >
          <i className="fas fa-arrows-left-right" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${hasImage && slot?.flipV ? styles.active : ''}`}
          disabled={!hasImage}
          title="Flip (vertical)"
          aria-label="Flip (vertical)"
          onClick={() => activeView && editor.toggleFlipV(activeView)}
        >
          <i className="fas fa-arrows-up-down" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!hasImage}
          title={slot?.resetTo ? 'Reset to the saved framing' : 'Reset framing'}
          aria-label={slot?.resetTo ? 'Reset to the saved framing' : 'Reset framing'}
          onClick={() => activeView && editor.reset(activeView)}
        >
          <i className="fas fa-arrows-rotate" aria-hidden="true" />
        </button>
        {saved ? (
          <>
            <button
              type="button"
              className={styles.btn}
              disabled={!canRestore || !!continueBlocked}
              title={
                continueBlocked
                  ? `Continue editing — unavailable: ${continueBlocked}`
                  : 'Continue editing — reopen with the saved framing (or double-click the photo)'
              }
              aria-label="Continue editing"
              onClick={() => activeView && editor.continueEditing(activeView)}
            >
              <i className="fas fa-pen-to-square" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.btn}
              disabled={!canRestore}
              title={canRestore ? 'Start over from the original' : 'Original missing — drag one to redo'}
              aria-label="Start over from the original"
              onClick={() => {
                if (activeView && slot?.reEditRelPath) {
                  editor.place(activeView, slot.reEditRelPath, slot.reEditName ?? slot.reEditRelPath, slot.reEditVersion);
                }
              }}
            >
              <i className="fas fa-clock-rotate-left" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={styles.btn}
              disabled={!slot?.savedName}
              title={
                canRestore
                  ? 'Recrop the saved photo — frames the cropped photo itself (Start over keeps more of the picture)'
                  : 'Recrop the saved photo — its original is missing, so this frames the cropped photo itself (or double-click the photo)'
              }
              aria-label="Recrop the saved photo"
              onClick={() => activeView && editor.recropSaved(activeView)}
            >
              <i className="fas fa-crop-simple" aria-hidden="true" />
            </button>
            <button
              type="button"
              className={`${styles.btn} ${styles.danger}`}
              title="Remove the saved photo"
              aria-label="Remove the saved photo"
              onClick={() => activeView && onRemoveSaved(activeView)}
            >
              <i className="fas fa-trash" aria-hidden="true" />
            </button>
          </>
        ) : hasImage && slot?.savedImageUrl ? (
          // Editing a view that is saved: dropping the edit brings the saved photo back.
          <button
            type="button"
            className={styles.btn}
            title="Discard changes — back to the saved photo"
            aria-label="Discard changes"
            onClick={() => activeView && editor.discard(activeView)}
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        ) : (
          <button
            type="button"
            className={`${styles.btn} ${styles.danger}`}
            disabled={!hasImage}
            title="Remove photo"
            aria-label="Remove photo"
            onClick={() => activeView && editor.discard(activeView)}
          >
            <i className="fas fa-xmark" aria-hidden="true" />
          </button>
        )}
      </div>
      <SlotReadout
        personId={personId}
        slot={slot}
        proxyMode={proxyMode}
        onResetZoom={() => activeView && editor.setZoom(activeView, 1)}
        onResetRotation={() => activeView && editor.setRotation(activeView, 0)}
      />
    </div>
  );
};

export default SlotActions;
