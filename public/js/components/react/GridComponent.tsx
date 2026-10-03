import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { invalidatePatientPhotos } from '@/query/photos';
import { reportClientError, describeHttpError } from '@/core/error-reporter';
import { qk } from '@/query/keys';
import { timepointsQuery, galleryQuery, photoVisibilityQuery, brandingQuery } from '@/query/queries';
import * as patientContract from '@shared/contracts/patient.contract';
import * as utilityContract from '@shared/contracts/utility.contract';
import * as photoEditorContract from '@shared/contracts/photo-editor.contract';
import tpStyles from './TimePointsSelector.module.css';
import styles from './GridComponent.module.css';
import EditTimepointModal from './EditTimepointModal';
import DeleteTimepointModal from './DeleteTimepointModal';
import PhotoSessionDialog from './PhotoSessionDialog';
import TimepointActionsMenu, { type DeleteScope, type FolderState } from './TimepointActionsMenu';
import SessionListMenu from './SessionListMenu';
import ShareSheet from './share/ShareSheet';
import type { ShareSource } from './localsend/LocalSendShareModal';
import { encodeRelPath, buildWorkingContentUrl } from './files/fileHelpers';
import type { PhotoViewCode } from '@shared/photo-views';
import sseAppointments from '../../services/sse-appointments';
import { useDragScroll } from '../../hooks/useDragScroll';
import { rememberPhotoTab } from '../../hooks/useLastPhotoTab';
import PhotoSwipeLightbox from 'photoswipe/lightbox';
import type { PhotoSwipe as PhotoSwipeInstance } from 'photoswipe/lightbox';
import 'photoswipe/style.css';

interface Props {
    personId?: number | null;
    tpCode?: string;
}

// One rendered gallery view (name + pixel size + mtime), keyed by view code in the
// API payload — see patient.contract.ts `gallery`.
type GalleryView = patientContract.GalleryView;

type Timepoint = patientContract.TimepointRow;
type PrivateImages = patientContract.PhotoVisibilityListResponse['privateImages'];

interface GridCell {
    id: string;
    /** The Dolphin view shown in this cell; absent for the centre logo. */
    view?: PhotoViewCode;
    alt: string;
    isLogo?: boolean;
}

// A touch-first device (phone/tablet) gets the OS share sheet in the lightbox; a
// desktop gets *Send Message* (the clinic-WhatsApp page). "Has navigator.share"
// was the old test, and Chrome/Edge on Windows have it, so clinic PCs lost Send
// Message and showed two buttons called "Share" (FE-F12-2).
const isTouchFirst = (): boolean =>
    typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
const canNativeShare = (): boolean => 'share' in navigator && 'canShare' in navigator;

interface CachedShareBlob {
    url: string | null;
    blob: Blob | null;
    fetchId: number;
}

// Anonymize: the three extra-oral views (Profile / Rest / Smile) get a black bar
// over the eyes. The eye position is a heuristic for standard clinical extra-oral
// framing (head cropped roughly crown-to-chin): the eye line sits a bit above the
// vertical centre, so the bar spans the 33%–50% height band, full photo width
// (covers the eye on a profile shot regardless of which way the patient faces).
const EXTRA_ORAL_VIEWS: ReadonlySet<string> = new Set(['i10', 'i12', 'i13']);
const ANON_BAR_TOP = 0.33;    // fraction of photo height where the bar starts
const ANON_BAR_HEIGHT = 0.17; // fraction of photo height the bar covers

// Fullscreen presentation mode: 'native' = element Fullscreen API on the gallery
// wrapper; 'overlay' = CSS fixed-overlay fallback where the API is unavailable
// or refused (e.g. iPhone Safari).
type FsMode = 'off' | 'native' | 'overlay';


const GridComponent = ({ personId, tpCode = '0' }: Props) => {
    const navigate = useNavigate();
    const toast = useToast();
    const queryClient = useQueryClient();
    // Timepoints read on useQuery (loose contract models only tp_code/date/desc;
    // rows carry the full Timepoint shape). A timepoint mutation's invalidation
    // refreshes this live (Phase 3).
    const { data: timepointsData, isLoading: loadingTimepoints } = useQuery({
        ...timepointsQuery(personId ?? ''),
        enabled: !!personId,
    });
    const timepoints: Timepoint[] = timepointsData ?? [];
    // Gallery images for the current timepoint, on useQuery. The gallery drives the
    // grid's loading/error state (the visibility read below is best-effort, exactly
    // as in the prior Promise.all where gallery threw and visibility .catch→null'd).
    // keepPreviousData: a switch to an uncached tab keeps the previous session's grid
    // (and the tab strip) on screen while the new one loads, instead of replacing the
    // whole page with "Loading gallery..." (FE-F12-8a).
    const galleryQ = useQuery({
        ...galleryQuery(personId ?? '', tpCode),
        enabled: !!personId,
        placeholderData: keepPreviousData,
    });
    const visibilityQ = useQuery({ ...photoVisibilityQuery(personId ?? ''), enabled: !!personId });
    const { data: branding } = useQuery(brandingQuery());
    const clinicName = branding?.clinicName?.trim() || '';
    // Gallery keyed by view code ({ i10: {...}|null, … }); null = unrendered slot.
    const gallery = galleryQ.data;
    const loading = !!personId && galleryQ.isLoading;
    const switching = galleryQ.isPlaceholderData;
    const error = galleryQ.error && !gallery ? httpErrorMessage(galleryQ.error, 'Unknown error') : null;
    const lightboxRef = useRef<PhotoSwipeLightbox | null>(null);
    // LocalSend share modal — opened imperatively from the lightbox toolbar.
    const [shareSources, setShareSources] = useState<ShareSource[] | null>(null);
    // Time-point edit/delete UI state.
    const [menuFor, setMenuFor] = useState<{ tp: Timepoint; x: number; y: number } | null>(null);
    // Originals-folder existence for the open menu (null = still checking).
    const [menuFolder, setMenuFolder] = useState<{ folder: string | null; exists: boolean } | null>(null);
    const menuTpRef = useRef<string | null>(null);
    const [editTp, setEditTp] = useState<Timepoint | null>(null);
    const [deleteTp, setDeleteTp] = useState<Timepoint | null>(null);
    // "New session" dialog (also reachable from Navigation + Patient Info).
    const [showNewSession, setShowNewSession] = useState(false);
    const [deleteScope, setDeleteScope] = useState<DeleteScope>('all');
    const [savingTp, setSavingTp] = useState(false);
    const [deletingTp, setDeletingTp] = useState(false);
    // Private (hidden-from-patient) photo names for the CURRENT tpCode, lowercased —
    // derived from the visibility query on every render. A toggle writes the query
    // cache itself (setQueryData), so the marks survive a tab switch; they used to live
    // in local state re-seeded from the mount-time read, and a switch put them back to
    // how they were when the page opened (FE-F12-4).
    const privateNames = new Set(
        (visibilityQ.data?.privateImages ?? [])
            .filter((r) => r.tp === tpCode)
            .map((r) => r.name.toLowerCase())
    );
    // PhotoSwipe's buttons live outside React's tree and run synchronously right after
    // a toggle, so they read the CACHE (always current), not a render-time snapshot.
    const isPrivateNow = (fileName: string): boolean =>
        (queryClient.getQueryData<{ privateImages: PrivateImages }>(qk.patient.photoVisibility(personId ?? ''))
            ?.privateImages ?? []
        ).some((r) => r.tp === tpCode && r.name.toLowerCase() === fileName.toLowerCase());
    const componentRef = useRef<HTMLDivElement>(null);
    const isSharingRef = useRef(false);

    // Anonymize toggle (session-local, never persisted). Ref mirror so PhotoSwipe
    // callbacks (outside React's tree) read fresh state.
    const [anonymize, setAnonymize] = useState(false);
    const anonymizeRef = useRef(anonymize);
    useEffect(() => {
        anonymizeRef.current = anonymize;
    }, [anonymize]);

    // Fullscreen presentation mode. The wrapper div (controls + grid only) is the
    // fullscreen element, so the rest of the app disappears; the ref mirror lets
    // the lightbox-creation effect pick the right appendToEl without re-running.
    const [fsMode, setFsMode] = useState<FsMode>('off');
    const fsActive = fsMode !== 'off';
    const fsModeRef = useRef(fsMode);
    useEffect(() => {
        fsModeRef.current = fsMode;
    }, [fsMode]);
    const fsWrapRef = useRef<HTMLDivElement>(null);

    const enterFullscreen = () => {
        const el = fsWrapRef.current;
        if (!el) return;
        if (el.requestFullscreen) {
            // Success is observed via the fullscreenchange listener below;
            // rejection (permission / unsupported) falls back to the CSS overlay.
            el.requestFullscreen().catch(() => setFsMode('overlay'));
        } else {
            setFsMode('overlay');
        }
    };

    const exitFullscreen = () => {
        if (document.fullscreenElement) {
            void document.exitFullscreen().catch(() => { /* already exiting */ });
        }
        setFsMode('off');
    };

    // Track native fullscreen transitions (Esc, browser UI, or our own calls).
    useEffect(() => {
        const onFsChange = () => {
            const native = !!document.fullscreenElement && document.fullscreenElement === fsWrapRef.current;
            setFsMode((prev) => (native ? 'native' : prev === 'native' ? 'off' : prev));
        };
        document.addEventListener('fullscreenchange', onFsChange);
        return () => document.removeEventListener('fullscreenchange', onFsChange);
    }, []);

    // Escape exits the CSS-overlay fallback (native mode gets this from the
    // browser). Skipped while the lightbox is open so Esc closes that first.
    useEffect(() => {
        if (fsMode !== 'overlay') return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'Escape') return;
            if (document.querySelector('.pswp--open')) return;
            setFsMode('off');
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [fsMode]);

    // Pre-cached blob for native sharing (mobile only)
    // Stores: { url, blob, fetchId } - fetchId prevents race conditions
    const cachedShareBlobRef = useRef<CachedShareBlob>({ url: null, blob: null, fetchId: 0 });

    // 3×3 layout (logo in the centre), each cell bound to its Dolphin view code —
    // matches the photo-editor's GRID_CELLS. No positional coupling to the payload.
    const gridCells: GridCell[] = [
        { id: 'pf', view: 'i10', alt: 'Profile' },
        { id: 'fr', view: 'i12', alt: 'Rest' },
        { id: 'fs', view: 'i13', alt: 'Smile' },
        { id: 'up', view: 'i23', alt: 'Upper' },
        { id: 'logo', alt: clinicName, isLogo: true },
        { id: 'lw', view: 'i24', alt: 'Lower' },
        { id: 'rt', view: 'i20', alt: 'Right' },
        { id: 'ct', view: 'i22', alt: 'Center' },
        { id: 'lf', view: 'i21', alt: 'Left' }
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
        // Drop any `?v=` cache-bust token before parsing the extension.
        const fileName = imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0];
        const extensionMatch = fileName.match(/\.([^.]+)$/);
        const extension = extensionMatch ? extensionMatch[1] : '';
        return fileNameMap[extension] || `patient_${personId}_photo.jpg`;
    };

    // Pre-fetch blob for current slide (called on slide change, mobile only)
    const prefetchBlobForShare = async (imageUrl: string) => {
        // Only pre-fetch where the lightbox offers the native share button.
        if (!canNativeShare() || !isTouchFirst()) return;

        // Only real Dolphin renders.
        if (!/\.i\d+$/i.test(getFileNameFromUrl(imageUrl))) return;

        // Increment fetchId to handle race conditions
        const currentFetchId = ++cachedShareBlobRef.current.fetchId;

        // Clear previous cache immediately
        cachedShareBlobRef.current.url = null;
        cachedShareBlobRef.current.blob = null;

        try {
            // eslint-disable-next-line no-restricted-syntax -- a raw image read as a Blob for the native share sheet, not a JSON API call
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

    // Toggle a photo's private flag. Called from the PhotoSwipe eye button (outside
    // React's tree), so it reads and writes the visibility query's cache directly.
    const togglePhotoPrivacy = async (fileName: string): Promise<void> => {
        if (!personId) return;
        const lower = fileName.toLowerCase();
        const nextPrivate = !isPrivateNow(fileName);
        try {
            await postJSON(`/api/patients/${personId}/photos/visibility`, {
                tp: tpCode,
                name: fileName,
                isPrivate: nextPrivate,
            });
            // Write the stored state into the cache: the grid re-renders from it, and the
            // lightbox button's immediate re-sync reads it synchronously.
            queryClient.setQueryData<{ privateImages: PrivateImages }>(
                qk.patient.photoVisibility(personId),
                (old) => {
                    const rest = (old?.privateImages ?? []).filter(
                        (r) => !(r.tp === tpCode && r.name.toLowerCase() === lower)
                    );
                    return { privateImages: nextPrivate ? [...rest, { tp: tpCode, name: fileName }] : rest };
                }
            );
            toast.success(nextPrivate ? 'Photo hidden from patient' : 'Photo visible to patient');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to update visibility'));
        }
    };

    // Extract the dolphin filename from a URL served via /DolImgs/{name}.
    const getFileNameFromUrl = (imageUrl: string): string => {
        // Strip any `?v=` cache-bust token so callers see the bare `….iNN` name.
        return imageUrl.substring(imageUrl.lastIndexOf('/') + 1).split('?')[0];
    };

    // The rendered view shown in a cell (null for the logo or an unrendered slot).
    const cellImage = (cell: GridCell): GalleryView | null =>
        cell.view ? gallery?.[cell.view] ?? null : null;

    // Full-resolution Dolphin render — the LIGHTBOX target and the source for every
    // share / download / send-message action. Cache-busted by mtime.
    const fullResUrl = (image: GalleryView): string => `/DolImgs/${image.name}?v=${image.mtime}`;

    // Lightweight WebP thumbnail for the grid CELL only (the lightbox still opens the
    // full-res image above). Reuses the disk-cached working-file thumbnail endpoint;
    // `v=mtime` busts the browser cache when a slot is re-rendered to the same name.
    const thumbUrl = (image: GalleryView): string =>
        personId
            ? buildWorkingContentUrl(personId, image.name, { thumb: 480, v: image.mtime })
            : fullResUrl(image);

    // Initialize PhotoSwipe once the gallery is on screen. This effect runs after the
    // gallery DOM is committed, so the anchors already exist when there are real
    // photos — no timing hack needed; it just bails when the empty state is shown.
    useEffect(() => {
        if (!gallery || !componentRef.current) return;
        const links = componentRef.current.querySelectorAll('#dolph_gallery a');
        if (links.length === 0) return;

        // The lightbox ships via npm, bundled by Vite (our own origin, fingerprinted —
        // no CDN). Its heavy core is code-split behind a dynamic import() so it only
        // downloads when a gallery actually mounts.
        const lightboxInstance = new PhotoSwipeLightbox({
            gallery: '#dolph_gallery',
            children: 'a',
            pswpModule: () => import('photoswipe'),
            bgOpacity: 0.9,
            showHideOpacity: true,
            // While the gallery wrapper is the native-fullscreen element, the
            // lightbox must mount INSIDE it — anything appended to document.body
            // sits under the top-layer fullscreen element and is invisible.
            // (The fsMode effect below keeps this in sync on later toggles.)
            appendToEl: fsModeRef.current === 'native' && fsWrapRef.current ? fsWrapRef.current : undefined,
            // The LocalSend share modal opens OVER the still-open lightbox
            // (portaled into #modal-root, z-index above pswp). PhotoSwipe's
            // default focus trap (trapFocus:true) installs a focusin handler
            // that yanks focus back into the lightbox whenever it lands
            // outside — which kills typing in the modal's IP / PIN inputs.
            // Disable it; Esc/arrow keys are bound to document and still work,
            // and the modal carries its own Tab focus-trap.
            // Trade-off (accepted): the lightbox itself loses keyboard
            // focus-containment (a keyboard user could Tab out to background
            // controls), and while the share modal is open arrow/Esc keys can
            // still reach the lightbox underneath. Fine for this mouse-driven
            // internal tool; the alternative was closing the lightbox on share.
            trapFocus: false
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
            // state from the visibility cache; updates on slide change.
            pswpUi.registerElement({
                name: 'visibility-toggle-button',
                order: 7.5,
                isButton: true,
                tagName: 'button',

                // Plain FontAwesome icon (not pswp's SVG) so the lightbox shows the SAME
                // eye / eye-slash glyphs as the grid badge — syncButton swaps the shape
                // and the red tint together, so "hidden" looks identical everywhere.
                html: '<i class="fas fa-eye" aria-hidden="true"></i>',

                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                    const PRIVATE_CLASS = 'pswp__button--visibility-private';
                    el.classList.add('pswp__visibility-btn');
                    const syncButton = () => {
                        const src = pswp.currSlide?.data?.src;
                        if (!src) return;
                        const fileName = getFileNameFromUrl(src);
                        if (!/\.i\d+$/i.test(fileName)) {
                            el.style.display = 'none';
                            return;
                        }
                        el.style.display = '';
                        const isPrivate = isPrivateNow(fileName);
                        el.classList.toggle(PRIVATE_CLASS, isPrivate);
                        const icon = el.querySelector('i');
                        if (icon) icon.className = isPrivate ? 'fas fa-eye-slash' : 'fas fa-eye';
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

            // Native share button (touch-first devices only — see isTouchFirst).
            if (canNativeShare() && isTouchFirst()) {
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

            // Send Message button (desktop — touch-first devices use the native share).
            if (!(canNativeShare() && isTouchFirst())) {
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
                                // Drop any `?v=` cache-bust token before path conversion.
                                webPath = webPath.split('?')[0];

                                const { fullPath } = await fetchJSON<{ fullPath: string }>(
                                    `/api/convert-path?path=${encodeURIComponent(webPath)}`,
                                    { schema: utilityContract.convertPath.response }
                                );

                                // Use actual file path - backend will handle filename conversion
                                const convertedPath = fullPath;

                                const sendMessageUrl = `/send-message?file=${encodeURIComponent(convertedPath)}`;
                                window.open(sendMessageUrl, '_blank');

                            } catch (error) {
                                // Event-handler failure (PhotoSwipe button, outside React's tree)
                                // — ship it to Winston instead of a console the prod build silences.
                                reportClientError({
                                    source: 'window-error',
                                    message: `Send-message path conversion failed: ${error instanceof Error ? error.message : String(error)}`,
                                    stack: error instanceof Error ? error.stack : undefined,
                                    ...describeHttpError(error),
                                });
                                toast.error(httpErrorMessage(error, 'Failed to prepare the image for messaging.'));
                            }
                        });
                    }
                });
            }

            // Add LocalSend share button — push the current photo to a LAN
            // device (phone/tablet/PC) without WhatsApp or a USB stick.
            pswpUi.registerElement({
                name: 'localsend-share-button',
                order: 9.5,
                isButton: true,
                tagName: 'button',

                html: {
                    isCustomSVG: true,
                    inner: '<path d="M21 11a3 3 0 0 0-2.6 1.5l-5.5-2.8a3 3 0 0 0 0-1.4l5.5-2.8A3 3 0 1 0 17.5 7L12 9.8a3 3 0 1 0 0 6.4l5.5 2.8A3 3 0 1 0 21 11z" id="pswp__icn-localsend"/>',
                    outlineID: 'pswp__icn-localsend'
                },

                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                    // Its own name: the OS share button above is "Share" (FE-F12-2).
                    el.setAttribute('title', 'Send to a device or Telegram');
                    el.setAttribute('aria-label', 'Send to a device or Telegram');

                    el.addEventListener('click', () => {
                        const src = pswp.currSlide?.data?.src;
                        if (!src || !personId) return;
                        const fileName = getFileNameFromUrl(src);
                        // Only real Dolphin views.
                        if (!/\.i\d+$/i.test(fileName)) return;
                        setShareSources([{
                            source: 'patient-image',
                            personId,
                            ref: fileName,
                            displayName: getShareFileName(src)
                        }]);
                    });
                }
            });
        });

        // Anonymize inside the lightbox too — otherwise clicking a barred photo
        // while presenting would reveal the eyes full-screen. The slide's
        // .pswp__zoom-wrap is auto-sized (its img child is absolutely positioned),
        // so %-based geometry resolves to 0; instead the bar is (re)positioned in
        // displayed-image PIXELS on every imageSizeChange (initial load, zoom
        // level change, resize). Mid-gesture the wrap's pan/zoom transform carries
        // the bar in sync automatically.
        lightboxInstance.on('imageSizeChange', ({ slide, width, height }) => {
            const container = slide?.container;
            if (!container) return;
            const fileName = getFileNameFromUrl(slide.data?.src ?? '');
            const view = fileName.match(/\.(i\d+)$/i)?.[1]?.toLowerCase();
            const wanted = anonymizeRef.current && !!view && EXTRA_ORAL_VIEWS.has(view);
            let bar = container.querySelector<HTMLDivElement>('.pswp__anon-bar');
            if (!wanted) {
                bar?.remove();
                return;
            }
            if (!bar) {
                bar = document.createElement('div');
                bar.className = 'pswp__anon-bar';
                container.appendChild(bar);
            }
            bar.style.top = `${Math.round(height * ANON_BAR_TOP)}px`;
            bar.style.width = `${Math.round(width)}px`;
            bar.style.height = `${Math.round(height * ANON_BAR_HEIGHT)}px`;
        });

        // Pre-fetch the current slide's blob for the native share sheet (touch-first only).
        if (canNativeShare() && isTouchFirst()) {
            lightboxInstance.on('firstUpdate', () => {
                const src = lightboxInstance.pswp?.currSlide?.data?.src;
                if (src) prefetchBlobForShare(src);
            });
            lightboxInstance.on('change', () => {
                const src = lightboxInstance.pswp?.currSlide?.data?.src;
                if (src) prefetchBlobForShare(src);
            });
            lightboxInstance.on('destroy', () => clearCachedBlob());
        }

        lightboxInstance.init();
        lightboxRef.current = lightboxInstance;

        // This effect solely owns the lightbox lifecycle: its cleanup destroys the
        // instance it created (on deps change or unmount), so nothing double-frees it.
        return () => {
            lightboxInstance.destroy();
            lightboxRef.current = null;
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [gallery]);

    // Keep the lightbox's mount target in step with fullscreen toggles. Options
    // are read afresh on every open (each open constructs a new PhotoSwipe core),
    // so mutating them here applies to the next click without a rebuild.
    useEffect(() => {
        const lb = lightboxRef.current;
        if (!lb) return;
        lb.options.appendToEl = fsMode === 'native' && fsWrapRef.current ? fsWrapRef.current : undefined;
    }, [fsMode]);

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
    // (A render from ANOTHER tab or desk; the saving tab's photo-render-watch already
    // invalidates.) Any session of this patient: the gallery keys are all prefixed by
    // `galleryAll`, and only the mounted ones refetch.
    useEffect(() => {
        const onPhotosRendered = (payload: unknown): void => {
            const p = photoEditorContract.renderedEvent.safeParse(payload);
            if (!personId || !p.success || String(p.data.personId) !== String(personId)) return;
            void invalidatePatientPhotos(personId);
            // Outcome toasts (success / warnings / timeout) are owned by the
            // saving tab's photo-render-watch module — toasting here too would
            // double-notify when the user is parked on this grid.
        };
        sseAppointments.on('photos_rendered', onPhotosRendered);
        return () => {
            sseAppointments.off('photos_rendered', onPhotosRendered);
        };
    }, [personId]);

    // Clear cached share blob on unmount. The lightbox instance itself is owned
    // and destroyed by the init effect's cleanup above.
    useEffect(() => {
        return () => {
            clearCachedBlob();
        };
    }, []);

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
                `/api/patients/${personId}/timepoints/${tp.tp_code}/folder`,
                { schema: patientContract.timepointFolder.response }
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
        // By code alone: the editor takes the session's name and date from the
        // timepoints read, so a URL can never carry a stale pair (FE-F14-3).
        navigate(`/patient/${personId}/photo-editor/tp${tp.tp_code}`);
    };

    const handleSaveTimepoint = async (fields: { tpDescription: string; tpDateTime: string }) => {
        if (!personId || !editTp) return;
        setSavingTp(true);
        try {
            await putJSON(`/api/patients/${personId}/timepoints/${editTp.tp_code}`, fields);
            // The rename moved the originals folder too, so the Files tree is stale as
            // well as the tabs (FE-F12-3b). One invalidation, one refetch (FE-F12-12).
            await invalidatePatientPhotos(personId);
            toast.success('Time point updated');
            setEditTp(null);
        } catch (err) {
            // The server's reason ("A folder named … already exists", "Name cannot
            // contain path characters"), not the funnel's status line (FE-F12-12).
            toast.error(httpErrorMessage(err, 'Failed to update time point'));
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
            await deleteJSON(`/api/patients/${personId}/timepoints/${removed.tp_code}?scope=${scope}`);
            // Every session's gallery, not just the one on screen: a cropped delete of
            // another tab used to leave its photos cached and shown (FE-F12-3a).
            await invalidatePatientPhotos(personId);
            toast.success(
                scope === 'cropped'
                    ? 'Cropped photos deleted'
                    : scope === 'entry'
                      ? 'Time point deleted (originals kept)'
                      : 'Time point deleted'
            );
            setDeleteTp(null);
            if (scope !== 'cropped' && removed.tp_code === tpCode) {
                // The active tab was the one removed: move to a remaining session (the
                // invalidation above has already refetched the list).
                const next = queryClient.getQueryData<Timepoint[]>(qk.patient.timepoints(personId)) ?? [];
                navigate(next.length > 0 ? `/patient/${personId}/photos/tp${next[0].tp_code}` : `/patient/${personId}/photos`);
            }
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to delete time point'));
        } finally {
            setDeletingTp(false);
        }
    };

    // Hover/focus lift is now pure CSS (.galleryImage:hover / :focus-visible).

    // The gallery is keyed by view code with `null` for unrendered slots, so "has
    // photos" means at least one view actually resolved to a rendered image.
    const hasRealPhotos = !!gallery && Object.values(gallery).some(Boolean);
    // Whether the current tpCode is actually one of this patient's sessions. The
    // sidebar Photos button points at tp0 until a session has been viewed, and tp0
    // often doesn't exist.
    const selectedTpExists = timepoints.some((tp) => tp.tp_code === tpCode);
    const noSessions = !loadingTimepoints && timepoints.length === 0;

    // The sidebar's Photos button reopens whichever real session was last on screen.
    useEffect(() => {
        if (personId && selectedTpExists) rememberPhotoTab(personId, tpCode);
    }, [personId, tpCode, selectedTpExists]);

    // A long session strip scrolls by mouse drag as well as by its scrollbar.
    const tabStripRef = useRef<HTMLDivElement>(null);
    const tabStripDrag = useDragScroll(tabStripRef);
    // The "All sessions" list is offered only while the strip overflows. Observing
    // the tabs too (not just the strip) catches a width change the strip's own size
    // doesn't show: a rename, or the webfont arriving after first layout. Showing the
    // button only narrows the strip, so it can never flip itself back off.
    const [stripOverflows, setStripOverflows] = useState(false);
    useEffect(() => {
        const strip = tabStripRef.current;
        if (!strip) return;
        const ro = new ResizeObserver(() => setStripOverflows(strip.scrollWidth > strip.clientWidth + 1));
        ro.observe(strip);
        for (const child of strip.children) ro.observe(child);
        return () => ro.disconnect();
    }, [timepointsData]);

    // Bring the active tab into view when it is off-screen — on arrival (a remembered
    // session can sit far down the strip), after a click on a half-hidden tab, and
    // once the "All sessions" button appears and narrows the strip under it.
    useEffect(() => {
        const strip = tabStripRef.current;
        const active = strip?.querySelector<HTMLElement>('[aria-current="true"]')?.parentElement;
        if (!strip || !active) return;
        const s = strip.getBoundingClientRect();
        const a = active.getBoundingClientRect();
        if (a.left >= s.left && a.right <= s.right) return;
        strip.scrollLeft += a.left - s.left - (s.width - a.width) / 2;
    }, [tpCode, timepointsData, stripOverflows]);

    const [sessionList, setSessionList] = useState<{ x: number; y: number } | null>(null);

    // ← / → step to the previous / next session, in strip order (mirrored if the
    // page is ever RTL). Stays out of the way of anything else that owns the arrows:
    // typing, a menu or dialog (the session list, the kebab menu, a modal), the
    // lightbox (its own prev/next photo), a held modifier (Alt+← is browser Back),
    // and key-repeat — one session per press, not a burst of gallery loads.
    useEffect(() => {
        if (!personId || !timepointsData?.length) return;
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
            if (e.defaultPrevented || e.repeat || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
            if (document.querySelector('.pswp--open') || document.getElementById('modal-root')?.childElementCount) return;
            const focused = document.activeElement;
            if (
                focused instanceof HTMLElement &&
                (focused.isContentEditable ||
                    focused.closest('input, textarea, select, [role="menu"], [role="dialog"], [role="listbox"], [role="slider"]'))
            ) {
                return;
            }
            const forward = (e.key === 'ArrowRight') !== (document.documentElement.dir === 'rtl');
            const i = timepointsData.findIndex((tp) => tp.tp_code === tpCode);
            const next = i === -1 ? 0 : i + (forward ? 1 : -1);
            if (next < 0 || next >= timepointsData.length) return;
            e.preventDefault();
            navigate(`/patient/${personId}/photos/tp${timepointsData[next].tp_code}`);
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [personId, tpCode, timepointsData, navigate]);

    return (
        <div
            ref={componentRef}
            className={styles.container}
        >
            {/* Timepoints Selector */}
            {!loadingTimepoints && timepoints.length > 0 && (
                <div className={tpStyles.bar}>
                    {stripOverflows && (
                        <button
                            type="button"
                            className={tpStyles.allSessions}
                            aria-label="All sessions"
                            aria-haspopup="menu"
                            aria-expanded={!!sessionList}
                            title={`All sessions (${timepoints.length})`}
                            // While open, the press that would close it via the menu's
                            // outside-mousedown is kept from it, so the click below can
                            // toggle it shut instead of closing and instantly reopening it.
                            onMouseDown={(e) => {
                                if (sessionList) e.stopPropagation();
                            }}
                            onClick={(e) => {
                                if (sessionList) {
                                    setSessionList(null);
                                    return;
                                }
                                const rect = e.currentTarget.getBoundingClientRect();
                                setSessionList({ x: rect.left, y: rect.bottom + 4 });
                            }}
                        >
                            <i className="fas fa-bars" aria-hidden="true"></i>
                        </button>
                    )}
                    <div ref={tabStripRef} className={tpStyles.selector} {...tabStripDrag}>
                        {timepoints.map((timepoint, index) => (
                            <div
                                key={`tp-${timepoint.tp_code}-${index}`}
                                className={`${tpStyles.tab} ${tpCode === timepoint.tp_code ? tpStyles.tabActive : ''}`}
                            >
                                <button
                                    type="button"
                                    className={tpStyles.tabNav}
                                    aria-current={tpCode === timepoint.tp_code ? 'true' : undefined}
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
                                    aria-label="Photo session actions"
                                    aria-haspopup="menu"
                                    aria-expanded={menuFor?.tp.tp_code === timepoint.tp_code}
                                    onClick={(e) => openTimepointMenu(e, timepoint)}
                                >
                                    <i className="fas fa-ellipsis-v" aria-hidden="true"></i>
                                </button>
                            </div>
                        ))}
                        <button
                            type="button"
                            className={tpStyles.addTab}
                            onClick={() => setShowNewSession(true)}
                        >
                            <i className="fas fa-plus" aria-hidden="true"></i>
                            <span>New session</span>
                        </button>
                    </div>
                </div>
            )}

            {/* Loading and errors replace the grid only — the session tabs above stay,
                so a slow or failed tab is never a dead end (FE-F12-8). */}
            {loading ? (
                <div className={styles.loadingSpinner}>Loading gallery...</div>
            ) : error ? (
                <div className={styles.errorMessage} role="alert">
                    <p>Couldn't load this session's photos: {error}</p>
                    <button type="button" className="btn btn-secondary" onClick={() => void galleryQ.refetch()}>
                        <i className="fas fa-redo" aria-hidden="true"></i> Retry
                    </button>
                </div>
            ) : !hasRealPhotos ? (
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
                    {noSessions && (
                        <button
                            type="button"
                            className="btn btn-primary"
                            onClick={() => setShowNewSession(true)}
                        >
                            <i className="fas fa-plus" aria-hidden="true"></i> New Photo Session
                        </button>
                    )}
                </div>
            ) : (
            <div
                ref={fsWrapRef}
                className={[
                    styles.fsWrapper,
                    fsActive ? styles.fsActive : '',
                    fsMode === 'overlay' ? styles.fsOverlay : '',
                ].filter(Boolean).join(' ')}
            >
            <div className={styles.layoutControls}>
                <button
                    type="button"
                    className={`${styles.layoutToolBtn} ${anonymize ? styles.layoutToolBtnActive : ''}`}
                    onClick={() => setAnonymize((a) => !a)}
                    aria-pressed={anonymize}
                    title={anonymize ? 'Remove the eye bars' : 'Anonymize — cover the eyes on extra-oral photos'}
                    aria-label={anonymize ? 'Remove the eye bars' : 'Anonymize extra-oral photos'}
                >
                    <i className="fas fa-user-secret" aria-hidden="true"></i>
                </button>
                <button
                    type="button"
                    className={styles.layoutToolBtn}
                    onClick={fsActive ? exitFullscreen : enterFullscreen}
                    title={fsActive ? 'Exit full screen' : 'Full screen'}
                    aria-label={fsActive ? 'Exit full screen' : 'View layout full screen'}
                >
                    <i className={`fas ${fsActive ? 'fa-compress' : 'fa-expand'}`} aria-hidden="true"></i>
                </button>
            </div>
            <div
                id="dolph_gallery"
                className={`pswp-gallery ${styles.galleryPadded}`}
                aria-busy={switching || undefined}
            >
                {gridCells.map((cell) => {
                    // Centre cell — THIS install's logo (Settings → General), or its name
                    // when no logo is set. It used to be a file in the repository with this
                    // clinic's name as alt text, on every install (FE-F12-7). Not a lightbox
                    // slide: an uploaded logo's size is unknown, and a slideshow of the
                    // patient's photos does not need it.
                    if (cell.isLogo) {
                        return (
                            <div key={`dolph_gallery-${cell.id}`} className={styles.logoCell}>
                                {branding?.logo ? (
                                    <img
                                        id={cell.id}
                                        src={branding.logo}
                                        alt={clinicName}
                                        decoding="async"
                                        className={`${styles.galleryImage} ${styles.logoBorder}`}
                                    />
                                ) : (
                                    <span className={styles.logoName}>{clinicName}</span>
                                )}
                            </div>
                        );
                    }

                    const image = cellImage(cell);

                    // Absent slot — a theme-aware placeholder (icon + view name), NOT a
                    // lightbox target. Rendered as a <div> so PhotoSwipe (children:'a')
                    // skips it and dark mode no longer shows a baked light-grey SVG; the
                    // view name doubles as a "which photo is missing" hint.
                    if (!image) {
                        return (
                            <div
                                key={`dolph_gallery-${cell.id}`}
                                className={styles.placeholderCell}
                            >
                                <i className="fas fa-image" aria-hidden="true"></i>
                                <span className={styles.placeholderLabel}>{cell.alt}</span>
                            </div>
                        );
                    }

                    // Real photo — a lightbox anchor. The grid cell shows the light WebP
                    // thumbnail; the anchor (the lightbox target) points at the full-res
                    // render. The view-type caption fades in on hover / keyboard focus.
                    // A badge marks ONLY photos hidden from the patient — visible photos
                    // stay unmarked for a cleaner grid; visibility is toggled in the lightbox.
                    const isHidden = privateNames.has(image.name.toLowerCase());

                    // Anonymize bar: an SVG whose viewBox is the photo's natural size and
                    // preserveAspectRatio="xMidYMid meet" — the exact geometry of the
                    // img's object-fit: contain — so the rect lands on the photo itself,
                    // letterboxing included, with zero layout measurement.
                    const showAnonBar = anonymize && !!cell.view && EXTRA_ORAL_VIEWS.has(cell.view);

                    return (
                        <a
                            key={`dolph_gallery-${cell.id}`}
                            id={`a${cell.id}`}
                            href={fullResUrl(image)}
                            data-pswp-width={image.width ?? 800}
                            data-pswp-height={image.height ?? 600}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.galleryCell}
                        >
                            <img
                                id={cell.id}
                                src={thumbUrl(image)}
                                alt={cell.alt}
                                decoding="async"
                                className={styles.galleryImage}
                            />
                            {showAnonBar && (
                                <svg
                                    className={styles.anonBar}
                                    viewBox={`0 0 ${image.width} ${image.height}`}
                                    preserveAspectRatio="xMidYMid meet"
                                    aria-hidden="true"
                                    focusable="false"
                                >
                                    <rect
                                        x={0}
                                        y={Math.round(image.height * ANON_BAR_TOP)}
                                        width={image.width}
                                        height={Math.round(image.height * ANON_BAR_HEIGHT)}
                                    />
                                </svg>
                            )}
                            <span className={styles.typeLabel} aria-hidden="true">
                                {cell.alt}
                            </span>
                            {isHidden && (
                                <span
                                    className={styles.visibilityBadge}
                                    title="Hidden from patient"
                                    aria-hidden="true"
                                >
                                    <i className="fas fa-eye-slash"></i>
                                </span>
                            )}
                        </a>
                    );
                })}
            </div>
            </div>
            )}

            {sessionList && (
                <SessionListMenu
                    x={sessionList.x}
                    y={sessionList.y}
                    sessions={timepoints.map((tp) => ({
                        code: tp.tp_code,
                        description: tp.tp_description,
                        date: formatDate(tp.tp_date_time),
                    }))}
                    currentCode={tpCode}
                    onSelect={(code) => {
                        setSessionList(null);
                        handleTimepointClick(code);
                    }}
                    onClose={() => setSessionList(null)}
                />
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
                    onEdit={() => { setEditTp(menuFor.tp); setMenuFor(null); }}
                    onReimport={() => { handleReimport(menuFor.tp); setMenuFor(null); }}
                    onOpenFolder={handleOpenFolder}
                    onOpenWorking={handleOpenWorking}
                    onDelete={(scope) => { setDeleteScope(scope); setDeleteTp(menuFor.tp); setMenuFor(null); }}
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

            <ShareSheet
                open={!!shareSources}
                sources={shareSources ?? []}
                onClose={() => setShareSources(null)}
            />

            {showNewSession && personId && (
                <PhotoSessionDialog
                    personId={String(personId)}
                    onClose={() => setShowNewSession(false)}
                    onPrepared={({ tpCode: newTp }) => {
                        setShowNewSession(false);
                        // (The dialog itself refreshes the photo caches, for all three of
                        // its call sites — FE-F12-3d.)
                        navigate(`/patient/${personId}/photo-editor/tp${newTp}`);
                    }}
                />
            )}
        </div>
    );
};

export default GridComponent;
