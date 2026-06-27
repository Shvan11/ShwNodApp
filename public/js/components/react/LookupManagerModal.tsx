/**
 * LookupManagerModal — hosts the generic LookupEditor inside a shared <Modal> so
 * any lookup table can be managed in-place (e.g. from a right-click "Edit values"
 * on a dropdown), not only from Settings → Lookups.
 *
 * The table's column schema isn't hard-coded here: it's read from the same
 * `adminLookupTablesQuery()` config feed Settings uses, so adding the table to the
 * server whitelist (LOOKUP_TABLE_CONFIG) is all that's needed to manage it here.
 *
 * Stacking: the lab dropdown that opens this lives inside the Expense modal, so
 * this can render on top of another <Modal>. Body-scroll lock is refcounted in
 * Modal.tsx (safe to nest), but its Escape handler is document-level, so we close
 * THIS modal ourselves on a captured Escape (stopImmediatePropagation) and pass
 * `closeOnEscape={false}` to the inner Modal — the underlying modal stays open.
 */
import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import Modal from './Modal';
import ModalHeader from './ModalHeader';
import LookupEditor from './LookupEditor';
import { adminLookupTablesQuery } from '@/query/queries';
import styles from './LookupManagerModal.module.css';

// The generic lookup editor styles (toolbar / table / popovers) are global; pull
// the sheet in here so the editor is styled even if Settings was never opened.
import '../../../css/components/lookup-editor.css';

interface ReferenceConfig {
  table: string;
  idColumn: string;
  displayColumn: string;
}

interface ColumnConfig {
  name: string;
  label: string;
  type: string;
  required?: boolean;
  maxLength?: number;
  reference?: ReferenceConfig;
}

interface TableConfig {
  key: string;
  displayName: string;
  icon: string;
  columns: ColumnConfig[];
  idColumn: string;
}

interface LookupManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Whitelist key of the lookup table (e.g. 'tblLabs'). */
  tableKey: string;
  /** Modal title override; defaults to `Manage <displayName>`. */
  title?: string;
  /** Fired after any successful create/update/delete (refresh consumer feeds). */
  onChanged?: () => void;
}

const TITLE_ID = 'lookup-manager-title';

const LookupManagerModal = ({ isOpen, onClose, tableKey, title, onChanged }: LookupManagerModalProps) => {
  // The config list is long-lived + shared with Settings; only fetch once open.
  const { data } = useQuery({ ...adminLookupTablesQuery(), enabled: isOpen });
  const tables = (data ?? []) as TableConfig[];
  const config = tables.find((t) => t.key === tableKey) ?? null;

  // Close on a captured Escape so a parent <Modal> doesn't also close (see header).
  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        event.preventDefault();
        onClose();
      }
    };
    document.addEventListener('keydown', handleKey, true);
    return () => document.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  const heading = title ?? (config ? `Manage ${config.displayName}` : 'Manage Values');

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      closeOnEscape={false}
      ariaLabelledBy={TITLE_ID}
      contentClassName={styles.modalContent}
    >
      <ModalHeader
        titleId={TITLE_ID}
        title={heading}
        icon={config ? <i className={config.icon} /> : undefined}
        onClose={onClose}
      />
      <div className={styles.body}>
        {config ? (
          <LookupEditor
            tableKey={config.key}
            tableName={config.displayName}
            columns={config.columns}
            idColumn={config.idColumn}
            onChanged={onChanged}
          />
        ) : (
          <div className={styles.loading}>
            <i className="fas fa-spinner fa-spin" aria-hidden="true" />
            <span>Loading…</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default LookupManagerModal;
