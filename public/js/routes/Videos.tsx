import { useState, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../contexts/ToastContext';
import { fetchJSON, putJSON, deleteJSON, postFormData, httpErrorMessage } from '@/core/http';
import { videosQuery, videoCategoriesQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as videoContract from '@shared/contracts/video.contract';
import Modal from '../components/react/Modal';
import ModalHeader from '../components/react/ModalHeader';
import styles from './Videos.module.css';

/**
 * Video interface from API
 */
interface Video {
  id: number;
  description: string;
  Video: string;
  Image: string;
  category: number | null;
  details: string | null;
}

/**
 * Video form data for create/edit
 */
interface VideoFormData {
  description: string;
  category: string;
  details: string;
}

/**
 * Video category from API
 */
interface VideoCategory {
  id: number;
  name: string;
}

/**
 * Educational Videos Page
 * Displays videos in a grid with search, filter, and CRUD capabilities
 */
export default function Videos() {
  const toast = useToast();
  const queryClient = useQueryClient();

  // Video list + categories (server state via React Query).
  const { data: videosData, isLoading: loading, error: videosError, refetch } = useQuery(videosQuery());
  const videos = (videosData ?? []) as Video[];
  const error = videosError ? httpErrorMessage(videosError, 'Failed to load videos') : null;
  const { data: categoriesData } = useQuery(videoCategoriesQuery());
  const categories = (categoriesData ?? []) as VideoCategory[];

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string>('');

  // Modals
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const [currentVideo, setCurrentVideo] = useState<Video | null>(null);
  const [isFormModalOpen, setIsFormModalOpen] = useState(false);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [editingVideo, setEditingVideo] = useState<Video | null>(null);
  const [videoToDelete, setVideoToDelete] = useState<Video | null>(null);

  // Form state
  const [formData, setFormData] = useState<VideoFormData>({
    description: '',
    category: '',
    details: '',
  });
  const [videoFile, setVideoFile] = useState<File | null>(null);
  const [thumbnailFile, setThumbnailFile] = useState<File | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // QR Modal state
  const [isQRModalOpen, setIsQRModalOpen] = useState(false);
  const [qrData, setQRData] = useState<{ qr: string; url: string; title: string } | null>(null);
  const [isLoadingQR, setIsLoadingQR] = useState(false);

  // Surface a video-load failure with a toast (categories fail silently, as before).
  useEffect(() => {
    if (videosError) {
      toast.error('Failed to load videos');
    }
  }, [videosError, toast]);

  /**
   * Filter videos based on search and category
   */
  const filteredVideos = videos.filter((video) => {
    const matchesSearch =
      searchQuery === '' ||
      video.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (video.details && video.details.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === '' || video.category?.toString() === selectedCategory;

    return matchesSearch && matchesCategory;
  });

  /**
   * Open video player modal
   */
  const handlePlayVideo = (video: Video) => {
    setCurrentVideo(video);
    setIsPlayerOpen(true);
  };

  /**
   * Close video player modal
   */
  const handleClosePlayer = () => {
    setIsPlayerOpen(false);
    setCurrentVideo(null);
  };

  /**
   * Open add video modal
   */
  const handleAddVideo = () => {
    setEditingVideo(null);
    setFormData({ description: '', category: '', details: '' });
    setVideoFile(null);
    setThumbnailFile(null);
    setIsFormModalOpen(true);
  };

  /**
   * Open edit video modal
   */
  const handleEditVideo = (video: Video) => {
    setEditingVideo(video);
    setFormData({
      description: video.description,
      category: video.category?.toString() || '',
      details: video.details || '',
    });
    setVideoFile(null);
    setThumbnailFile(null);
    setIsFormModalOpen(true);
  };

  /**
   * Open delete confirmation modal
   */
  const handleDeleteClick = (video: Video) => {
    setVideoToDelete(video);
    setIsDeleteModalOpen(true);
  };

  /**
   * Open QR code modal for sharing
   */
  const handleShowQR = async (video: Video) => {
    setIsLoadingQR(true);
    setIsQRModalOpen(true);

    try {
      const data = await fetchJSON<{ qr: string; url: string; title: string }>(
        `/api/videos/${video.id}/qr`,
        { schema: videoContract.qr.response }
      );
      setQRData({
        qr: data.qr,
        url: data.url,
        title: data.title,
      });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to generate QR code'));
      setIsQRModalOpen(false);
    } finally {
      setIsLoadingQR(false);
    }
  };

  /**
   * Close QR modal
   */
  const handleCloseQR = () => {
    setIsQRModalOpen(false);
    setQRData(null);
  };

  /**
   * Copy share URL to clipboard
   */
  const handleCopyUrl = async () => {
    if (!qrData?.url) return;

    try {
      await navigator.clipboard.writeText(qrData.url);
      toast.success('Link copied to clipboard');
    } catch {
      toast.error('Failed to copy link');
    }
  };

  /**
   * Print QR code
   */
  const handlePrintQR = () => {
    if (!qrData) return;

    const printWindow = window.open('', '_blank');
    if (!printWindow) {
      toast.error('Pop-up blocked. Please allow pop-ups.');
      return;
    }

    // Escape server-supplied values (title derives from the user-entered video
    // description) before interpolating into the print-window HTML.
    const esc = (s: string): string =>
      s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const safeTitle = esc(qrData.title);
    const safeUrl = esc(qrData.url);

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR Code - ${safeTitle}</title>
          <style>
            body {
              font-family: Arial, sans-serif;
              display: flex;
              flex-direction: column;
              align-items: center;
              justify-content: center;
              min-height: 100vh;
              margin: 0;
              padding: 20px;
            }
            img { max-width: 300px; margin-bottom: 20px; }
            h2 { margin: 0 0 10px; text-align: center; }
            p { margin: 0; color: #666; font-size: 12px; text-align: center; word-break: break-all; }
            .footer { margin-top: 20px; font-size: 14px; color: #999; }
          </style>
        </head>
        <body>
          <img src="${qrData.qr}" alt="QR Code" />
          <h2>${safeTitle}</h2>
          <p>${safeUrl}</p>
          <p class="footer">Shwan Orthodontics</p>
          <script>window.onload = () => { window.print(); window.close(); }</script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  /**
   * Handle form input changes
   */
  const handleFormChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  /**
   * Handle video file selection
   */
  const handleVideoFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setVideoFile(file);
    }
  };

  /**
   * Handle thumbnail file selection
   */
  const handleThumbnailFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setThumbnailFile(file);
    }
  };

  /**
   * Submit form (create or update)
   */
  const handleSubmitForm = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.description.trim()) {
      toast.error('Description is required');
      return;
    }

    if (!editingVideo && !videoFile) {
      toast.error('Video file is required');
      return;
    }

    setIsSubmitting(true);

    try {
      if (editingVideo) {
        // Update existing video (metadata only)
        await putJSON(`/api/videos/${editingVideo.id}`, {
          description: formData.description,
          category: formData.category,
          details: formData.details,
        });

        toast.success('Video updated successfully');
      } else {
        // Create new video with file upload
        const uploadData = new FormData();
        uploadData.append('video', videoFile!);
        uploadData.append('description', formData.description);
        if (formData.category) uploadData.append('category', formData.category);
        if (formData.details) uploadData.append('details', formData.details);
        if (thumbnailFile) uploadData.append('thumbnail', thumbnailFile);

        await postFormData('/api/videos', uploadData);

        toast.success('Video uploaded successfully');
      }

      setIsFormModalOpen(false);
      queryClient.invalidateQueries({ queryKey: qk.videos.all() });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to save video'));
    } finally {
      setIsSubmitting(false);
    }
  };

  /**
   * Confirm delete
   */
  const handleConfirmDelete = async () => {
    if (!videoToDelete) return;

    try {
      await deleteJSON(`/api/videos/${videoToDelete.id}`);

      toast.success('Video deleted successfully');
      setIsDeleteModalOpen(false);
      setVideoToDelete(null);
      queryClient.invalidateQueries({ queryKey: qk.videos.all() });
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to delete video'));
    }
  };

  return (
    <div className={styles.videosContainer}>
      {/* Header */}
      <div className={styles.videosHeader}>
        <h1>Educational Videos</h1>
        <button className="btn btn-primary" onClick={handleAddVideo}>
          <i className="fas fa-plus"></i> Add Video
        </button>
      </div>

      {/* Search and Filter Bar */}
      <div className={styles.filterBar}>
        <div className={styles.searchBox}>
          <i className="fas fa-search"></i>
          <input
            type="text"
            placeholder="Search videos..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />
        </div>
        <div className={styles.categoryFilter}>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
          >
            <option value="">All Categories</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Error Display */}
      {error && (
        <div className={styles.errorBanner}>
          <p>Error: {error}</p>
          <button onClick={() => void refetch()} className="btn btn-secondary">
            Retry
          </button>
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className={styles.loadingState}>
          <div className={styles.loadingSpinner}></div>
          <p>Loading videos...</p>
        </div>
      )}

      {/* Empty State */}
      {!loading && filteredVideos.length === 0 && (
        <div className={styles.emptyState}>
          <i className="fas fa-video-slash"></i>
          <p>
            {searchQuery || selectedCategory
              ? 'No videos match your filters'
              : 'No videos available'}
          </p>
        </div>
      )}

      {/* Video Grid */}
      {!loading && filteredVideos.length > 0 && (
        <div className={styles.videoGrid}>
          {filteredVideos.map((video) => (
            <div key={video.id} className={styles.videoCard}>
              <div
                className={styles.thumbnailWrapper}
                role="button"
                tabIndex={0}
                onClick={() => handlePlayVideo(video)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handlePlayVideo(video); } }}
              >
                <img
                  src={`/api/videos/${video.id}/thumbnail`}
                  alt={video.description}
                  className={styles.thumbnail}
                  onError={(e) => {
                    (e.target as HTMLImageElement).src =
                      'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxMDAiIGhlaWdodD0iMTAwIj48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSIjZGRkIi8+PHRleHQgeD0iNTAlIiB5PSI1MCUiIGRvbWluYW50LWJhc2VsaW5lPSJtaWRkbGUiIHRleHQtYW5jaG9yPSJtaWRkbGUiIGZvbnQtc2l6ZT0iMTQiIGZpbGw9IiM5OTkiPk5vIFRodW1ibmFpbDwvdGV4dD48L3N2Zz4=';
                  }}
                />
                <div className={styles.playOverlay}>
                  <i className="fas fa-play-circle"></i>
                </div>
              </div>
              <div className={styles.cardContent}>
                <h3 className={styles.videoTitle}>{video.description}</h3>
                {video.category && (
                  <span className={styles.categoryBadge}>
                    {categories.find((c) => c.id === video.category)?.name || `Category ${video.category}`}
                  </span>
                )}
                {video.details && <p className={styles.videoDetails}>{video.details}</p>}
              </div>
              <div className={styles.cardActions}>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleShowQR(video)}
                  title="Share QR Code"
                >
                  <i className="fas fa-qrcode"></i>
                </button>
                <button
                  className={styles.actionBtn}
                  onClick={() => handleEditVideo(video)}
                  title="Edit"
                >
                  <i className="fas fa-edit"></i>
                </button>
                <button
                  className={`${styles.actionBtn} ${styles.deleteBtn}`}
                  onClick={() => handleDeleteClick(video)}
                  title="Delete"
                >
                  <i className="fas fa-trash"></i>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Video Player Modal */}
      {isPlayerOpen && currentVideo && (
        <Modal
          isOpen={true}
          onClose={handleClosePlayer}
          contentClassName={styles.playerModal}
          ariaLabelledBy="video-player-title"
        >
          <div className={styles.playerHeader}>
            <h2 id="video-player-title">{currentVideo.description}</h2>
            <button className={styles.closeBtn} onClick={handleClosePlayer}>
              <i className="fas fa-times"></i>
            </button>
          </div>
          <div className={styles.playerBody}>
            {/* eslint-disable-next-line jsx-a11y/media-has-caption -- user-supplied clinical videos have no caption track */}
            <video
              controls
              autoPlay
              className={styles.videoPlayer}
              src={`/api/videos/${currentVideo.id}/stream`}
            >
              Your browser does not support the video tag.
            </video>
          </div>
        </Modal>
      )}

      {/* Add/Edit Form Modal */}
      {isFormModalOpen && (
        <Modal
          isOpen={true}
          onClose={() => setIsFormModalOpen(false)}
          contentClassName={styles.formModal}
          ariaLabelledBy="video-form-title"
        >
            <ModalHeader
              title={editingVideo ? 'Edit Video' : 'Add New Video'}
              titleId="video-form-title"
              icon={<i className={editingVideo ? 'fas fa-edit' : 'fas fa-plus'} />}
              onClose={() => setIsFormModalOpen(false)}
            />
            <form onSubmit={handleSubmitForm}>
              <div className={styles.modalBody}>
                <div className={styles.formGroup}>
                  <label htmlFor="description">
                    Description <span className={styles.required}>*</span>
                  </label>
                  <input
                    type="text"
                    id="description"
                    name="description"
                    value={formData.description}
                    onChange={handleFormChange}
                    className={styles.formInput}
                    required
                  />
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="category">Category</label>
                  <select
                    id="category"
                    name="category"
                    value={formData.category}
                    onChange={handleFormChange}
                    className={styles.formInput}
                  >
                    <option value="">Select Category</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="details">Details</label>
                  <textarea
                    id="details"
                    name="details"
                    value={formData.details}
                    onChange={handleFormChange}
                    className={styles.formInput}
                    rows={3}
                  />
                </div>

                {!editingVideo && (
                  <>
                    <div className={styles.formGroup}>
                      <label htmlFor="videoFile">
                        Video File <span className={styles.required}>*</span>
                      </label>
                      <input
                        type="file"
                        id="videoFile"
                        accept="video/mp4,video/webm,video/ogg"
                        onChange={handleVideoFileChange}
                        className={styles.fileInput}
                        required
                      />
                      {videoFile && (
                        <p className={styles.fileName}>Selected: {videoFile.name}</p>
                      )}
                    </div>

                    <div className={styles.formGroup}>
                      <label htmlFor="thumbnailFile">Thumbnail (optional)</label>
                      <input
                        type="file"
                        id="thumbnailFile"
                        accept="image/jpeg,image/png"
                        onChange={handleThumbnailFileChange}
                        className={styles.fileInput}
                      />
                      {thumbnailFile && (
                        <p className={styles.fileName}>Selected: {thumbnailFile.name}</p>
                      )}
                    </div>
                  </>
                )}
              </div>

              <div className={styles.modalFooter}>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setIsFormModalOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={isSubmitting}
                >
                  {isSubmitting ? 'Saving...' : editingVideo ? 'Update' : 'Upload'}
                </button>
              </div>
            </form>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && videoToDelete && (
        <Modal
          isOpen={true}
          onClose={() => setIsDeleteModalOpen(false)}
          contentClassName={`${styles.formModal} ${styles.deleteModal}`}
          ariaLabelledBy="video-delete-title"
        >
            <ModalHeader
              title="Delete Video"
              titleId="video-delete-title"
              icon={<i className="fas fa-trash" />}
              variant="danger"
              onClose={() => setIsDeleteModalOpen(false)}
            />
            <div className={styles.modalBody}>
              <p className={styles.warningText}>
                <i className="fas fa-exclamation-triangle"></i> Are you sure you want to
                delete this video?
              </p>
              <p>
                <strong>{videoToDelete.description}</strong>
              </p>
              <p className={styles.deleteWarning}>
                This action cannot be undone. The video file and thumbnail will be
                permanently deleted.
              </p>
            </div>
            <div className={styles.modalFooter}>
              <button
                className="btn btn-secondary"
                onClick={() => setIsDeleteModalOpen(false)}
              >
                Cancel
              </button>
              <button className="btn btn-danger" onClick={handleConfirmDelete}>
                Delete
              </button>
            </div>
        </Modal>
      )}

      {/* QR Code Share Modal */}
      {isQRModalOpen && (
        <Modal
          isOpen={true}
          onClose={handleCloseQR}
          contentClassName={styles.qrModal}
          ariaLabelledBy="video-qr-title"
        >
            <ModalHeader
              title="Share Video"
              titleId="video-qr-title"
              icon={<i className="fas fa-qrcode" />}
              variant="info"
              onClose={handleCloseQR}
            />
            <div className={styles.qrModalBody}>
              {isLoadingQR ? (
                <div className={styles.qrLoading}>
                  <div className={styles.loadingSpinner}></div>
                  <p>Generating QR code...</p>
                </div>
              ) : qrData ? (
                <>
                  <img src={qrData.qr} alt="QR Code" className={styles.qrImage} />
                  <h3 className={styles.qrTitle}>{qrData.title}</h3>
                  <div className={styles.shareUrlContainer}>
                    <input
                      type="text"
                      value={qrData.url}
                      readOnly
                      className={styles.shareUrlInput}
                    />
                    <button
                      className={styles.copyBtn}
                      onClick={handleCopyUrl}
                      title="Copy link"
                    >
                      <i className="fas fa-copy"></i>
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <div className={styles.qrModalFooter}>
              <button className="btn btn-secondary" onClick={handlePrintQR} disabled={!qrData}>
                <i className="fas fa-print"></i> Print
              </button>
              <button className="btn btn-primary" onClick={handleCloseQR}>
                Close
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
