/**
 * FolderPickerModal — add arbitrary images from the patient's on-disk folder to
 * the timeline (beyond the 8 Dolphin timepoint galleries).
 *
 * A thin wrapper around the existing `PatientFolderPicker` (breadcrumb nav,
 * image-only filter, thumbnails). Each clicked image becomes a folder-sourced
 * `SlidePhoto` (identity + URL keyed on its relative path) and is appended via the
 * timeline's existing `onAdd`. The modal stays open so several can be added.
 */
import Modal from '../Modal';
import ModalHeader from '../ModalHeader';
import { useToast } from '@/contexts/ToastContext';
import PatientFolderPicker from '../PatientFolderPicker';
import { buildContentUrl } from '../files/fileHelpers';
import type { FileEntry } from '@/types/api.types';
import type { SlidePhoto } from './types';
import styles from './SlideshowModals.module.css';

interface Props {
  personId: number;
  onAdd: (photo: SlidePhoto) => void;
  onClose: () => void;
}

const FolderPickerModal = ({ personId, onAdd, onClose }: Props) => {
  const toast = useToast();

  const pick = (entry: FileEntry): void => {
    onAdd({
      source: 'folder',
      path: entry.relPath,
      name: entry.name,
      label: entry.name,
      url: buildContentUrl(personId, entry.relPath),
      tp: '',
      tpDescription: '',
      tpDate: '',
    });
    toast.success(`Added ${entry.name}`);
  };

  return (
    <Modal isOpen onClose={onClose} contentClassName={styles.folderDialog} ariaLabelledBy="slideshow-folder-title">
      <ModalHeader
        title="Add from patient folder"
        titleId="slideshow-folder-title"
        icon={<i className="fas fa-folder-open" />}
        subtitle="Click an image to add it. Add as many as you like, then close."
        onClose={onClose}
      />
      <div className={styles.folderBody}>
        <PatientFolderPicker personId={personId} onSelect={pick} />
      </div>
    </Modal>
  );
};

export default FolderPickerModal;
