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
 * this can render on top of another <Modal>. Both halves of that are handled by
 * the primitive — the body-scroll lock is refcounted and Escape is served from a
 * stack whose TOP entry alone answers, so this modal closes and the one beneath
 * it stays open. (Until 2026-09-17 it hand-rolled that itself, with a captured
 * `stopImmediatePropagation` plus `closeOnEscape={false}`.)
 */
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
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
  /** Modal title override; defaults to `common:lookups.manage` ("Manage <displayName>"). */
  title?: string;
  /** Fired after any successful create/update/delete (refresh consumer feeds). */
  onChanged?: () => void;
}

const TITLE_ID = 'lookup-manager-title';

const LookupManagerModal = ({ isOpen, onClose, tableKey, title, onChanged }: LookupManagerModalProps) => {
  const { t } = useTranslation('common');
  // The config list is long-lived + shared with Settings; only fetch once open.
  const { data } = useQuery({ ...adminLookupTablesQuery(), enabled: isOpen });
  // `lookupAdmin.tables.response` is `anyArray` on purpose (config rows vary per
  // registered table), so the shape is asserted once here, off `unknown[]`.
  const tables = (data ?? []) as TableConfig[];
  const config = tables.find((t) => t.key === tableKey) ?? null;

  const heading = title ?? (config ? t('lookups.manage', { name: config.displayName }) : t('lookups.manageValues'));

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
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
            <span>{t('lookups.loading')}</span>
          </div>
        )}
      </div>
    </Modal>
  );
};

export default LookupManagerModal;
