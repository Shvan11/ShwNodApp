/**
 * Fullscreen viewer for a set's portal photos, with prev/next across the set.
 *
 * Rendered through the shared `<Modal>` (portal, focus trap, scroll lock, the
 * stack-aware Escape, backdrop dismiss). It used to be a hand-rolled fixed
 * overlay inside `PatientSets`: a click handler on a `role="dialog"` div (the
 * tree's last four lint warnings, audit FE-F0-4), no focus trap, and a
 * window-level Escape listener outside the modal stack.
 */
import { useEffect } from 'react';
import Modal from '../../components/react/Modal';
import type { AlignerPhoto } from './aligner.types';
import styles from './AlignerPhotoViewer.module.css';

interface AlignerPhotoViewerProps {
    photos: AlignerPhoto[];
    index: number;
    onIndexChange: (index: number) => void;
    onClose: () => void;
    formatDate: (value: string | null | undefined) => string;
}

const AlignerPhotoViewer = ({ photos, index, onIndexChange, onClose, formatDate }: AlignerPhotoViewerProps) => {
    const photo = photos[index];
    const hasPrev = index > 0;
    const hasNext = index < photos.length - 1;
    const titleId = 'aligner-photo-viewer-title';

    // ←/→ step through the set. Escape is Modal's (top of the stack only).
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'ArrowLeft' && hasPrev) onIndexChange(index - 1);
            else if (e.key === 'ArrowRight' && hasNext) onIndexChange(index + 1);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [index, hasPrev, hasNext, onIndexChange]);

    if (!photo) return null;

    return (
        <Modal
            isOpen
            onClose={onClose}
            overlayClassName={styles.overlay}
            contentClassName={styles.content}
            ariaLabelledBy={titleId}
            draggable={false}
        >
            <button type="button" className={styles.close} onClick={onClose} aria-label="Close viewer">
                <i className="fas fa-times" aria-hidden="true"></i>
            </button>
            {photos.length > 1 && (
                <button
                    type="button"
                    className={`${styles.nav} ${styles.prev}`}
                    onClick={() => onIndexChange(index - 1)}
                    disabled={!hasPrev}
                    title="Previous photo"
                    aria-label="Previous photo"
                >
                    <i className="fas fa-chevron-left" aria-hidden="true"></i>
                </button>
            )}
            <img src={photo.view_url} alt={photo.file_name} className={styles.image} />
            <div className={styles.details}>
                <div id={titleId} className={styles.filename}>{photo.file_name}</div>
                {photo.uploaded_at && (
                    <div className={styles.meta}>Uploaded: {formatDate(photo.uploaded_at)}</div>
                )}
                {photos.length > 1 && (
                    <div className={styles.counter}>{index + 1} / {photos.length}</div>
                )}
            </div>
            {photos.length > 1 && (
                <button
                    type="button"
                    className={`${styles.nav} ${styles.next}`}
                    onClick={() => onIndexChange(index + 1)}
                    disabled={!hasNext}
                    title="Next photo"
                    aria-label="Next photo"
                >
                    <i className="fas fa-chevron-right" aria-hidden="true"></i>
                </button>
            )}
        </Modal>
    );
};

export default AlignerPhotoViewer;
