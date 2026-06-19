import { useState, useEffect, useRef } from 'react';
import type { MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
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
        ? `${tpData.length} timepoint${tpData.length === 1 ? '' : 's'}`
        : 'Photos';

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
            toast.error('Failed to open CS Imaging: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    // Push the patient to 3Shape Unite and start a scan workflow via the Web Service
    // (server → scanner workstation). Replaces the legacy `tshape:` protocol handler:
    // no per-client install, and it works from any browser on the LAN.
    const handleOpen3Shape = async () => {
        if (!hasPatient || sendingTo3Shape) return;
        setSendingTo3Shape(true);
        try {
            await postJSON(
                `/api/threeshape/patients/${personId}/initiate-workflow`,
                {},
                { schema: threeshape.initiateWorkflow.response }
            );
            toast.success('Sent to 3Shape — start the scan on the scanner');
        } catch (err) {
            toast.error(httpErrorMessage(err, 'Failed to send to 3Shape'));
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
            toast.error('Failed to open Dolphin Imaging: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    // Define static navigation items (Photos removed - will be its own expandable section)
    const staticNavItems: NavItem[] = [
        { key: 'works', page: 'works', label: 'Works', icon: 'fas fa-tooth' },
        { key: 'files', page: 'files', label: 'Files', icon: 'fas fa-folder-tree' },
        { key: 'new-appointment', page: 'new-appointment', label: 'New Appointment', icon: 'fas fa-plus-circle' },
        { key: 'appointments', page: 'appointments', label: 'Appointments', icon: 'fas fa-calendar-check' },
        { key: 'patient-info', page: 'patient-info', label: 'Patient Info', icon: 'fas fa-id-card' }
    ];

    const renderNavItem = (item: NavItem, isActive = false) => {
        const isDisabled = isNewPatient;
        const className = `sidebar-nav-item ${isActive ? 'active' : ''} ${item.highlight ? 'highlighted' : ''} ${isDisabled ? 'disabled' : ''}`;

        if (isDisabled) {
            return (
                <div
                    key={item.key}
                    className={className}
                    title="Save patient first to access this section"
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
            toast.error('Patients folder path is not configured. Please check settings.');
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
                                title="Save patient first to access photos"
                            >
                                <div className="nav-item-icon">
                                    <i className="fas fa-images" />
                                </div>
                                <span className="nav-item-label">Photos</span>
                            </div>
                        ) : (
                            <Link
                                to={`/patient/${personId}/photos/tp0`}
                                className={`sidebar-nav-item photos-main-btn ${isPhotosPageActive ? 'active' : ''}`}
                                title="Photos"
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
                        title={isNewPatient ? "Save patient first to access CS Imaging" : "Open CS Imaging Trophy"}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-radiation" />
                        </div>
                        <span className="nav-item-label">CS Imaging</span>
                    </div>

                    {/* Patient Folder Button - Outside wrapper */}
                    <div
                        className={`sidebar-nav-item folder-item ${isNewPatient ? 'disabled' : ''}`}
                        role="button"
                        tabIndex={0}
                        onClick={handleFolderClick}
                        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleFolderClick(); } }}
                        title={isNewPatient ? "Save patient first to access folder" : "Open Patient Folder"}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-folder-open" />
                        </div>
                        <span className="nav-item-label">Open in Windows</span>
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
                            title={isNewPatient ? "Save patient first to access more actions" : "More Actions"}
                        >
                            <div className="nav-item-icon">
                                <i className="fas fa-ellipsis-h" />
                            </div>
                            <span className="nav-item-label">More Actions</span>
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
                            <span className="action-item-label">Compare Photos</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/slideshow`}
                            className={`flyout-action-item ${currentPage === 'slideshow' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-film" />
                            </div>
                            <span className="action-item-label">Presentation</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/xrays`}
                            className={`flyout-action-item ${currentPage === 'xrays' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-x-ray" />
                            </div>
                            <span className="action-item-label">X-rays</span>
                        </Link>

                        <Link
                            to={`/patient/${personId}/scans`}
                            className={`flyout-action-item ${currentPage === 'scans' ? 'active' : ''}`}
                            onClick={() => setMoreActionsExpanded(false)}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-cube" />
                            </div>
                            <span className="action-item-label">3D Scans</span>
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
                            title={isNewPatient ? "Save patient first" : "Send patient to 3Shape & start a scan"}
                        >
                            <div className="action-item-icon">
                                <img src="/images/3Shape_transparent_256x256.png" alt="3Shape" />
                            </div>
                            <span className="action-item-label">{sendingTo3Shape ? 'Sending…' : '3Shape'}</span>
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
                            title={isNewPatient ? "Save patient first to access Dolphin Imaging" : "Launch Dolphin Imaging with patient data"}
                        >
                            <div className="action-item-icon">
                                <img src="/images/dolphin-logo@2x.png" alt="Dolphin" />
                            </div>
                            <span className="action-item-label">Dolphin Imaging</span>
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
                            title={isNewPatient ? "Save patient first" : "Lay out photos in the in-app editor"}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-images" />
                            </div>
                            <span className="action-item-label">Photo Layout</span>
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
