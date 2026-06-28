/**
 * SaveConfigModal — name and save the current timeline as a reusable config.
 *
 * Default: a PER-PATIENT literal (the exact picked photos, rebuilt verbatim on
 * apply). Optional "Save as generic template" (enabled only when the timeline is
 * gallery-only across ≤2 timepoints) generalizes it into a clinic-wide recipe
 * matched by photo-type + first/latest session. The payload is built here via
 * `configResolver`; the actual write is the parent's `onSave`.
 */
import { useState } from 'react';
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { canSaveAsTemplate, toLiteralPayload, toTemplatePayload } from './configResolver';
import type { SlideItem } from './types';
import type { ConfigPayload } from '@shared/contracts/slideshow.contract';
import styles from './SlideshowModals.module.css';

interface Props {
  selected: SlideItem[];
  onSave: (name: string, config: ConfigPayload) => Promise<void>;
  onClose: () => void;
}

const SaveConfigModal = ({ selected, onSave, onClose }: Props) => {
  const toast = useToast();
  const [name, setName] = useState('');
  const [asTemplate, setAsTemplate] = useState(false);
  const [busy, setBusy] = useState(false);
  const templateEligible = canSaveAsTemplate(selected);

  const handleSave = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || busy) return;
    const useTemplate = asTemplate && templateEligible;
    const config = useTemplate ? toTemplatePayload(selected) : toLiteralPayload(selected);
    setBusy(true);
    try {
      await onSave(trimmed, config);
      toast.success(useTemplate ? `Saved template “${trimmed}”` : `Saved “${trimmed}”`);
      onClose();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to save configuration'));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal isOpen onClose={onClose} contentClassName={styles.dialog} ariaLabelledBy="slideshow-save-title">
      <ModalHeader
        title="Save presentation"
        titleId="slideshow-save-title"
        icon={<i className="fas fa-floppy-disk" />}
        onClose={onClose}
      />
      <div className={styles.body}>
        <p className={styles.lead}>
          Save the current timeline ({selected.length} photo{selected.length === 1 ? '' : 's'}) so you can re-apply it
          later.
        </p>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="slideshow-config-name">
            Name
          </label>
          <input
            id="slideshow-config-name"
            className={styles.input}
            type="text"
            value={name}
            maxLength={120}
            placeholder="e.g. Consultation — before &amp; after"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleSave();
            }}
          />
        </div>
        <label className={`${styles.checkboxRow} ${!templateEligible ? styles.disabledHint : ''}`}>
          <input
            className={styles.checkbox}
            type="checkbox"
            checked={asTemplate && templateEligible}
            disabled={!templateEligible}
            onChange={(e) => setAsTemplate(e.target.checked)}
          />
          <span className={styles.checkboxText}>
            Save as a generic template
            <span className={styles.checkboxHint}>
              {templateEligible
                ? 'Available to every patient (matched by photo type & first/latest session).'
                : 'Only when all photos are timepoint photos from at most two sessions.'}
            </span>
          </span>
        </label>
      </div>
      <div className={styles.footer}>
        <button type="button" className="btn btn-secondary" onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button type="button" className="btn btn-primary" onClick={handleSave} disabled={!name.trim() || busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </Modal>
  );
};

export default SaveConfigModal;
