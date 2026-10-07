import { useId, useRef, useState } from 'react';
import type { KeyboardEvent, MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import * as threeshape from '@shared/contracts/threeshape.contract';
import type { patientInfo as patientInfoContract } from '@shared/contracts/patient.contract';
import PhotoSessionDialog from './PhotoSessionDialog';
import type { z } from 'zod';
import { patientInfoQuery, patientsFolderQuery, timepointsQuery } from '@/query/queries';
import { useLastPhotoTab } from '@/hooks/useLastPhotoTab';

/** The parsed row, straight from the contract. The local interface this replaces
 *  declared eight optional name fields plus an index signature and was reached
 *  through an `as` cast over the parsed payload — the bridge CLAUDE.md bans,
 *  because it re-opens exactly what the fail-loud guard closed. Four of the
 *  fields it declared (`patientName`, `Name`, `FullName`, `fullName`) are not on
 *  the contract at all, so the fallbacks reading them could never fire. */
type PatientInfo = z.infer<typeof patientInfoContract.response>;

interface NavItem {
    key: string;
    page: string;
    label: string;
    icon: string;
    highlight?: boolean;
}

interface NavigationProps {
    personId?: string;
    currentPage?: string;
}

const Navigation = ({ personId, currentPage }: NavigationProps) => {
    const { t } = useTranslation('navigation');
    const toast = useToast();
    const [moreActionsExpanded, setMoreActionsExpanded] = useState(false);
    const moreActionsButtonRef = useRef<HTMLDivElement>(null);
    const moreActionsTriggerRef = useRef<HTMLDivElement>(null);
    const moreActionsFlyoutRef = useRef<HTMLDivElement>(null);
    // Escape closes the flyout and hands focus back to the trigger — and focusing
    // the trigger is itself an "open" gesture, so without this one-shot guard the
    // menu would reopen the instant Escape closed it.
    const suppressFocusOpenRef = useRef(false);
    const moreActionsFlyoutId = useId();
    const [moreActionsFlyoutPosition, setMoreActionsFlyoutPosition] = useState({ bottom: 0 });
    const [showNativePhotoEditor, setShowNativePhotoEditor] = useState(false);
    const [sendingTo3Shape, setSendingTo3Shape] = useState(false);
    const navigate = useNavigate();

    // Check if this is the "new patient" form
    const isNewPatient = personId === 'new';
    const hasPatient = !!personId && personId !== 'new';

    // Patient info reads from React Query (shared, deduped cache).
    const { data: piData } = useQuery({
        ...patientInfoQuery(personId ?? ''),
        enabled: hasPatient,
    });
    const patientInfo: PatientInfo | null = piData ?? null;

    // Timepoint count shown on the Photos button label (shared, deduped cache —
    // reused by the photos grid). Falls back to a plain "Photos" until loaded.
    const { data: tpData } = useQuery({
        ...timepointsQuery(personId ?? ''),
        enabled: hasPatient,
    });
    const photosLabel = tpData
        ? `${tpData.length} ${t(tpData.length === 1 ? 'photos.session' : 'photos.sessions')}`
        : t('photos.labelFallback');
    // Reopen the session last viewed for this patient (tp0 until one has been) —
    // unless it has since been deleted, which would land on an empty grid.
    const lastPhotoTab = useLastPhotoTab(hasPatient ? personId : null);
    const photosTp =
        lastPhotoTab && (!tpData || tpData.some((tp) => tp.tp_code === lastPhotoTab)) ? lastPhotoTab : '0';

    // Patients-folder UNC (client-side `explorer:` target — must stay UNC, see
    // CLAUDE.md). Ordinary server state, read from the shared cache.
    //
    // This used to be mirrored into `localStorage['patientsFolder']` and the
    // query ran only `enabled: !cachedFolder`, with nothing in the tree ever
    // removing the key. When the clinic moved its share and an admin updated
    // PatientsFolder in Settings, every browser that had opened a patient page
    // since install kept building `explorer:\\OLD\Clinic1\<id>` forever, with
    // no recovery short of clearing site data. React Query already gives us the
    // dedupe and the instant re-read the cache was there for.
    const { data: folderData } = useQuery(patientsFolderQuery());
    const patientsFolder = folderData?.patientsFolder || '';

    // Define static navigation items inside the component so labels are reactive to language
    const staticNavItems: NavItem[] = [
        { key: 'works', page: 'works', label: t('nav.works'), icon: 'fas fa-tooth' },
        { key: 'files', page: 'files', label: t('nav.files'), icon: 'fas fa-folder-tree' },
        { key: 'new-appointment', page: 'new-appointment', label: t('nav.newAppointment'), icon: 'fas fa-plus-circle' },
        { key: 'appointments', page: 'appointments', label: t('nav.appointments'), icon: 'fas fa-calendar-check' },
        { key: 'patient-info', page: 'patient-info', label: t('nav.patientInfo'), icon: 'fas fa-id-card' }
    ];

    // NOTE (both protocol handlers below): assigning an unregistered scheme to
    // `location.href` does NOT throw — the browser either shows its own "no app
    // for this link" dialog or does nothing. These used to sit inside a
    // try/catch with a toast.error in it; the catch was unreachable, so on a PC
    // where the handler was never installed (the case ProtocolHandlersSettings
    // exists for) the button was completely silent AND the code read as if it
    // reported the failure. The catch is gone rather than faked; detecting a
    // missing handler needs a blur/visibilitychange race, which is a separate
    // piece of work (FE-F4-12).
    const handleOpenCSImaging = () => {
        // `patient_name` and `name` are the two name fields the contract carries.
        const patientName = patientInfo?.patient_name || patientInfo?.name || 'Unknown';
        const formattedName = patientName.replace(/ /g, '_');
        window.location.href = `csimaging:${personId}?name=${encodeURIComponent(formattedName)}`;
    };

    // Push the patient to 3Shape Unite and start a scan workflow via the Web Service
    // (server → scanner workstation). Replaces the legacy `tshape:` protocol handler:
    // no per-client install, and it works from any browser on the LAN.
    const handleOpen3Shape = async () => {
        if (!hasPatient || sendingTo3Shape) return;
        setSendingTo3Shape(true);
        // Immediate, persistent feedback for the unavoidable few-second round-trip
        // (push the patient → launch Unite on the scanner workstation over the LAN).
        // The "Sending…" label on the button isn't enough: this button lives in the
        // More-actions flyout, which closes the instant it's clicked — so without a
        // toast the click looks like it did nothing. Long duration; we clear it
        // explicitly the moment the call settles.
        const pendingId = toast.info(t('toast.sendingToThreeShape'), 60000);
        try {
            await postJSON(
                `/api/threeshape/patients/${personId}/initiate-workflow`,
                {},
                { schema: threeshape.initiateWorkflow.response }
            );
            toast.removeToast(pendingId);
            toast.success(t('toast.sentToThreeShape'));
        } catch (err) {
            toast.removeToast(pendingId);
            toast.error(httpErrorMessage(err, t('toast.threeShapeFailed')));
        } finally {
            setSendingTo3Shape(false);
        }
    };

    const handleOpenDolphin = () => {
        // Dolphin protocol handler keys off PersonID; the desktop side looks the patient
        // up by patOtherID. No name needed in the URL (Dolphin already holds the patient).
        window.location.href = `dolphin:${personId}?action=open`;
    };

    const renderNavItem = (item: NavItem, isActive = false) => {
        const isDisabled = isNewPatient;
        const className = `sidebar-nav-item ${isActive ? 'active' : ''} ${item.highlight ? 'highlighted' : ''} ${isDisabled ? 'disabled' : ''}`;

        if (isDisabled) {
            return (
                <div
                    key={item.key}
                    className={className}
                    title={t('nav.disabledTooltip')}
                >
                    <div className="nav-item-icon">
                        <i className={item.icon} aria-hidden="true" />
                    </div>
                    <span className="nav-item-label">{item.label}</span>
                </div>
            );
        }

        return (
            <Link
                key={item.key}
                to={`/patient/${personId}/${item.page}`}
                className={className}
                title={item.label}
            >
                <div className="nav-item-icon">
                    <i className={item.icon} aria-hidden="true" />
                </div>
                <span className="nav-item-label">{item.label}</span>
            </Link>
        );
    };

    const isPhotosPageActive = currentPage === 'photos';

    // The More-actions flyout is the only entry point to seven patient
    // destinations (Compare, Presentation, X-rays, Scans, 3Shape, Dolphin, New
    // Photo Session). It used to open on hover ONLY, over a plain <div> with no
    // tabIndex, no role and no key handler — so all seven were mouse-only. It now
    // opens on hover, on click and on focus, and closes on Escape or when focus
    // leaves the trigger AND the flyout (the flyout renders outside the sidebar
    // for positioning, so a single `contains` check isn't enough).
    const openMoreActions = () => {
        if (isNewPatient) return; // Disable for new patients
        if (moreActionsButtonRef.current) {
            const rect = moreActionsButtonRef.current.getBoundingClientRect();
            // Store the button's bottom position for positioning the flyout
            setMoreActionsFlyoutPosition({ bottom: rect.bottom });
        }
        setMoreActionsExpanded(true);
    };

    const closeMoreActions = (returnFocus = false) => {
        setMoreActionsExpanded(false);
        if (!returnFocus) return;
        suppressFocusOpenRef.current = true;
        // Fires the focus event synchronously when focus was elsewhere (Escape
        // from inside the flyout); fires nothing when the trigger already had
        // focus, so clear the guard either way.
        moreActionsTriggerRef.current?.focus();
        queueMicrotask(() => { suppressFocusOpenRef.current = false; });
    };

    const handleMoreActionsFocus = () => {
        if (suppressFocusOpenRef.current) {
            suppressFocusOpenRef.current = false;
            return;
        }
        openMoreActions();
    };

    /** Close only when focus lands outside BOTH the trigger and the flyout. */
    const handleMoreActionsBlur = (e: React.FocusEvent<HTMLDivElement>) => {
        const next = e.relatedTarget as Node | null;
        if (
            next &&
            (moreActionsButtonRef.current?.contains(next) ||
                moreActionsFlyoutRef.current?.contains(next))
        ) {
            return;
        }
        setMoreActionsExpanded(false);
    };

    const handleMoreActionsKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
        if (e.key === 'Escape' && moreActionsExpanded) {
            e.preventDefault();
            closeMoreActions(true);
            return;
        }
        // Enter/Space OPENS, it does not toggle. Focusing the trigger already
        // opens the flyout, so a toggle would mean a keyboard user's first Enter
        // closes the menu they just opened. Escape (above) is how you close it.
        if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            openMoreActions();
        }
    };

    const handleCSImagingClick = (e?: MouseEvent<HTMLDivElement>) => {
        e?.preventDefault();
        if (isNewPatient) return;
        handleOpenCSImaging();
    };

    const handleFolderClick = (e?: MouseEvent<HTMLDivElement>) => {
        e?.preventDefault();
        if (isNewPatient) return;
        if (!patientsFolder) {
            toast.error(t('folder.errorNotConfigured'));
            return;
        }
        // Construct full path: PatientsFolder + PersonID. The setting is expected
        // to end in a separator (today's row is `\\CLINIC\Clinic1\`) but nothing
        // validates it, so a Settings edit that drops the trailing slash used to
        // yield `\\CLINIC\Clinic17639`. Normalise here rather than trust it.
        const base = /[\\/]$/.test(patientsFolder)
            ? patientsFolder
            : `${patientsFolder}${patientsFolder.includes('/') ? '/' : '\\'}`;
        window.location.href = `explorer:${base}${personId}`;
    };

    return (
        <>
            <div className="patient-sidebar narrow-bar">
                {/* Main navigation content */}
                <div className="sidebar-content">
                    {/* Static navigation items section */}
                    <div className="nav-section">
                        {staticNavItems.map(item => {
                            const isActive = currentPage === item.page;
                            return renderNavItem(item, isActive);
                        })}
                    </div>

                    {/* Photos section — plain nav button (flyout removed) */}
                    <div className="nav-section photos-section">
                        {isNewPatient ? (
                            <div
                                className={`sidebar-nav-item photos-main-btn disabled`}
                                title={t('photos.tooltipDisabled')}
                            >
                                <div className="nav-item-icon">
                                    <i className="fas fa-images" aria-hidden="true" />
                                </div>
                                <span className="nav-item-label">{t('photos.labelFallback')}</span>
                            </div>
                        ) : (
                            <Link
                                to={`/patient/${personId}/photos/tp${photosTp}`}
                                className={`sidebar-nav-item photos-main-btn ${isPhotosPageActive ? 'active' : ''}`}
                                title={t('photos.tooltip')}
                            >
                                <div className="nav-item-icon">
                                    <i className="fas fa-images" aria-hidden="true" />
                                </div>
                                <span className="nav-item-label">{photosLabel}</span>
                            </Link>
                        )}
                    </div>
                </div>

                {/* Sidebar footer */}
                <div className="sidebar-footer">
                    {/* CS Imaging Button - Outside wrapper */}
                    <div
                        className={`sidebar-nav-item csimaging-item ${isNewPatient ? 'disabled' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={handleCSImagingClick}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleCSImagingClick(); } }}
                        title={isNewPatient ? t('csImaging.tooltipDisabled') : t('csImaging.tooltip')}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-radiation" aria-hidden="true" />
                        </div>
                        <span className="nav-item-label">{t('csImaging.label')}</span>
                    </div>

                    {/* Patient Folder Button - Outside wrapper */}
                    <div
                        className={`sidebar-nav-item folder-item ${isNewPatient ? 'disabled' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={handleFolderClick}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFolderClick(); } }}
                        title={isNewPatient ? t('folder.tooltipDisabled') : t('folder.tooltip')}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-folder-open" aria-hidden="true" />
                        </div>
                        <span className="nav-item-label">{t('folder.label')}</span>
                    </div>

                    {/* More Actions Button with Flyout - ONLY this button triggers the flyout */}
                    <div
                        ref={moreActionsButtonRef}
                        className="more-actions-wrapper"
                        onMouseEnter={openMoreActions}
                        onMouseLeave={() => setMoreActionsExpanded(false)}
                        onFocus={handleMoreActionsFocus}
                        onBlur={handleMoreActionsBlur}
                    >
                        <div
                            ref={moreActionsTriggerRef}
                            className={`sidebar-nav-item more-actions-btn ${(currentPage === 'compare' || currentPage === 'xrays' || currentPage === 'slideshow' || currentPage === 'scans') ? 'active' : ''} ${isNewPatient ? 'disabled' : ''}`}
                            role="button"
                            tabIndex={isNewPatient ? -1 : 0}
                            aria-expanded={moreActionsExpanded}
                            aria-controls={moreActionsFlyoutId}
                            aria-disabled={isNewPatient || undefined}
                            onClick={() => (moreActionsExpanded ? closeMoreActions() : openMoreActions())}
                            onKeyDown={handleMoreActionsKeyDown}
                            title={isNewPatient ? t('moreActions.tooltipDisabled') : t('moreActions.tooltip')}
                        >
                            <div className="nav-item-icon">
                                <i className="fas fa-ellipsis-h" aria-hidden="true" />
                            </div>
                            <span className="nav-item-label">{t('moreActions.label')}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* More Actions Flyout Menu - OUTSIDE SIDEBAR FOR PROPER POSITIONING */}
            {moreActionsExpanded && (
                // eslint-disable-next-line jsx-a11y/no-static-element-interactions -- container, not a control: the interactive children are the <Link>s inside it, and this keydown is only a scoped Escape-to-close (focus returns to the trigger)
                <div
                    id={moreActionsFlyoutId}
                    ref={moreActionsFlyoutRef}
                    className="more-actions-flyout positioned"
                    style={{ bottom: `${window.innerHeight - moreActionsFlyoutPosition.bottom}px` }}
                    onMouseEnter={() => setMoreActionsExpanded(true)}
                    onMouseLeave={() => setMoreActionsExpanded(false)}
                    onBlur={handleMoreActionsBlur}
                    onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); closeMoreActions(true); } }}
                >
                    <div className="flyout-content">
                        <Link
                            to={`/patient/${personId}/compare`}
                            className={`flyout-action-item ${currentPage === 'compare' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-exchange-alt" aria-hidden="true" />
                            </div>
                            <span className="action-item-label">{t('flyout.comparePhotos')}</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/slideshow`}
                            className={`flyout-action-item ${currentPage === 'slideshow' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-film" aria-hidden="true" />
                            </div>
                            <span className="action-item-label">{t('flyout.presentation')}</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/xrays`}
                            className={`flyout-action-item ${currentPage === 'xrays' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-x-ray" aria-hidden="true" />
                            </div>
                            <span className="action-item-label">{t('flyout.xrays')}</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/scans`}
                            className={`flyout-action-item ${currentPage === 'scans' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-cube" aria-hidden="true" />
                            </div>
                            <span className="action-item-label">{t('flyout.scans')}</span>
                        </Link>

                        <Link
                            to="#"
                            className={`flyout-action-item ${isNewPatient || sendingTo3Shape ? 'disabled' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                if (isNewPatient || sendingTo3Shape) return;
                                void handleOpen3Shape();
                                setMoreActionsExpanded(false);
                            }}
                            title={isNewPatient ? t('flyout.threeShapeDisabledTooltip') : t('flyout.threeShapeTooltip')}
                        >
                            <div className="action-item-icon">
                                <img src="/images/3Shape_transparent_256x256.png" alt={t('flyout.threeShapeAlt')} />
                            </div>
                            <span className="action-item-label">{sendingTo3Shape ? t('flyout.threeShapeSending') : t('flyout.threeShape')}</span>
                        </Link>

                        <Link
                            to="#"
                            className={`flyout-action-item ${isNewPatient ? 'disabled' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                if (isNewPatient) return;
                                handleOpenDolphin();
                                setMoreActionsExpanded(false);
                            }}
                            title={isNewPatient ? t('flyout.dolphinDisabledTooltip') : t('flyout.dolphinTooltip')}
                        >
                            <div className="action-item-icon">
                                <img src="/images/dolphin-logo@2x.png" alt={t('flyout.dolphinAlt')} />
                            </div>
                            <span className="action-item-label">{t('flyout.dolphin')}</span>
                        </Link>

                        <Link
                            to="#"
                            className={`flyout-action-item ${isNewPatient ? 'disabled' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                if (isNewPatient) return;
                                setShowNativePhotoEditor(true);
                                setMoreActionsExpanded(false);
                            }}
                            title={isNewPatient ? t('flyout.newPhotoSessionDisabledTooltip') : t('flyout.newPhotoSessionTooltip')}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-camera" aria-hidden="true" />
                            </div>
                            <span className="action-item-label">{t('flyout.newPhotoSession')}</span>
                        </Link>
                    </div>
                </div>
            )}

            {showNativePhotoEditor && (
                <PhotoSessionDialog
                    personId={personId}
                    onClose={() => setShowNativePhotoEditor(false)}
                    onPrepared={({ tpCode }) => {
                        setShowNativePhotoEditor(false);
                        navigate(`/patient/${personId}/photo-editor/tp${tpCode}`);
                    }}
                />
            )}
        </>
    );
};

export default Navigation;
