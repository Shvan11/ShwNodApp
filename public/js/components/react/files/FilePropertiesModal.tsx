/**
 * Properties of one file or folder, or of the patient folder itself: what a
 * desktop file manager's right-click → Properties shows. Type, location, size
 * (a folder's is everything inside it, with how many files and folders that is),
 * when it was created and modified, and for a photo its pixel size and when it
 * was taken. Read-only; the size and dates come from the server on open.
 */
import { useQuery } from '@tanstack/react-query';
import Modal from '@/components/react/Modal';
import ModalHeader from '@/components/react/ModalHeader';
import { httpErrorMessage } from '@/core/http';
import { filePropertiesQuery, sourceSizeQuery } from '@/query/queries';
import type { FileEntry } from '@/types/api.types';
import type { EntryProperties } from '@shared/contracts/file-explorer.contract';
import { formatLocaleDateTime, formatNumber, formatPhotoTakenAt } from '@/utils/formatters';
import { categoryIcon, folderOf, formatSize } from './fileHelpers';
import styles from './FileExplorer.module.css';

const TITLE_ID = 'file-properties-title';

const CATEGORY_NOUN: Record<EntryProperties['category'], string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
  pdf: 'document',
  text: 'text file',
  office: 'document',
  archive: 'archive',
  other: 'file',
};

const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
};

/** "PANO file", "JPG image", "Folder". */
function typeLabel(p: EntryProperties): string {
  if (p.type === 'dir') return 'Folder';
  if (p.type === 'symlink') return 'Link';
  const ext = p.ext.replace(/^\./, '').toUpperCase();
  return ext ? `${ext} ${CATEGORY_NOUN[p.category]}` : 'File';
}

/** "2.5 MB (2,668,538 bytes)", as Explorer writes it. */
function sizeLabel(bytes: number): string {
  return bytes < 1024 ? `${formatNumber(bytes)} bytes` : `${formatSize(bytes)} (${formatNumber(bytes)} bytes)`;
}

/** "Files / OPG": where the entry sits, from the patient folder down. */
function locationLabel(relPath: string): string {
  return ['Files', ...folderOf(relPath).split('/').filter(Boolean)].join(' / ');
}

interface Props {
  personId: number;
  /** The entry's path; '' = the patient folder itself. */
  relPath: string;
  /** The listed entry, when there is one: its icon shows before the server answers. */
  entry?: FileEntry;
  /** When the photo was taken (EXIF), if the listing knows. */
  takenAt?: string | null;
  onClose: () => void;
}

const FilePropertiesModal = ({ personId, relPath, entry, takenAt, onClose }: Props) => {
  const { data, error, isLoading } = useQuery(filePropertiesQuery(personId, relPath));
  const isImage = data?.type === 'file' && data.category === 'image';
  const dims = useQuery({
    ...sourceSizeQuery(personId, relPath, data?.modified ?? null),
    enabled: isImage,
    retry: false,
  });

  const name = relPath ? relPath.slice(relPath.lastIndexOf('/') + 1) : 'Files';
  const icon = entry ? categoryIcon(entry) : 'fa-folder';

  return (
    <Modal isOpen onClose={onClose} ariaLabelledBy={TITLE_ID} contentClassName={styles.pickerModal}>
      <ModalHeader
        titleId={TITLE_ID}
        title={name}
        subtitle="Properties"
        icon={<i className={`fas ${icon}`} aria-hidden="true" />}
        onClose={onClose}
        dense
      />

      {isLoading && <div className={styles.message}>Loading…</div>}
      {error && (
        <div className={styles.error}>
          <i className="fas fa-triangle-exclamation" aria-hidden="true" />{' '}
          {httpErrorMessage(error, 'Could not read its properties')}
        </div>
      )}
      {data && (
        <dl className={styles.propsList}>
          <dt>Type</dt>
          <dd>{relPath ? typeLabel(data) : 'Patient folder'}</dd>

          {relPath !== '' && (
            <>
              <dt>Location</dt>
              <dd>{locationLabel(relPath)}</dd>
            </>
          )}

          <dt>Size</dt>
          <dd>{sizeLabel(data.size)}</dd>

          {data.contents && (
            <>
              <dt>Contains</dt>
              <dd>
                {data.contents.truncated ? 'At least ' : ''}
                {formatNumber(data.contents.files)} file{data.contents.files === 1 ? '' : 's'},{' '}
                {formatNumber(data.contents.folders)} folder{data.contents.folders === 1 ? '' : 's'}
              </dd>
            </>
          )}

          {dims.data && (
            <>
              <dt>Dimensions</dt>
              <dd>
                {dims.data.width} × {dims.data.height} px
              </dd>
            </>
          )}

          {takenAt && (
            <>
              <dt>Taken</dt>
              <dd>{formatPhotoTakenAt(takenAt)}</dd>
            </>
          )}

          {data.created && (
            <>
              <dt>Created</dt>
              <dd>{formatLocaleDateTime(data.created, DATE_TIME)}</dd>
            </>
          )}

          <dt>Modified</dt>
          <dd>{formatLocaleDateTime(data.modified, DATE_TIME)}</dd>
        </dl>
      )}

      <div className={styles.pickerFooter}>
        <div className={styles.toolbarSpacer} />
        <button type="button" className={styles.toolButton} onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  );
};

export default FilePropertiesModal;
