import { useState, useEffect, useCallback } from 'react';
import { useToast } from '../contexts/ToastContext';
import styles from './Videos.module.css';

/**
 * Video interface from API
 */
interface Video {
  ID: number;
  Description: string;
  Video: string;
  Image: string;
  Category: number | null;
  Details: string | null;
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

  // State
  const [videos, setVideos] = useState<Video[]>([]);
  const [categories, setCategories] = useState<VideoCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

  /**
   * Fetch all videos
   */
  const fetchVideos = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const response = await fetch('/api/videos');
      if (!response.ok) throw new Error('Failed to fetch videos');

      const result = await response.json();
      setVideos(result.data || []);
    } catch (err) {
      setError((err as Error).message);
      toast.error('Failed to load videos');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  /**
   * Fetch categories
   */
  const fetchCategories = useCallback(async () => {
    try {
      const response = await fetch('/api/videos/categories');
      if (!response.ok) throw new Error('Failed to fetch categories');

      const result = await response.json();
      setCategories(result.data || []);
    } catch (err) {
      console.error('Failed to fetch categories:', err);
    }
  }, []);

  // Initial data fetch
  useEffect(() => {
    fetchVideos();
    fetchCategories();
  }, [fetchVideos, fetchCategories]);

  /**
   * Filter videos based on search and category
   */
  const filteredVideos = videos.filter((video) => {
    const matchesSearch =
      searchQuery === '' ||
      video.Description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (video.Details && video.Details.toLowerCase().includes(searchQuery.toLowerCase()));

    const matchesCategory =
      selectedCategory === '' || video.Category?.toString() === selectedCategory;

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
      description: video.Description,
      category: video.Category?.toString() || '',
      details: video.Details || '',
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
      const response = await fetch(`/api/videos/${video.ID}/qr`);
      if (!response.ok) throw new Error('Failed to generate QR code');

      const result = await response.json();
      setQRData({
        qr: result.data.qr,
        url: result.data.url,
        title: result.data.title,
      });
    } catch (err) {
      toast.error('Failed to generate QR code');
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

    printWindow.document.write(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>QR Code - ${qrData.title}</title>
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
          <h2>${qrData.title}</h2>
          <p>${qrData.url}</p>
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
        const response = await fetch(`/api/videos/${editingVideo.ID}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: formData.description,
            category: formData.category,
            details: formData.details,
          }),
        });

        if (!response.ok) throw new Error('Failed to update video');

        toast.success('Video updated successfully');
      } else {
        // Create new video with file upload
        const uploadData = new FormData();
        uploadData.append('video', videoFile!);
        uploadData.append('description', formData.description);
        if (formData.category) uploadData.append('category', formData.category);
        if (formData.details) uploadData.append('details', formData.details);
        if (thumbnailFile) uploadData.append('thumbnail', thumbnailFile);

        const response = await fetch('/api/videos', {
          method: 'POST',
          body: uploadData,
        });

        if (!response.ok) throw new Error('Failed to upload video');

        toast.success('Video uploaded successfully');
      }

      setIsFormModalOpen(false);
      fetchVideos();
    } catch (err) {
      toast.error((err as Error).message);
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
      const response = await fetch(`/api/videos/${videoToDelete.ID}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete video');

      toast.success('Video deleted successfully');
      setIsDeleteModalOpen(false);
      setVideoToDelete(null);
      fetchVideos();
    } catch (err) {
      toast.error((err as Error).message);
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
          <button onClick={fetchVideos} className="btn btn-secondary">
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
            <div key={video.ID} className={styles.videoCard}>
              <div
                className={styles.thumbnailWrapper}
                onClick={() => handlePlayVideo(video)}
              >
                <img
                  src={`/api/videos/${video.ID}/thumbnail`}
                  alt={video.Description}
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
                <h3 className={styles.videoTitle}>{video.Description}</h3>
                {video.Category && (
                  <span className={styles.categoryBadge}>
                    {categories.find((c) => c.id === video.Category)?.name || `Category ${video.Category}`}
                  </span>
                )}
                {video.Details && <p className={styles.videoDetails}>{video.Details}</p>}
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
        <div className={styles.modalOverlay} onClick={handleClosePlayer}>
          <div className={styles.playerModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.playerHeader}>
              <h2>{currentVideo.Description}</h2>
              <button className={styles.closeBtn} onClick={handleClosePlayer}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className={styles.playerBody}>
              <video
                controls
                autoPlay
                className={styles.videoPlayer}
                src={`/api/videos/${currentVideo.ID}/stream`}
              >
                Your browser does not support the video tag.
              </video>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Form Modal */}
      {isFormModalOpen && (
        <div className={styles.modalOverlay} onClick={() => setIsFormModalOpen(false)}>
          <div className={styles.formModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>{editingVideo ? 'Edit Video' : 'Add New Video'}</h2>
              <button className={styles.closeBtn} onClick={() => setIsFormModalOpen(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
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
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && videoToDelete && (
        <div className={styles.modalOverlay} onClick={() => setIsDeleteModalOpen(false)}>
          <div
            className={`${styles.formModal} ${styles.deleteModal}`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className={styles.modalHeader}>
              <h2>Delete Video</h2>
              <button className={styles.closeBtn} onClick={() => setIsDeleteModalOpen(false)}>
                <i className="fas fa-times"></i>
              </button>
            </div>
            <div className={styles.modalBody}>
              <p className={styles.warningText}>
                <i className="fas fa-exclamation-triangle"></i> Are you sure you want to
                delete this video?
              </p>
              <p>
                <strong>{videoToDelete.Description}</strong>
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
          </div>
        </div>
      )}

      {/* QR Code Share Modal */}
      {isQRModalOpen && (
        <div className={styles.modalOverlay} onClick={handleCloseQR}>
          <div className={styles.qrModal} onClick={(e) => e.stopPropagation()}>
            <div className={styles.modalHeader}>
              <h2>Share Video</h2>
              <button className={styles.closeBtn} onClick={handleCloseQR}>
                <i className="fas fa-times"></i>
              </button>
            </div>
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
          </div>
        </div>
      )}
    </div>
  );
}
