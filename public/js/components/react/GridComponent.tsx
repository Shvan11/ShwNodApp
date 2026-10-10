import { useState, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON, postJSON, putJSON, deleteJSON, postFormData, httpErrorMessage } from '@/core/http';
import { invalidatePatientPhotos } from '@/query/photos';
import { reportClientError, describeHttpError } from '@/core/error-reporter';
import { qk } from '@/query/keys';
import {
    timepointsQuery,
    galleryQuery,
    photoVisibilityQuery,
    brandingQuery,
    takenDatesQuery,
    workingFilesQuery,
} from '@/query/queries';
import * as patientContract from '@shared/contracts/patient.contract';
import * as utilityContract from '@shared/contracts/utility.contract';
import * as photoEditorContract from '@shared/contracts/photo-editor.contract';
import * as shareContract from '@shared/contracts/share.contract';
import tpStyles from './TimePointsSelector.module.css';
import styles from './GridComponent.module.css';
import EditTimepointModal from './EditTimepointModal';
import DeleteTimepointModal from './DeleteTimepointModal';
import PhotoSessionDialog from './PhotoSessionDialog';
import TimepointActionsMenu, { type DeleteScope, type FolderState } from './TimepointActionsMenu';
import SessionListMenu from './SessionListMenu';
import ShareSheet from './share/ShareSheet';
import SlotContextMenu, { type SlotMenuItem } from './photo-editor/SlotContextMenu';
import type { ShareSource } from './localsend/LocalSendShareModal';
import { encodeRelPath, buildWorkingContentUrl } from './files/fileHelpers';
import { extrasBySession, hasXray, summarizeExtras } from './files/workingImages';
import { parseViewTag, VIEW_CODES, type PhotoViewCode } from '@shared/photo-views';
import { sessionFolderName } from '@shared/photo-session-folder';
import { formatPhotoTakenAt } from '@/utils/formatters';
import {
    canCopyImage,
    copyPhoto,
    photoAsJpeg,
    photoFileName,
    saveBlob,
    sessionZipName,
    zipFiles,
    type EyeBar,
    type PhotoNameParts,
} from '@/utils/photoExport';
import sseAppointments from '../../services/sse-appointments';
import { useDragScroll } from '../../hooks/useDragScroll';
import { anchorFrom } from '../../hooks/useFloatingMenu';
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
    // Images a session holds beyond the 8 views (a Dolphin OPG, a ceph, …): the grid has
    // no cell for them, so a tab with any carries a small mark, and the open session gets
    // a chip that opens all of its images on the working-files page. One read for every
    // session, the same listing that page shows.
    const workingQ = useQuery({ ...workingFilesQuery(personId ?? ''), enabled: !!personId });
    const extrasByTp = extrasBySession(workingQ.data?.entries ?? []);
    const currentExtras = extrasByTp.get(tpCode) ?? [];
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
    // Right-click menu on a grid photo (copy / download / open / send / re-crop), and
    // the "Download all" zip in progress.
    const [photoMenu, setPhotoMenu] = useState<{ view: PhotoViewCode; x: number; y: number } | null>(null);
    const [zipping, setZipping] = useState(false);
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

    // What an exported photo is called: `{patient}_{session}_{view}.jpg` — the view
    // alone ("Smile.jpg") collided across every patient and session in a Downloads
    // folder. Read from the query cache at call time: the lightbox buttons run outside
    // React's tree, from the render that built them, which can predate the session list.
    const exportNameParts = (): PhotoNameParts => {
        const patient = queryClient.getQueryData<patientContract.PatientInfo>(qk.patient.info(personId ?? ''));
        const session = (queryClient.getQueryData<Timepoint[]>(qk.patient.timepoints(personId ?? '')) ?? [])
            .find((tp) => tp.tp_code === tpCode);
        return {
            patientName: patient?.name || patient?.patient_name || (personId ? `Patient ${personId}` : null),
            session: session
                ? sessionFolderName(session.tp_description, session.tp_date_time) ?? session.tp_description
                : null,
        };
    };

    // The export name for a photo given its /DolImgs URL.
    const getShareFileName = (imageUrl: string): string => {
        const view = getFileNameFromUrl(imageUrl).match(/\.(i\d+)$/i)?.[1]?.toLowerCase();
        return view ? photoFileName(exportNameParts(), view) : `patient_${personId}_photo.jpg`;
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

    // ── Taking photos out of the app: the grid's right-click menu + "Download all" ──
    // All of it works from the full-resolution render (a copy is capped at
    // COPY_MAX_EDGE — see photoExport). The browser's own "Copy image" / "Save image as"
    // on a cell act on the 480px thumbnail above.

    // The eye bar a view carries while Anonymize is on. It is drawn into whatever
    // leaves the app, so a copy or a download matches the grid it was taken from.
    const eyeBarFor = (view: PhotoViewCode): EyeBar | null =>
        anonymize && EXTRA_ORAL_VIEWS.has(view) ? { top: ANON_BAR_TOP, height: ANON_BAR_HEIGHT } : null;

    const copyPhotoToClipboard = async (view: PhotoViewCode, image: GalleryView) => {
        // Re-encoding a render as PNG takes a second or so. Say so: a paste made
        // straight away gets whatever was on the clipboard before.
        const working = toast.info('Copying photo…', 30_000);
        try {
            await copyPhoto(fullResUrl(image), eyeBarFor(view));
            toast.success('Photo copied');
        } catch {
            toast.error('Could not copy the photo');
        } finally {
            toast.removeToast(working);
        }
    };

    const downloadPhoto = async (view: PhotoViewCode, image: GalleryView) => {
        try {
            saveBlob(await photoAsJpeg(fullResUrl(image), eyeBarFor(view)), photoFileName(exportNameParts(), view));
        } catch {
            toast.error('Could not download the photo');
        }
    };

    // Every rendered view of this session, in grid order, as one zip.
    const downloadAllPhotos = async () => {
        if (!gallery || zipping) return;
        setZipping(true);
        try {
            const parts = exportNameParts();
            const files = await Promise.all(
                VIEW_CODES.flatMap((view) => {
                    const image = gallery[view];
                    if (!image) return [];
                    return [
                        photoAsJpeg(fullResUrl(image), eyeBarFor(view)).then((blob) => ({
                            name: photoFileName(parts, view),
                            blob,
                        })),
                    ];
                })
            );
            saveBlob(await zipFiles(files), sessionZipName(parts));
        } catch {
            toast.error('Could not download the photos');
        } finally {
            setZipping(false);
        }
    };

    // Hand a photo to the share sheet (LocalSend / Telegram). Those transports read the
    // file from the server's disk, so a photo carrying an eye bar — which exists only in
    // this browser — is staged first, the way Compare stages its montage.
    const sharePhoto = async (view: PhotoViewCode, image: GalleryView) => {
        if (!personId) return;
        // The sheet is a modal in #modal-root, which native fullscreen hides.
        if (fsMode === 'native') exitFullscreen();
        const displayName = photoFileName(exportNameParts(), view);
        const eyeBar = eyeBarFor(view);
        if (!eyeBar) {
            setShareSources([{ source: 'patient-image', personId, ref: image.name, displayName }]);
            return;
        }
        try {
            const fd = new FormData();
            fd.append('image', await photoAsJpeg(fullResUrl(image), eyeBar), displayName);
            fd.append('personId', String(personId));
            fd.append('displayName', displayName);
            const staged = await postFormData<shareContract.StageResponse>('/api/share/stage', fd, {
                schema: shareContract.stage.response,
                timeoutMs: 120_000,
            });
            setShareSources([{ source: 'staged', personId, ref: staged.ref, displayName: staged.displayName }]);
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to prepare the photo for sharing'));
        }
    };

    // Re-crop one photo: the editor opens on this session with the photo already in its
    // cropper, framed as it is now (PhotoEditor's `?recrop=`). Leaving the grid also
    // ends a fullscreen presentation.
    const recropPhoto = (view: PhotoViewCode) => {
        if (!personId) return;
        navigate(`/patient/${personId}/photo-editor/tp${tpCode}?recrop=${view}`);
    };

    const menuImage = photoMenu ? gallery?.[photoMenu.view] ?? null : null;
    const photoMenuItems = (view: PhotoViewCode, image: GalleryView): SlotMenuItem[] => {
        const barred = !!eyeBarFor(view);
        const covered = barred ? ' (eyes covered)' : '';
        const copyable = canCopyImage();
        return [
            {
                key: 'copy',
                // No async clipboard on a plain-http origin.
                label: copyable ? `Copy image${covered}` : 'Copy image — needs the https:// address',
                icon: 'fa-copy',
                disabled: !copyable,
                onClick: () => void copyPhotoToClipboard(view, image),
            },
            {
                key: 'download',
                label: `Download${covered}`,
                icon: 'fa-download',
                onClick: () => void downloadPhoto(view, image),
            },
            {
                key: 'open',
                // The stored file itself, so this one cannot carry the bar.
                label: barred ? 'Open in new tab (without the eye bar)' : 'Open in new tab',
                icon: 'fa-external-link-alt',
                onClick: () => window.open(fullResUrl(image), '_blank', 'noopener'),
            },
            {
                key: 'send',
                label: `Send to a device or Telegram${covered}`,
                icon: 'fa-share-alt',
                onClick: () => void sharePhoto(view, image),
            },
            {
                key: 'recrop',
                label: 'Re-crop',
                icon: 'fa-crop-simple',
                onClick: () => recropPhoto(view),
            },
        ];
    };

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
            // Containment comes from `inert` on the page instead (below), which
            // keeps Tab inside the viewer without a focusin handler.
            trapFocus: false
        });

        // A dialog opened over the viewer owns the keyboard while it is up.
        // PhotoSwipe listens on `document`, so its Escape closed the VIEWER under
        // the dialog and, having preventDefault()ed the key, left the dialog open
        // (<Modal> ignores an Escape something else already handled); the arrow
        // keys in the LocalSend IP box paged the photos behind it.
        lightboxInstance.on('keydown', (e) => {
            if (document.querySelector('[role="dialog"][aria-modal="true"]:not(.pswp)')) e.preventDefault();
        });

        // With the viewer open, Tab must not walk the page behind it (it did: 17 of
        // 25 presses landed on covered controls — audit FE-F25-11). The page is made
        // inert; the dialogs that open over the viewer live in #modal-root and the
        // toasts on <body>, both outside it. Skipped in native fullscreen, where the
        // viewer mounts INSIDE the page. PhotoSwipe only moves and returns focus
        // when its own trap is on, so both are done here.
        const appRoot = document.getElementById('single-spa-application');
        let lightboxOpener: HTMLElement | null = null;
        const releasePage = () => {
            if (appRoot?.inert) appRoot.inert = false;
            if (lightboxOpener?.isConnected) lightboxOpener.focus({ preventScroll: true });
            lightboxOpener = null;
        };
        lightboxInstance.on('afterInit', () => {
            const viewer = lightboxInstance.pswp?.element;
            if (!viewer) return;
            viewer.setAttribute('aria-label', 'Photo viewer');
            if (!appRoot || appRoot.contains(viewer)) return;
            lightboxOpener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
            appRoot.inert = true;
            viewer.tabIndex = -1;
            viewer.focus({ preventScroll: true });
        });
        // `close` (closing starts) AND `destroy` (closing ends): an inert page that
        // is never released is a frozen app, so neither event is trusted alone.
        lightboxInstance.on('close', releasePage);
        lightboxInstance.on('destroy', releasePage);

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

            // Caption: the view and when it was taken. The text is read from the slide's
            // grid anchor on every change (its `data-taken` is filled once the dates
            // load), so the lightbox needs no copy of the dates. It is also the one place
            // a touch device — no hover — sees the date.
            pswpUi.registerElement({
                name: 'photo-caption',
                order: 9,
                isButton: false,
                appendTo: 'root',
                html: '',
                onInit: (el: HTMLElement, pswp: PhotoSwipeInstance) => {
                    pswp.on('change', () => {
                        const anchor = pswp.currSlide?.data?.element;
                        const label = anchor?.querySelector('img')?.alt ?? '';
                        const taken = anchor?.dataset.taken;
                        el.textContent = taken ? `${label} · Taken ${taken}` : label;
                        el.hidden = !el.textContent;
                    });
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
            releasePage();
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

    // The read-only working-files view, on one session: its 8 views and whatever else
    // Dolphin keeps for it (OPG, ceph, …). The page widens to every session from there.
    const openSessionImages = (tp: string) => {
        if (!personId) return;
        navigate(`/patient/${personId}/working-files?tp=${tp}`);
    };
    const openAllImages = () => {
        if (!personId) return;
        navigate(`/patient/${personId}/working-files`);
    };
    const handleOpenWorking = () => {
        if (!menuFor) return;
        openSessionImages(menuFor.tp.tp_code);
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
                    ? 'Cropped photos moved to the trash'
                    : scope === 'entry'
                      ? 'Time point deleted (folder originals kept)'
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

    // When each view's photo was TAKEN, shown in its hover caption + the lightbox. The
    // renders above carry no EXIF; the date is the camera clock of the original the
    // editor view-tagged (`i13-IMG_….JPG`) in the session folder. Fetched only once THIS
    // session's photos are on screen (never ahead of them, never for a placeholder), and
    // the server reads just those ≤ 8 tagged originals' headers. No folder, tag or EXIF
    // (a Dolphin-era session) = no date, never a guessed one.
    const currentTp = timepoints.find((tp) => tp.tp_code === tpCode);
    const sessionFolder = currentTp ? sessionFolderName(currentTp.tp_description, currentTp.tp_date_time) : null;
    const takenQ = useQuery({
        ...takenDatesQuery(personId ?? '', sessionFolder ?? '', 'views'),
        enabled: !!personId && !!sessionFolder && hasRealPhotos && !switching,
    });
    const takenByView: Partial<Record<PhotoViewCode, string>> = {};
    for (const [name, takenAt] of Object.entries(takenQ.data?.dates ?? {})) {
        const tag = parseViewTag(name);
        if (tag && takenAt) takenByView[tag.view] = formatPhotoTakenAt(takenAt);
    }

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
                        {timepoints.map((timepoint, index) => {
                            const tabExtras = extrasByTp.get(timepoint.tp_code);
                            return (
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
                                        <i className="fas fa-camera" aria-hidden="true"></i>
                                    </div>
                                    <div className={tpStyles.tabContent}>
                                        <div className={tpStyles.tabDesc}>{timepoint.tp_description}</div>
                                        <div className={tpStyles.tabDate}>{formatDate(timepoint.tp_date_time)}</div>
                                    </div>
                                    {tabExtras && (
                                        <span
                                            className={tpStyles.extrasMark}
                                            title={`Also in Dolphin: ${summarizeExtras(tabExtras)}`}
                                        >
                                            <i
                                                className={`fas ${hasXray(tabExtras) ? 'fa-x-ray' : 'fa-images'}`}
                                                aria-hidden="true"
                                            ></i>
                                            <span className="sr-only">, also {summarizeExtras(tabExtras)}</span>
                                        </span>
                                    )}
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
                            );
                        })}
                        <button
                            type="button"
                            className={tpStyles.addTab}
                            onClick={() => setShowNewSession(true)}
                        >
                            <i className="fas fa-plus" aria-hidden="true"></i>
                            <span>New session</span>
                        </button>
                        {/* Every session's images on one page; only once there are some. */}
                        {(workingQ.data?.entries ?? []).length > 0 && (
                            <button
                                type="button"
                                className={`${tpStyles.addTab} ${tpStyles.allImagesTab}`}
                                onClick={openAllImages}
                                title="Every session's cropped photo views and X-rays, on one page"
                            >
                                <i className="fas fa-images" aria-hidden="true"></i>
                                <span>All images</span>
                            </button>
                        )}
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
            ) : !hasRealPhotos && selectedTpExists && currentExtras.length > 0 ? (
                // Nothing for the grid, but the session is not empty: Dolphin holds an
                // OPG, a ceph, … for it (a session of only an X-ray is common).
                <div className={styles.emptyState}>
                    <i className={`fas ${hasXray(currentExtras) ? 'fa-x-ray' : 'fa-images'}`} aria-hidden="true"></i>
                    <h3>No grid photos in this session</h3>
                    <p>
                        Dolphin has {summarizeExtras(currentExtras)} for this session, which the photo grid
                        doesn't show.
                    </p>
                    {/* No icon: the empty state's `i` rule would draw it at 3rem. */}
                    <button type="button" className="btn btn-primary" onClick={() => openSessionImages(tpCode)}>
                        {currentExtras.length === 1 ? 'View it' : `View all ${currentExtras.length}`}
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
                {/* What else this session holds that the grid can't show (OPG, ceph, …). */}
                {!fsActive && currentExtras.length > 0 && (
                    <button
                        type="button"
                        className={styles.extrasChip}
                        onClick={() => openSessionImages(tpCode)}
                        title={`Also in this session, outside the grid: ${summarizeExtras(currentExtras)}. Click to see all of its images.`}
                    >
                        <i className={`fas ${hasXray(currentExtras) ? 'fa-x-ray' : 'fa-images'}`} aria-hidden="true"></i>
                        <span>+ {summarizeExtras(currentExtras)}</span>
                    </button>
                )}
                {/* Not while presenting: fullscreen shows the layout, nothing to export. */}
                {!fsActive && (
                    <button
                        type="button"
                        className={styles.layoutToolBtn}
                        onClick={() => void downloadAllPhotos()}
                        disabled={zipping || switching}
                        title={anonymize ? 'Download all photos (zip) — eyes covered' : 'Download all photos (zip)'}
                        aria-label="Download all photos as a zip"
                    >
                        <i className={`fas ${zipping ? 'fa-spinner fa-spin' : 'fa-download'}`} aria-hidden="true"></i>
                    </button>
                )}
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
                    const takenAt = cell.view ? takenByView[cell.view] : undefined;

                    return (
                        <a
                            key={`dolph_gallery-${cell.id}`}
                            id={`a${cell.id}`}
                            href={fullResUrl(image)}
                            data-pswp-width={image.width ?? 800}
                            data-pswp-height={image.height ?? 600}
                            data-taken={takenAt}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.galleryCell}
                            onContextMenu={(e) => {
                                // Shift + right-click keeps the browser's own menu.
                                if (e.shiftKey) return;
                                e.preventDefault();
                                // Mid-switch the cell still shows the previous session's photo.
                                if (switching || !cell.view) return;
                                setPhotoMenu({ view: cell.view, ...anchorFrom(e) });
                            }}
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
                                {takenAt && <span className={styles.takenAt}>{takenAt}</span>}
                            </span>
                            {isHidden && (
                                <span
                                    className={styles.visibilityBadge}
                                    title="Hidden from patient"
                                    aria-hidden="true"
                                >
                                    <i className="fas fa-eye-slash" aria-hidden="true"></i>
                                </span>
                            )}
                        </a>
                    );
                })}
            </div>
            {/* Inside the wrapper so it shows in native fullscreen; outside the gallery so
                a click on it is not a lightbox click. The photo is looked up by view, so the
                menu always acts on the render that is on screen now. */}
            {photoMenu && menuImage && (
                <SlotContextMenu
                    x={photoMenu.x}
                    y={photoMenu.y}
                    items={photoMenuItems(photoMenu.view, menuImage)}
                    onClose={() => setPhotoMenu(null)}
                />
            )}
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
                sessionFiles={(workingQ.data?.entries ?? []).filter((e) => String(e.tpCode) === deleteTp?.tp_code)}
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
