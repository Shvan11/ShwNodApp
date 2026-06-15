/**
 * Share chooser — the entry point behind the Files-page "share" icon.
 *
 * Clicking share no longer opens a single transport directly; it opens this
 * sheet, which offers the available share targets (LocalSend, Telegram — more to
 * come) and hands the same `ShareSource[]` off to whichever the user picks. Each
 * target renders its own self-contained modal; only one is mounted at a time.
 */
import { useState } from 'react';
import Modal from '../Modal';
import LocalSendShareModal, { type ShareSource } from '../localsend/LocalSendShareModal';
import TelegramShareModal from './TelegramShareModal';
import styles from './ShareSheet.module.css';

type Target = 'menu' | 'localsend' | 'telegram';

interface ShareTargetDef {
  key: Exclude<Target, 'menu'>;
  label: string;
  description: string;
  icon: string;
}

const TARGETS: ShareTargetDef[] = [
  {
    key: 'localsend',
    label: 'LocalSend',
    description: 'Send to a nearby device on the LAN',
    icon: 'fas fa-wifi',
  },
  {
    key: 'telegram',
    label: 'Telegram',
    description: 'Send to a contact via Telegram',
    icon: 'fab fa-telegram',
  },
];

interface Props {
  open: boolean;
  sources: ShareSource[];
  onClose: () => void;
}

const ShareSheet = ({ open, sources, onClose }: Props) => {
  const [target, setTarget] = useState<Target>('menu');

  // Always start at the chooser each time the sheet opens. Adjust-during-render
  // keyed on the open state so a fresh open resets to the menu without a
  // setState-in-effect bailout.
  const [openedKey, setOpenedKey] = useState(open);
  if (open !== openedKey) {
    setOpenedKey(open);
    if (open) setTarget('menu');
  }

  if (!open) return null;

  if (target === 'localsend') {
    return <LocalSendShareModal open sources={sources} onClose={onClose} />;
  }
  if (target === 'telegram') {
    return <TelegramShareModal open sources={sources} onClose={onClose} />;
  }

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabelledBy="share-sheet-title"
      contentClassName={styles.modal}
    >
      <h3 id="share-sheet-title" className={styles.title}>
        <i className="fas fa-share-nodes" aria-hidden="true" /> Share{' '}
        {sources.length === 1 ? '1 file' : `${sources.length} files`}
      </h3>

      <ul className={styles.targetList}>
        {TARGETS.map((t) => (
          <li key={t.key}>
            <button type="button" className={styles.targetRow} onClick={() => setTarget(t.key)}>
              <i className={`${t.icon} ${styles.targetIcon}`} aria-hidden="true" />
              <span className={styles.targetText}>
                <span className={styles.targetLabel}>{t.label}</span>
                <span className={styles.targetDesc}>{t.description}</span>
              </span>
              <i className="fas fa-chevron-right" aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>

      <div className={styles.footer}>
        <button type="button" className={styles.toolButton} onClick={onClose}>
          Cancel
        </button>
      </div>
    </Modal>
  );
};

export default ShareSheet;
