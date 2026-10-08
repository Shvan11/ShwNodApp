/**
 * "Rename to existing timepoint" — make a folder the originals folder of one of the
 * patient's photo sessions by renaming it to that session's folder name
 * (`{name}_{DD-MM-YYYY}`, `sessionFolderName`). The photo editor and the grid's
 * "Open original folder" find a session's originals by that name alone, so the
 * rename is the whole link.
 *
 * A session's folder lives in the patient's main folder, so one picked from deeper
 * down is moved up there first (the parent runs both steps). A session that already
 * has a folder is listed but can't be picked: the rename would be refused, and two
 * folders of originals are for the user to merge by hand.
 *
 * The photo editor's RenameFolderModal is the same link from the other side: a
 * session picking its folder.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { httpErrorMessage } from '@/core/http';
import Modal from '@/components/react/Modal';
import ModalHeader from '@/components/react/ModalHeader';
import type { FileEntry } from '@/types/api.types';
import { sessionFolderName } from '@shared/photo-session-folder';
import { patientFilesQuery, timepointsQuery } from '@/query/queries';
import { formatLocaleDate } from '@/utils/formatters';
import { folderOf } from './fileHelpers';
import styles from './FileExplorer.module.css';

interface Props {
  personId: number;
  folder: FileEntry;
  busy: boolean;
  /** Rename `folder` to `folderName`, the folder name of the session `sessionName`. */
  onPick: (folderName: string, sessionName: string) => void;
  onClose: () => void;
}

const TITLE_ID = 'file-timepoint-folder-title';

const TimepointFolderModal = ({ personId, folder, busy, onPick, onClose }: Props) => {
  const [picked, setPicked] = useState<string | null>(null);
  const sessions = useQuery(timepointsQuery(personId));
  // What the patient's main folder already holds: a session whose name is taken there has a folder.
  const root = useQuery(patientFilesQuery(personId, '', false));
  const takenAtRoot = new Set((root.data?.entries ?? []).map((e) => e.name.toLowerCase()));
  const nested = folderOf(folder.relPath) !== '';

  const rows = (sessions.data ?? []).map((s) => {
    const target = sessionFolderName(s.tp_description, s.tp_date_time);
    const key = target?.toLowerCase();
    const isCurrent = !nested && key === folder.name.toLowerCase();
    let note: string | null = null;
    if (!target) note = 'Has no date, so no folder name';
    else if (isCurrent) note = 'This is its folder already';
    else if (key && takenAtRoot.has(key)) note = 'Has a folder already';
    return { session: s, target, note };
  });
  const choice = rows.find((r) => r.target && r.target === picked);
  const loading = sessions.isLoading || root.isLoading;
  const error = sessions.error ?? root.error;

  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy={TITLE_ID} contentClassName={styles.pickerModal}>
      <ModalHeader
        titleId={TITLE_ID}
        title={`Rename “${folder.name}” to a timepoint`}
        icon={<i className="fas fa-camera" aria-hidden="true" />}
        onClose={onClose}
        dense
      />

      <p className={styles.pickerLead}>
        Pick the timepoint whose photos this folder holds. It is renamed to that timepoint’s folder name, where the
        photo editor looks for its originals.
        {nested && ' It is also moved up to the patient’s main Files folder, where timepoint folders live.'}
      </p>

      <div className={styles.pickerList}>
        {loading && <div className={styles.message}>Loading…</div>}
        {error && (
          <div className={styles.error}>
            <i className="fas fa-triangle-exclamation" aria-hidden="true" />{' '}
            {httpErrorMessage(error, 'Failed to load the timepoints')}
          </div>
        )}
        {!loading && !error && rows.length === 0 && (
          <div className={styles.message}>This patient has no timepoints yet.</div>
        )}
        {!loading &&
          !error &&
          rows.map(({ session, target, note }) => (
            <button
              key={session.tp_code}
              type="button"
              className={`${styles.pickerFolder} ${picked && picked === target ? styles.pickerPicked : ''}`}
              onClick={() => setPicked(target)}
              disabled={!!note}
              aria-pressed={!!picked && picked === target}
            >
              <i className="fas fa-camera" aria-hidden="true" />
              <span className={styles.pickerFolderName}>
                {session.tp_description}{' '}
                <span className={styles.pickerSub}>
                  {formatLocaleDate(session.tp_date_time, { year: 'numeric', month: 'short', day: 'numeric' })}
                </span>
                <small className={styles.pickerTarget}>{note ?? target}</small>
              </span>
              {picked && picked === target && <i className="fas fa-check" aria-hidden="true" />}
            </button>
          ))}
      </div>

      <div className={styles.pickerFooter}>
        <div className={styles.toolbarSpacer} />
        <button type="button" className={styles.toolButton} onClick={onClose}>
          Cancel
        </button>
        <button
          type="button"
          className={styles.primaryButton}
          onClick={() => choice?.target && onPick(choice.target, choice.session.tp_description)}
          disabled={busy || !choice}
        >
          {busy ? 'Renaming…' : choice?.target ? `Rename to “${choice.target}”` : 'Rename'}
        </button>
      </div>
    </Modal>
  );
};

export default TimepointFolderModal;
