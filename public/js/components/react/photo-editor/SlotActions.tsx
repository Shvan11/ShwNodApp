/**
 * Active-slot action bar, rendered in the editor topbar next to the title. These
 * quick actions (90° rotate, mirror, flip, reset framing, remove) moved up here
 * from under each slot to reclaim vertical space, so the whole grid fits without
 * scrolling. They operate on the currently selected slot — pan and zoom are done
 * directly on the slot with the mouse, and the fine-rotation slider stays under
 * each slot because it has no mouse equivalent.
 */
import styles from './SlotActions.module.css';
import { labelForView, type PhotoViewCode } from './photoEditorTypes';
import type { PhotoEditorState } from './usePhotoEditorState';

interface Props {
  editor: PhotoEditorState;
  activeView: PhotoViewCode | null;
}

const SlotActions = ({ editor, activeView }: Props) => {
  const slot = activeView ? editor.slots[activeView] : null;
  const hasImage = !!slot?.sourceRelPath;

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
          onClick={() => activeView && editor.setRotation(activeView, editor.slots[activeView].rotation - 90)}
        >
          <i className="fas fa-rotate-left" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!hasImage}
          title="Rotate right 90°"
          onClick={() => activeView && editor.setRotation(activeView, editor.slots[activeView].rotation + 90)}
        >
          <i className="fas fa-rotate-right" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${slot?.flipH ? styles.active : ''}`}
          disabled={!hasImage}
          title="Mirror (horizontal)"
          onClick={() => activeView && editor.toggleFlipH(activeView)}
        >
          <i className="fas fa-arrows-left-right" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${slot?.flipV ? styles.active : ''}`}
          disabled={!hasImage}
          title="Flip (vertical)"
          onClick={() => activeView && editor.toggleFlipV(activeView)}
        >
          <i className="fas fa-arrows-up-down" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.btn}
          disabled={!hasImage}
          title="Reset framing"
          onClick={() => activeView && editor.reset(activeView)}
        >
          <i className="fas fa-arrows-rotate" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={`${styles.btn} ${styles.danger}`}
          disabled={!hasImage}
          title="Remove photo"
          onClick={() => activeView && editor.clear(activeView)}
        >
          <i className="fas fa-xmark" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
};

export default SlotActions;
