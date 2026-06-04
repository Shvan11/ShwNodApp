import React, { useState, useEffect, useRef, MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import tpStyles from './TimePointsSelector.module.css';
import styles from './GridComponent.module.css';
import EditTimepointModal from './EditTimepointModal';
import DeleteTimepointModal from './DeleteTimepointModal';
import TimepointActionsMenu, { type DeleteScope, type FolderState } from './TimepointActionsMenu';
import { encodeRelPath } from './files/fileHelpers';
import sseAppointments from '../../services/sse-appointments';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import type { PhotoSwipe as PhotoSwipeInstance } from 'photoswipe/lightbox';
import 'photoswipe/style.css';

interface Props {
    personId?: number | null;
    tpCode?: string;
}

interface GalleryImage {
    name: string;
    width?: number;
    height?: number;
}

interface Timepoint {
    tp_code: string;
    tp_description: string;
    tp_date_time: string;
}

// Legacy shape expected by EditTimepointModal / DeleteTimepointModal (not in this file's edit scope)
interface LegacyTimepoint {
    tpCode: string;
    tpDescription: string;
    tpDateTime: string;
}

const toLegacyTp = (tp: Timepoint): LegacyTimepoint => ({
    tpCode: tp.tp_code,
    tpDescription: tp.tp_description,
    tpDateTime: tp.tp_date_time,
});

interface ImageElement {
    id: string;
    index: number;
    alt: string;
    isLogo?: boolean;
}

interface CachedShareBlob {
    url: string | null;
    blob: Blob | null;
    fetchId: number;
}


const GridComponent = ({ personId, tpCode = '0' }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const [images, setImages] = useState<GalleryImage[]>([]);
    const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
    const [loadingTimepoints, setLoadingTimepoints] = useState(true);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const lightboxRef = useRef<PhotoSwipeLightbox | null>(null);
    // Time-point edit/delete UI state.
    const [menuFor, setMenuFor] = useState<{ tp: Timepoint; x: number; y: number } | null>(null);
    // Originals-folder existence for the open menu (null = still checking).
    const [menuFolder, setMenuFolder] = useState<{ folder: string | null; exists: boolean } | null>(null);
    const menuTpRef = useRef<string | null>(null);
    const [editTp, setEditTp] = useState<LegacyTimepoint | null>(null);
    const [deleteTp, setDeleteTp] = useState<LegacyTimepoint | null>(null);
    const [deleteScope, setDeleteScope] = useState<DeleteScope>('all');
    const [savingTp, setSavingTp] = useState(false);
    const [deletingTp, setDeletingTp] = useState(false);
    // Set of private photo filenames (lowercase) for the CURRENT tpCode.
    // Used both for grid badges and for the PhotoSwipe eye-toggle button.
    const [privateNames, setPrivateNames] = useState<Set<string>>(() => new Set());
    // Ref mirrors privateNames so PhotoSwipe callbacks (outside React) read fresh state.
    const privateNamesRef = useRef<Set<string>>(privateNames);
    privateNamesRef.current = privateNames;
    const componentRef = useRef<HTMLDivElement>(null);
    const isSharingRef = useRef(false);

    // Pre-cached blob for native sharing (mobile only)
    // Stores: { url, blob, fetchId } - fetchId prevents race conditions
    const cachedShareBlobRef = useRef<CachedShareBlob>({ url: null, blob: null, fetchId: 0 });

    // Image elements configuration
    const imageElements: ImageElement[] = [
        { id: 'pf', index: 0, alt: 'Profile' },
        { id: 'fr', index: 1, alt: 'Rest' },
        { id: 'fs', index: 2, alt: 'Smile' },
        { id: 'up', index: 3, alt: 'Upper' },
        { id: 'logo', index: 4, alt: 'Shwan Orthodontics', isLogo: true },
        { id: 'lw', index: 5, alt: 'Lower' },
        { id: 'rt', index: 6, alt: 'Right' },
        { id: 'ct', index: 7, alt: 'Center' },
        { id: 'lf', index: 8, alt: 'Left' }
    ];

    // File name mapping for share
    const fileNameMap: Record<string, string> = {
        'i10': 'Profile.jpg',
        'i12': 'Rest.jpg',
        'i13': 'Smile.jpg',
        'i23': 'Upper.jpg',
        'i24': 'Lower.jpg',
        'i20': 'Right.jpg',
        'i22': 'Center.jpg',
        'i21': 'Left.jpg'
    };

    // Get descriptive filename from image URL
    const getShareFileName = (imageUrl: string): string => {
        const fileName = imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
        const extensionMatch = fileName.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        return fileNameMap[extension] || `patient_${personId}_photo.jpg`;
    };

    // Pre-fetch blob for current slide (called on slide change, mobile only)
    const prefetchBlobForShare = async (imageUrl: string) => {
        // Only pre-fetch if native share is available
        if (!navigator.share || !navigator.canShare) return;

        // Skip logo and placeholder images
        if (imageUrl.includes('logo.png') || imageUrl.includes('placeholder')) return;

        // Increment fetchId to handle race conditions
        const currentFetchId = ++cachedShareBlobRef.current.fetchId;

        // Clear previous cache immediately
        cachedShareBlobRef.current.url = null;
        cachedShareBlobRef.current.blob = null;

        try {
            // Raw image fetch read as a Blob for the native share sheet — not a
            // JSON API call, so it stays on bare fetch().
            // eslint-disable-next-line no-restricted-syntax
            const response = await fetch(imageUrl);
            if (!response.ok) return;

            const blob = await response.blob();

            // Only store if this is still the most recent fetch (race condition check)
            if (currentFetchId === cachedShareBlobRef.current.fetchId) {
                cachedShareBlobRef.current.url = imageUrl;
                cachedShareBlobRef.current.blob = blob;
            }
        } catch {
            // Silent fail - user will see "please wait" message if they try to share
        }
    };

    // Clear cached blob (called on lightbox close and component unmount)
    const clearCachedBlob = () => {
        cachedShareBlobRef.current = { url: null, blob: null, fetchId: 0 };
    };

    // Native share handler - uses pre-cached blob for instant sharing
    // IMPORTANT: Must be synchronous until navigator.share() to preserve user gesture
    const handleNativeShare = (pswp: PhotoSwipeInstance) => {
        if (isSharingRef.current) return;
        isSharingRef.current = true;

        const imageUrl = pswp.currSlide?.data?.src;
        if (!imageUrl) {
            isSharingRef.current = false;
            return;
        }
        const cached = cachedShareBlobRef.current;

        // Check if cached blob matches current slide
        if (cached.url !== imageUrl || !cached.blob) {
            toast.warning('Please wait a moment and try again');
            isSharingRef.current = false;
            return;
        }

        const shareFileName = getShareFileName(imageUrl);
        const file = new File([cached.blob], shareFileName, { type: 'image/jpeg' });

        navigator.share({ files: [file] })
            .catch((err: Error) => {
                if (err.name !== 'AbortError') {
                    toast.error('Failed to share photo');
                }
            })
            .finally(() => {
                isSharingRef.current = false;
            });
    };

    const loadTimepoints = async (): Promise<Timepoint[]> => {
        // Skip loading if personId is not valid
        if (!personId) {
            setLoadingTimepoints(false);
            return [];
        }

        try {
            setLoadingTimepoints(true);
            const data = await fetchJSON<Timepoint[]>(`/api/patients/${personId}/timepoints`);
            setTimepoints(data);
            return data;
        } catch (err) {
            console.error('Error loading timepoints:', err);
            return [];
        } finally {
            setLoadingTimepoints(false);
        }
    };

    const loadGalleryImages = async () => {
        // Skip loading if personId is not valid
        if (!personId) {
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            // Gallery is required (its failure throws → caught below); visibility is
            // best-effort (per-promise .catch → null → no private flags), mirroring
            // the old `if (visibilityRes.ok)` tolerance.
            const [galleryImages, visData] = await Promise.all([
                fetchJSON<GalleryImage[]>(`/api/patients/${personId}/gallery/${tpCode}`),
                fetchJSON<{
                    success: boolean;
                    privateImages?: Array<{ tp: string; name: string }>;
                }>(`/api/patients/${personId}/photos/visibility`).catch(() => null),
            ]);

            setImages(galleryImages);

            if (visData) {
                const names = new Set<string>(
                    (visData.privateImages ?? [])
                        .filter((r) => r.tp === tpCode)
                        .map((r) => r.name.toLowerCase())
                );
                setPrivateNames(names);
            } else {
                setPrivateNames(new Set());
            }
        } catch (err) {
            console.error('Error loading grid:', err);
            setError(httpErrorMessage(err, 'Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    // Toggle a photo's private flag. Called from the PhotoSwipe eye button (outside
    // React's tree), so it reads state from the ref and writes to setPrivateNames.
    const togglePhotoPrivacy = async (fileName: string): Promise<void> => {
        if (!personId) return;
        const lower = fileName.toLowerCase();
        const wasPrivate = privateNamesRef.current.has(lower);
        const nextPrivate = !wasPrivate;
        try {
            await postJSON(`/api/patients/${personId}/photos/visibility`, {
                tp: tpCode,
                name: fileName,
                isPrivate: nextPrivate,
            });
            setPrivateNames((prev) => {
                const next = new Set(prev);
                if (nextPrivate) next.add(lower);
                else next.delete(lower);
                return next;
            });
            toast.success(nextPrivate ? 'Photo hidden from patient' : 'Photo visible to patient');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to update visibility'));
        }
    };

    // Extract the dolphin filename from a URL served via /DolImgs/{name}.
    const getFileNameFromUrl = (imageUrl: string): string => {
        return imageUrl.substring(imageUrl.lastIndexOf('/') + 1);
    };

    const getImageSrc = (element: ImageElement): string => {
        if (element.isLogo) {
            return '/images/logo.png';
        }

        const image = images[element.index];
        if (image && image.name) {
            return `/DolImgs/${image.name}`;
        }

        // Optimized placeholder image (single SVG replaces 3 PNGs: 327KB → 1KB)
        return '/images/placeholder.svg';
    };

    const getImageProps = (element: ImageElement): { width: string; height: string } => {
        if (element.isLogo) {
            return { width: '400', height: '400' };
        }

        const image = images[element.index];
        return {
            width: image?.width?.toString() || '800',
            height: image?.height?.toString() || '600'
        };
    };

    // Initialize PhotoSwipe AFTER images are loaded AND component is mounted
    useEffect(() => {
        let cancelled = false;
        // Only initialize if component is actually mounted and rendered in DOM
        if (!loading && images.length > 0 && componentRef.current) {
            const initPhotoSwipe = async () => {
                try {
                    // Wait a bit to ensure React has finished rendering DOM
                    await new Promise(resolve => setTimeout(resolve, 200));
                    if (cancelled) return;

                    // Check if our component's DOM elements exist (more specific check)
                    const galleryElement = componentRef.current?.querySelector('#dolph_gallery');
                    const links = componentRef.current?.querySelectorAll('#dolph_gallery a');

                    if (!galleryElement || !links || links.length === 0) {
                        return;
                    }

                    // Initialize PhotoSwipe. The lightbox ships via npm and is bundled by
                    // Vite (served from our own origin, fingerprinted — no CDN, no hand-copied
                    // vendor files). Its heavy core is code-split behind a dynamic import() so
                    // it only downloads when a gallery actually mounts.
                    const lightboxInstance = new PhotoSwipeLightbox({
                        gallery: '#dolph_gallery',
                        children: 'a',
                        pswpModule: () => import('photoswipe'),
                        bgOpacity: 0.9,
                        showHideOpacity: true
                    });

                    // Add custom buttons
                    lightboxInstance.on('uiRegister', () => {
                        // Capture the UI registry once: narrowing on lightboxInstance.pswp
                        // resets after each registerElement() call, so a local const keeps it stable.
                        const pswpUi = lightboxInstance.pswp?.ui;
                        if (!pswpUi) return;

                        // Add download button
                        pswpUi.registerElement({
                            name: 'download-button',
                            order: 8,
                            isButton: true,
                            tagName: 'a',

                            html: {
                                isCustomSVG: true,
                                inner: '<path d="M20.5 14.3 17.1 18V10h-2.2v7.9l-3.4-3.6L10 16l6 6.1 6-6.1ZM23 23H9v2h14Z" id="pswp__icn-download"/>',
                                outlineID: 'pswp__icn-download'
                            },

                            onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                el.setAttribute('download', '');
                                el.setAttribute('target', '_blank');
                                el.setAttribute('rel', 'noopener');
                                el.setAttribute('title', 'Download Image');

                                pswp.on('change', () => {
                                    const imageUrl = pswp.currSlide?.data?.src;
                                    if (!imageUrl) return;
                                    el.setAttribute('download', getShareFileName(imageUrl));
                                    (el as HTMLAnchorElement).href = imageUrl;
                                });
                            }
                        });

                        // Add eye-toggle button: staff can mark individual photos as
                        // private (hidden from the patient portal). Reads current
                        // state from privateNamesRef; updates on slide change.
                        pswpUi.registerElement({
                            name: 'visibility-toggle-button',
                            order: 7.5,
                            isButton: true,
                            tagName: 'button',

                            html: {
                                isCustomSVG: true,
                                inner: '<path d="M16 8.5c3.13 0 5.94 1.76 7.31 4.5-1.37 2.74-4.18 4.5-7.31 4.5S10.06 15.74 8.69 13c1.37-2.74 4.18-4.5 7.31-4.5M16 7C11.58 7 7.81 9.75 6 13c1.81 3.25 5.58 6 10 6s8.19-2.75 10-6c-1.81-3.25-5.58-6-10-6zm0 4a2 2 0 110 4 2 2 0 010-4z" id="pswp__icn-eye"/>',
                                outlineID: 'pswp__icn-eye'
                            },

                            onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                const PRIVATE_CLASS = 'pswp__button--visibility-private';
                                const syncButton = () => {
                                    const src = pswp.currSlide?.data?.src;
                                    if (!src) return;
                                    const fileName = getFileNameFromUrl(src);
                                    const isPlaceholder =
                                        src.includes('logo.png') ||
                                        src.includes('placeholder') ||
                                        !/\.i\d+$/i.test(fileName);
                                    if (isPlaceholder) {
                                        el.style.display = 'none';
                                        return;
                                    }
                                    el.style.display = '';
                                    const isPrivate = privateNamesRef.current.has(fileName.toLowerCase());
                                    el.classList.toggle(PRIVATE_CLASS, isPrivate);
                                    el.setAttribute(
                                        'title',
                                        isPrivate ? 'Make visible to patient' : 'Hide from patient'
                                    );
                                    el.setAttribute(
                                        'aria-label',
                                        isPrivate ? 'Make visible to patient' : 'Hide from patient'
                                    );
                                };
                                el.addEventListener('click', async () => {
                                    const src = pswp.currSlide?.data?.src;
                                    if (!src) return;
                                    const fileName = getFileNameFromUrl(src);
                                    if (!/\.i\d+$/i.test(fileName)) return;
                                    await togglePhotoPrivacy(fileName);
                                    syncButton();
                                });
                                pswp.on('change', syncButton);
                                // Initial sync
                                syncButton();
                            }
                        });

                        // Add native share button (mobile only)
                        if ('share' in navigator && 'canShare' in navigator) {
                            pswpUi.registerElement({
                                name: 'native-share-button',
                                order: 8.5,
                                isButton: true,
                                tagName: 'button',

                                html: {
                                    isCustomSVG: true,
                                    inner: '<path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z" id="pswp__icn-share"/>',
                                    outlineID: 'pswp__icn-share'
                                },

                                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                    el.setAttribute('title', 'Share');
                                    el.setAttribute('aria-label', 'Share photo');

                                    el.addEventListener('click', () => handleNativeShare(pswp));
                                }
                            });
                        }

                        // Add send message button (desktop only - mobile uses native share)
                        if (!navigator.share || !navigator.canShare) {
                            pswpUi.registerElement({
                                name: 'send-message-button',
                                order: 9,
                                isButton: true,
                                tagName: 'button',

                                html: {
                                    isCustomSVG: true,
                                    inner: '<path d="M2 21l21-9L2 3v7l15 2-15 2v7z" id="pswp__icn-send"/>',
                                    outlineID: 'pswp__icn-send'
                                },

                                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                                    el.setAttribute('title', 'Send Message');
                                    el.setAttribute('aria-label', 'Send Message');

                                    el.addEventListener('click', async () => {
                                        const imageSrc = pswp.currSlide?.data?.src;
                                        if (!imageSrc) return;

                                        try {
                                            let webPath = imageSrc;
                                            if (imageSrc.includes('://')) {
                                                const url = new URL(imageSrc);
                                                webPath = url.pathname.startsWith('/') ? url.pathname.substring(1) : url.pathname;
                                            }

                                            const { fullPath } = await fetchJSON<{ fullPath: string }>(
                                                `/api/convert-path?path=${encodeURIComponent(webPath)}`
                                            );

                                            // Use actual file path - backend will handle filename conversion
                                            const convertedPath = fullPath;

                                            const sendMessageUrl = `/send-message?file=${encodeURIComponent(convertedPath)}`;
                                            window.open(sendMessageUrl, '_blank');

                                        } catch (error) {
                                            console.error('Error converting path for send message:', error);
                                            toast.error('Failed to convert file path for messaging. Please check the console for details.');
                                        }
                                    });
                                }
                            });
                        }
                    });

                    // Pre-fetch blob for sharing (mobile only)
                    if ('share' in navigator && 'canShare' in navigator) {
                        // Pre-fetch on first slide when lightbox opens
                        lightboxInstance.on('firstUpdate', () => {
                            const pswp = lightboxInstance.pswp;
                            if (pswp?.currSlide?.data?.src) {
                                prefetchBlobForShare(pswp.currSlide.data.src);
                            }
                        });

                        // Pre-fetch on slide change
                        lightboxInstance.on('change', () => {
                            const pswp = lightboxInstance.pswp;
                            if (pswp?.currSlide?.data?.src) {
                                prefetchBlobForShare(pswp.currSlide.data.src);
                            }
                        });

                        // Clear cache when lightbox closes
                        lightboxInstance.on('destroy', () => {
                            clearCachedBlob();
                        });
                    }

                    // Bail before init if this effect run was superseded/unmounted,
                    // so we don't attach handlers or setState on a stale instance.
                    if (cancelled) return;
                    lightboxInstance.init();
                    lightboxRef.current = lightboxInstance;

                } catch (error) {
                    console.error('Failed to initialize PhotoSwipe:', error);
                }
            };

            initPhotoSwipe();
        }

        // This effect solely owns the lightbox lifecycle: its cleanup destroys the
        // instance it created (on deps change or unmount), so there's no second
        // destroyer to double-free it.
        return () => {
            cancelled = true;
            if (lightboxRef.current) {
                lightboxRef.current.destroy();
                lightboxRef.current = null;
            }
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [loading, images]);

    // Load timepoints when component mounts
    useEffect(() => {
        if (personId) {
            loadTimepoints();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId]);

    // Load images when component mounts or dependencies change
    useEffect(() => {
        if (personId) {
            loadGalleryImages();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId, tpCode]);

    // Hold the appointments SSE stream open while this grid is mounted — it also
    // carries `photos_rendered`, fired when a background photo-editor save finishes.
    useEffect(() => {
        void sseAppointments.ensureConnected().catch(() => {
            /* transport errors are surfaced by the appointments connection UI */
        });
        return () => {
            sseAppointments.release();
        };
    }, []);

    // When a background render for THIS patient+timepoint completes, refetch the
    // gallery (and timepoints, in case the save created a brand-new one) so the new
    // photos appear without a manual reload.
    useEffect(() => {
        const onPhotosRendered = (payload: unknown): void => {
            const p = payload as { personId?: number | string; tpCode?: number | string; warnings?: number };
            if (!personId) return;
            if (String(p.personId) !== String(personId) || String(p.tpCode) !== String(tpCode)) return;
            void loadGalleryImages();
            void loadTimepoints();
            if (p.warnings && p.warnings > 0) {
                toast.warning(`${p.warnings} photo(s) had issues while saving.`);
            }
        };
        sseAppointments.on('photos_rendered', onPhotosRendered);
        return () => {
            sseAppointments.off('photos_rendered', onPhotosRendered);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId, tpCode]);

    // Clear cached share blob on unmount. The lightbox instance itself is owned
    // and destroyed by the init effect's cleanup above.
    useEffect(() => {
        return () => {
            clearCachedBlob();
        };
    }, []);

    if (loading) {
        return (
            <div className={styles.loadingSpinner}>
                Loading gallery...
            </div>
        );
    }

    if (error) {
        return (
            <div className={styles.errorMessage}>
                Error: {error}
            </div>
        );
    }

    const formatDate = (dateTime: string): string => {
        if (!dateTime) return '';
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    const handleTimepointClick = (tp: string) => {
        navigate(`/patient/${personId}/photos/tp${tp}`);
    };

    // Open the kebab popover; anchor its right edge near the button (clamped in the menu).
    // The originals-folder existence check runs HERE (only on click), never on list load.
    const openTimepointMenu = (e: ReactMouseEvent<HTMLButtonElement>, tp: Timepoint) => {
        e.stopPropagation();
        const rect = e.currentTarget.getBoundingClientRect();
        setMenuFor({ tp, x: rect.right - 270, y: rect.bottom + 4 });
        setMenuFolder(null);
        menuTpRef.current = tp.tp_code;
        if (personId) {
            fetchJSON<{ folder: string | null; exists: boolean }>(
                `/api/patients/${personId}/timepoints/${tp.tp_code}/folder`
            )
                .then((data) => {
                    // Ignore a stale resolve if another tab's menu was opened meanwhile.
                    if (menuTpRef.current === tp.tp_code) {
                        setMenuFolder(data ?? { folder: null, exists: false });
                    }
                })
                .catch(() => {
                    if (menuTpRef.current === tp.tp_code) setMenuFolder({ folder: null, exists: false });
                });
        }
    };

    // Open the file explorer at the time point's originals folder.
    const handleOpenFolder = () => {
        if (!personId || !menuFolder?.folder) return;
        navigate(`/patient/${personId}/files/${encodeRelPath(menuFolder.folder)}`);
        setMenuFor(null);
    };

    // Open the read-only working-files view (this patient's rendered .iNN images,
    // filtered out of the shared working/ dir). Patient-wide, not per-timepoint.
    const handleOpenWorking = () => {
        if (!personId) return;
        navigate(`/patient/${personId}/working-files`);
        setMenuFor(null);
    };

    // Open the native photo editor for THIS time point (its own name+date, so a
    // re-render resolves to the same timepoint and reuses its originals folder).
    const handleReimport = (tp: Timepoint) => {
        const date = (tp.tp_date_time ?? '').substring(0, 10);
        navigate(
            `/patient/${personId}/photo-editor/tp${tp.tp_code}` +
                `?tpName=${encodeURIComponent(tp.tp_description ?? '')}&date=${date}`
        );
    };

    const handleSaveTimepoint = async (fields: { tpDescription: string; tpDateTime: string }) => {
        if (!personId || !editTp) return;
        setSavingTp(true);
        try {
            await putJSON(`/api/patients/${personId}/timepoints/${editTp.tpCode}`, fields);
            toast.success('Time point updated');
            setEditTp(null);
            await loadTimepoints();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to update time point');
        } finally {
            setSavingTp(false);
        }
    };

    const handleDeleteTimepoint = async () => {
        if (!personId || !deleteTp) return;
        const removed = deleteTp;
        const scope = deleteScope;
        setDeletingTp(true);
        try {
            await deleteJSON(`/api/patients/${personId}/timepoints/${removed.tpCode}?scope=${scope}`);
            toast.success(
                scope === 'cropped'
                    ? 'Cropped photos deleted'
                    : scope === 'entry'
                      ? 'Time point deleted (originals kept)'
                      : 'Time point deleted'
            );
            setDeleteTp(null);
            if (scope === 'cropped') {
                // The time point stays — just refresh the gallery if we're viewing it.
                if (removed.tpCode === tpCode) await loadGalleryImages();
            } else {
                const next = await loadTimepoints();
                // If the active tab was the one removed, move to a remaining timepoint.
                if (removed.tpCode === tpCode) {
                    if (next.length > 0) {
                        navigate(`/patient/${personId}/photos/tp${next[0].tp_code}`);
                    } else {
                        navigate(`/patient/${personId}/photos`);
                    }
                }
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete time point');
        } finally {
            setDeletingTp(false);
        }
    };

    const handleImageMouseEnter = (e: ReactMouseEvent<HTMLImageElement>) => {
        e.currentTarget.style.transform = 'scale(1.05)';
    };

    const handleImageMouseLeave = (e: ReactMouseEvent<HTMLImageElement>) => {
        e.currentTarget.style.transform = 'scale(1)';
    };

    // The gallery array always has 9 slots (missing photos come back as null,
    // plus a logo slot), so "has photos" can't be a length check — it means at
    // least one slot holds a real .iNN image rather than a placeholder.
    const hasRealPhotos = images.some(
        (img) => img && img.name && /\.i\d+$/i.test(img.name)
    );
    // Whether the current tpCode is actually one of this patient's sessions. The
    // sidebar Photos button always points at tp0, which often doesn't exist.
    const selectedTpExists = timepoints.some((tp) => tp.tp_code === tpCode);
    const noSessions = !loadingTimepoints && timepoints.length === 0;

    return (
        <div
            ref={componentRef}
            className={styles.container}
        >
            {/* Timepoints Selector */}
            {!loadingTimepoints && timepoints.length > 0 && (
                <div className={tpStyles.selector}>
                    {timepoints.map((timepoint, index) => (
                        <div
                            key={`tp-${timepoint.tp_code}-${index}`}
                            className={`${tpStyles.tab} ${tpCode === timepoint.tp_code ? tpStyles.tabActive : ''}`}
                        >
                            <button
                                type="button"
                                className={tpStyles.tabNav}
                                onClick={() => handleTimepointClick(timepoint.tp_code)}
                            >
                                <div className={tpStyles.tabIcon}>
                                    <i className="fas fa-camera"></i>
                                </div>
                                <div className={tpStyles.tabContent}>
                                    <div className={tpStyles.tabDesc}>{timepoint.tp_description}</div>
                                    <div className={tpStyles.tabDate}>{formatDate(timepoint.tp_date_time)}</div>
                                </div>
                            </button>
                            <button
                                type="button"
                                className={tpStyles.kebab}
                                aria-label="Time point actions"
                                aria-haspopup="menu"
                                aria-expanded={menuFor?.tp.tp_code === timepoint.tp_code}
                                onClick={(e) => openTimepointMenu(e, timepoint)}
                            >
                                <i className="fas fa-ellipsis-v" aria-hidden="true"></i>
                            </button>
                        </div>
                    ))}
                </div>
            )}

            {!hasRealPhotos ? (
                <div className={styles.emptyState}>
                    <i className="fas fa-camera-retro" aria-hidden="true"></i>
                    <h3>
                        {noSessions
                            ? 'No photos yet'
                            : selectedTpExists
                              ? 'No photos in this session'
                              : 'No photo session selected'}
                    </h3>
                    <p>
                        {noSessions
                            ? 'This patient has no photo sessions yet.'
                            : selectedTpExists
                              ? 'This session has no photos yet.'
                              : 'Select a photo session above to view its photos.'}
                    </p>
                </div>
            ) : (
            <div
                id="dolph_gallery"
                className={`pswp-gallery ${styles.galleryPadded}`}
            >
                {imageElements.map(element => {
                    const imageSrc = getImageSrc(element);
                    const imageProps = getImageProps(element);
                    const image = images[element.index];
                    const showBadge =
                        !element.isLogo && image && image.name && /\.i\d+$/i.test(image.name);
                    const isPrivate = showBadge
                        ? privateNames.has(image!.name.toLowerCase())
                        : false;


                    return (
                        <a
                            key={`dolph_gallery-${element.index}`}
                            id={`a${element.id}`}
                            href={imageSrc}
                            data-pswp-width={imageProps.width}
                            data-pswp-height={imageProps.height}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.galleryCell}
                        >
                            <img
                                id={element.id}
                                src={imageSrc}
                                alt={element.alt}
                                className={`${styles.galleryImage} ${element.isLogo ? styles.logoBorder : ''}`}
                                onMouseEnter={handleImageMouseEnter}
                                onMouseLeave={handleImageMouseLeave}
                            />
                            {showBadge && (
                                <span
                                    className={`${styles.visibilityBadge} ${isPrivate ? styles.visibilityBadgePrivate : ''}`}
                                    title={isPrivate ? 'Hidden from patient' : 'Visible to patient'}
                                    aria-hidden="true"
                                >
                                    <i className={isPrivate ? 'fas fa-eye-slash' : 'fas fa-eye'}></i>
                                </span>
                            )}
                        </a>
                    );
                })}
            </div>
            )}

            {menuFor && (
                <TimepointActionsMenu
                    x={menuFor.x}
                    y={menuFor.y}
                    folderState={
                        (menuFolder === null
                            ? 'checking'
                            : menuFolder.exists
                              ? 'present'
                              : 'absent') satisfies FolderState
                    }
                    onEdit={() => { setEditTp(toLegacyTp(menuFor.tp)); setMenuFor(null); }}
                    onReimport={() => { handleReimport(menuFor.tp); setMenuFor(null); }}
                    onOpenFolder={handleOpenFolder}
                    onOpenWorking={handleOpenWorking}
                    onDelete={(scope) => { setDeleteScope(scope); setDeleteTp(toLegacyTp(menuFor.tp)); setMenuFor(null); }}
                    onClose={() => setMenuFor(null)}
                />
            )}

            <EditTimepointModal
                isOpen={!!editTp}
                timepoint={editTp}
                saving={savingTp}
                onClose={() => setEditTp(null)}
                onSave={handleSaveTimepoint}
            />

            <DeleteTimepointModal
                isOpen={!!deleteTp}
                timepoint={deleteTp}
                scope={deleteScope}
                deleting={deletingTp}
                onConfirm={handleDeleteTimepoint}
                onCancel={() => setDeleteTp(null)}
            />
        </div>
    );
};

export default GridComponent;
