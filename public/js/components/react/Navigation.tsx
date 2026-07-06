import { useState, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { useToast } from '../../contexts/ToastContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import * as threeshape from '@shared/contracts/threeshape.contract';
import PhotoSessionDialog from './PhotoSessionDialog';
import { patientInfoQuery, patientsFolderQuery, timepointsQuery } from '@/query/queries';

interface PatientInfo {
    patient_name?: string;
    patientName?: string;
    Name?: string;
    name?: string;
    FullName?: string;
    fullName?: string;
    first_name?: string;
    last_name?: string;
    [key: string]: unknown;
}

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
    const patientInfo = (piData ?? null) as PatientInfo | null;

    // Timepoint count shown on the Photos button label (shared, deduped cache —
    // reused by the photos grid). Falls back to a plain "Photos" until loaded.
    const { data: tpData } = useQuery({
        ...timepointsQuery(personId ?? ''),
        enabled: hasPatient,
    });
    const photosLabel = tpData
        ? `${tpData.length} ${t(tpData.length === 1 ? 'photos.session' : 'photos.sessions')}`
        : t('photos.labelFallback');

    // Patients-folder UNC: prefer the localStorage cache; only hit the API when
    // it's absent. Persist the fetched value back for next time.
    const cachedFolder = typeof localStorage !== 'undefined' ? localStorage.getItem('patientsFolder') : null;
    const { data: folderData } = useQuery({
        ...patientsFolderQuery(),
        enabled: !cachedFolder,
    });
    const patientsFolder = cachedFolder || folderData?.patientsFolder || '';
    useEffect(() => {
        if (!cachedFolder && folderData?.patientsFolder) {
            localStorage.setItem('patientsFolder', folderData.patientsFolder);
        }
    }, [cachedFolder, folderData]);

    // Define static navigation items inside the component so labels are reactive to language
    const staticNavItems: NavItem[] = [
        { key: 'works', page: 'works', label: t('nav.works'), icon: 'fas fa-tooth' },
        { key: 'files', page: 'files', label: t('nav.files'), icon: 'fas fa-folder-tree' },
        { key: 'new-appointment', page: 'new-appointment', label: t('nav.newAppointment'), icon: 'fas fa-plus-circle' },
        { key: 'appointments', page: 'appointments', label: t('nav.appointments'), icon: 'fas fa-calendar-check' },
        { key: 'patient-info', page: 'patient-info', label: t('nav.patientInfo'), icon: 'fas fa-id-card' }
    ];

    const handleOpenCSImaging = () => {
        try {
            // Try different possible field names for patient name
            const patientName = patientInfo?.patient_name
                || patientInfo?.patientName
                || patientInfo?.Name
                || patientInfo?.name
                || patientInfo?.FullName
                || patientInfo?.fullName
                || 'Unknown';

            // Format patient name (replace spaces with underscores for URL)
            const formattedName = String(patientName).replace(/ /g, '_');

            // Construct csimaging: URL
            const csimagingUrl = `csimaging:${personId}?name=${encodeURIComponent(formattedName)}`;

            // Trigger the protocol handler
            window.location.href = csimagingUrl;

        } catch (err) {
            console.error('Error opening CS Imaging:', err);
            toast.error(t('toast.csImagingFailed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
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
        try {
            // Dolphin protocol handler keys off PersonID; the desktop side looks the patient
            // up by patOtherID. No name needed in the URL (Dolphin already holds the patient).
            const url = `dolphin:${personId}?action=open`;
            window.location.href = url;

        } catch (err) {
            console.error('Error opening Dolphin Imaging:', err);
            toast.error(t('toast.dolphinFailed', { error: err instanceof Error ? err.message : 'Unknown error' }));
        }
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
                        <i className={item.icon} />
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
                    <i className={item.icon} />
                </div>
                <span className="nav-item-label">{item.label}</span>
            </Link>
        );
    };

    const isPhotosPageActive = currentPage === 'photos';

    const handleMoreActionsMouseEnter = () => {
        if (isNewPatient) return; // Disable for new patients
        if (moreActionsButtonRef.current) {
            const rect = moreActionsButtonRef.current.getBoundingClientRect();
            // Store the button's bottom position for positioning the flyout
            setMoreActionsFlyoutPosition({ bottom: rect.bottom });
        }
        setMoreActionsExpanded(true);
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
        // Construct full path: PatientsFolder + PersonID
        const fullPath = `${patientsFolder}${personId}`;
        window.location.href = `explorer:${fullPath}`;
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
                                    <i className="fas fa-images" />
                                </div>
                                <span className="nav-item-label">{t('photos.labelFallback')}</span>
                            </div>
                        ) : (
                            <Link
                                to={`/patient/${personId}/photos/tp0`}
                                className={`sidebar-nav-item photos-main-btn ${isPhotosPageActive ? 'active' : ''}`}
                                title={t('photos.tooltip')}
                            >
                                <div className="nav-item-icon">
                                    <i className="fas fa-images" />
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
                            <i className="fas fa-radiation" />
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
                            <i className="fas fa-folder-open" />
                        </div>
                        <span className="nav-item-label">{t('folder.label')}</span>
                    </div>

                    {/* More Actions Button with Flyout - ONLY this button triggers the flyout */}
                    <div
                        ref={moreActionsButtonRef}
                        className="more-actions-wrapper"
                        onMouseEnter={handleMoreActionsMouseEnter}
                        onMouseLeave={() => setMoreActionsExpanded(false)}
                    >
                        <div
                            className={`sidebar-nav-item more-actions-btn ${(currentPage === 'compare' || currentPage === 'xrays' || currentPage === 'slideshow' || currentPage === 'scans') ? 'active' : ''} ${isNewPatient ? 'disabled' : ''}`}
                            title={isNewPatient ? t('moreActions.tooltipDisabled') : t('moreActions.tooltip')}
                        >
                            <div className="nav-item-icon">
                                <i className="fas fa-ellipsis-h" />
                            </div>
                            <span className="nav-item-label">{t('moreActions.label')}</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* More Actions Flyout Menu - OUTSIDE SIDEBAR FOR PROPER POSITIONING */}
            {moreActionsExpanded && (
                <div
                    className="more-actions-flyout positioned"
                    style={{ bottom: `${window.innerHeight - moreActionsFlyoutPosition.bottom}px` }}
                    onMouseEnter={() => setMoreActionsExpanded(true)}
                    onMouseLeave={() => setMoreActionsExpanded(false)}
                >
                    <div className="flyout-content">
                        <Link
                            to={`/patient/${personId}/compare`}
                            className={`flyout-action-item ${currentPage === 'compare' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-exchange-alt" />
                            </div>
                            <span className="action-item-label">{t('flyout.comparePhotos')}</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/slideshow`}
                            className={`flyout-action-item ${currentPage === 'slideshow' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-film" />
                            </div>
                            <span className="action-item-label">{t('flyout.presentation')}</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/xrays`}
                            className={`flyout-action-item ${currentPage === 'xrays' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-x-ray" />
                            </div>
                            <span className="action-item-label">{t('flyout.xrays')}</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/scans`}
                            className={`flyout-action-item ${currentPage === 'scans' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-cube" />
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
                                <i className="fas fa-camera" />
                            </div>
                            <span className="action-item-label">{t('flyout.newPhotoSession')}</span>
                        </Link>
                    </div>
                </div>
            )}

            {showNativePhotoEditor && (
                <PhotoSessionDialog
                    personId={personId}
                    patientInfo={patientInfo}
                    onClose={() => setShowNativePhotoEditor(false)}
                    onPrepared={({ tpCode, tpName, tpDate }) => {
                        setShowNativePhotoEditor(false);
                        navigate(
                            `/patient/${personId}/photo-editor/tp${tpCode}?tpName=${encodeURIComponent(tpName)}&date=${tpDate}`
                        );
                    }}
                />
            )}
        </>
    );
};

export default Navigation;
