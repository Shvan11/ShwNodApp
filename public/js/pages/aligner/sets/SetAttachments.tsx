/**
 * The doctor's portal uploads for one set: photos, and scan files. Each card
 * carries its upload date under the name — a set collects uploads over several
 * visits, and the date is how staff tell the new ones from the old.
 *
 * Each card is a container holding sibling buttons — view (or download) and delete.
 * It used to be one `role="button"` card with the delete button nested inside, so
 * Enter on Delete bubbled up and opened the viewer instead (FE-F17-4).
 *
 * A scan file (STL / PLY / ZIP) opens in the 3D viewer; its download moved to a
 * small button on the card. The viewer reads the bytes through the server
 * (`…/photos/content`): the presigned R2 URL is cross-origin and the bucket's CORS
 * admits only the doctor portal.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { alignerSetPhotosQuery } from '@/query/queries';
import { deleteJSON, httpErrorMessage } from '@/core/http';
import { invalidateAligner } from '@/query/aligner';
import { useConfirm } from '../../../contexts/ConfirmContext';
import { useToast } from '../../../contexts/ToastContext';
import ScanViewerModal, { type ScanFile } from '../../../components/react/scan-viewer/ScanViewerModal';
import { scanFormat } from '../../../components/react/scan-viewer/scanFormats';
import type { AlignerPhoto } from '../aligner.types';
import { fileIconClass, formatSetDate, formatSetDateTime } from './setHelpers';
import styles from '../PatientSets.module.css';

interface SetAttachmentsProps {
    setId: number;
    onViewPhotos: (photos: AlignerPhoto[], index: number) => void;
}

export default function SetAttachments({ setId, onViewPhotos }: SetAttachmentsProps) {
    const confirm = useConfirm();
    const toast = useToast();
    const { data, isPending, isError, refetch } = useQuery(alignerSetPhotosQuery(setId));
    const [viewingScan, setViewingScan] = useState<AlignerPhoto | null>(null);

    if (isPending) {
        return (
            <div className="aligner-photos-container">
                <div className="loading">
                    <div className="spinner"></div>
                    <p>Loading files...</p>
                </div>
            </div>
        );
    }
    if (isError) {
        return (
            <div className="aligner-photos-container">
                <p className="empty-state">
                    Could not load the doctor&apos;s uploads.{' '}
                    <button type="button" className="btn btn-secondary btn-sm" onClick={() => void refetch()}>
                        Retry
                    </button>
                </p>
            </div>
        );
    }

    const all = data.photos;
    const imagePhotos = all.filter((p) => p.path.includes('/photos/') || !p.path.includes('/files/'));
    const fileAttachments = all.filter((p) => p.path.includes('/files/'));
    // The viewer lists every scan of the set, so an upper and a lower can be shown together.
    const scans = fileAttachments.filter((f) => scanFormat(f.file_name) !== null);
    const scanFiles: ScanFile[] = scans.map((f) => ({
        url: `/api/aligner/sets/${setId}/photos/content?path=${encodeURIComponent(f.path)}`,
        name: f.file_name,
        size: f.file_size,
    }));

    // The delete removes the DOCTOR's upload from the portal's storage for good —
    // the prompt says so, and says "file" for a scan (FE-F17-11).
    const handleDelete = async (attachment: AlignerPhoto, kind: 'photo' | 'file'): Promise<void> => {
        const ok = await confirm(
            `Delete the ${kind} "${attachment.file_name}"?\nIt was uploaded by the doctor through the portal; deleting it removes it from the portal too, and it cannot be recovered.`,
            { title: kind === 'photo' ? 'Delete Photo' : 'Delete Scan File', danger: true, confirmText: 'Delete' }
        );
        if (!ok) return;
        try {
            await deleteJSON(`/api/aligner/sets/${setId}/photos?path=${encodeURIComponent(attachment.path)}`);
            toast.success(kind === 'photo' ? 'Photo deleted' : 'File deleted');
        } catch (error) {
            toast.error(`Failed to delete the ${kind}: ${httpErrorMessage(error, 'unknown error')}`);
        } finally {
            await invalidateAligner();
        }
    };

    return (
        <div className="aligner-photos-container">
            <div className={styles.photosSection}>
                <div className="aligner-photos-header">
                    <h5>
                        <i className="fas fa-camera" aria-hidden="true"></i>
                        Portal Photos ({imagePhotos.length})
                    </h5>
                </div>
                {imagePhotos.length === 0 ? (
                    <p className="empty-state">No photos uploaded by the doctor yet</p>
                ) : (
                    <div className="aligner-photos-grid">
                        {imagePhotos.map((photo, index) => (
                            <div key={photo.path} className="aligner-photo-card">
                                <button
                                    type="button"
                                    className="aligner-photo-view"
                                    onClick={() => onViewPhotos(imagePhotos, index)}
                                    title={`View ${photo.file_name}`}
                                >
                                    <img src={photo.view_url} alt={photo.file_name} />
                                    <AttachmentCaption attachment={photo} />
                                </button>
                                <button
                                    type="button"
                                    className="aligner-photo-delete-btn"
                                    onClick={() => void handleDelete(photo, 'photo')}
                                    title="Delete photo"
                                    aria-label={`Delete photo ${photo.file_name}`}
                                >
                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            <div>
                <div className="aligner-photos-header">
                    <h5>
                        <i className="fas fa-cube" aria-hidden="true"></i>
                        Portal Scan Files ({fileAttachments.length})
                    </h5>
                </div>
                {fileAttachments.length === 0 ? (
                    <p className="empty-state">No scan files uploaded by the doctor yet</p>
                ) : (
                    <div className="aligner-photos-grid">
                        {fileAttachments.map((file) => (
                            <div key={file.path} className="aligner-photo-card">
                                {scanFormat(file.file_name) ? (
                                    <>
                                        <button
                                            type="button"
                                            className="aligner-photo-view"
                                            onClick={() => setViewingScan(file)}
                                            title={`View ${file.file_name} in 3D`}
                                        >
                                            <span className="aligner-file-icon-placeholder">
                                                <i className={fileIconClass(file)} aria-hidden="true"></i>
                                            </span>
                                            <AttachmentCaption attachment={file} />
                                        </button>
                                        <a
                                            className="aligner-photo-download-btn"
                                            href={file.view_url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            title="Download file"
                                            aria-label={`Download file ${file.file_name}`}
                                        >
                                            <i className="fas fa-download" aria-hidden="true"></i>
                                        </a>
                                    </>
                                ) : (
                                    <a
                                        className="aligner-photo-view"
                                        href={file.view_url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        title={`Download ${file.file_name}`}
                                    >
                                        <span className="aligner-file-icon-placeholder">
                                            <i className={fileIconClass(file)} aria-hidden="true"></i>
                                        </span>
                                        <AttachmentCaption attachment={file} />
                                    </a>
                                )}
                                <button
                                    type="button"
                                    className="aligner-photo-delete-btn"
                                    onClick={() => void handleDelete(file, 'file')}
                                    title="Delete file"
                                    aria-label={`Delete file ${file.file_name}`}
                                >
                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                </button>
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {viewingScan && (
                <ScanViewerModal
                    key={viewingScan.path}
                    files={scanFiles}
                    initialIndex={Math.max(0, scans.findIndex((s) => s.path === viewingScan.path))}
                    onClose={() => setViewingScan(null)}
                />
            )}
        </div>
    );
}

/**
 * A card's caption: the file name, and the day the doctor uploaded it. The card
 * is too narrow for the time as well, so that rides in the tooltip (and the
 * photo viewer shows both).
 */
function AttachmentCaption({ attachment }: { attachment: AlignerPhoto }) {
    return (
        <span className="aligner-photo-info-overlay">
            <span className="aligner-photo-info-name">{attachment.file_name}</span>
            {attachment.uploaded_at && (
                <span
                    className="aligner-photo-info-date"
                    title={`Uploaded ${formatSetDateTime(attachment.uploaded_at)}`}
                >
                    <i className="far fa-clock" aria-hidden="true"></i>{' '}
                    {formatSetDate(attachment.uploaded_at)}
                </span>
            )}
        </span>
    );
}
