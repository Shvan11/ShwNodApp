import { useState, useEffect, useCallback, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import PhotoSessionDialog from './PhotoSessionDialog';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';

interface Timepoint {
    tp_code: string;
    tp_description: string;
    tp_date_time: string;
}

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

interface CacheEntry {
    data: Timepoint[];
    timestamp: number;
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
    const { tpCode } = useParams<{ tpCode?: string }>();
    const [timepoints, setTimepoints] = useState<Timepoint[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [photosExpanded, setPhotosExpanded] = useState(false);
    const [moreActionsExpanded, setMoreActionsExpanded] = useState(false);
    const photosButtonRef = useRef<HTMLDivElement>(null);
    const moreActionsButtonRef = useRef<HTMLDivElement>(null);
    const [flyoutPosition, setFlyoutPosition] = useState({ top: 0 });
    const [moreActionsFlyoutPosition, setMoreActionsFlyoutPosition] = useState({ bottom: 0 });
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
    const [patientsFolder, setPatientsFolder] = useState('');
    const [showNativePhotoEditor, setShowNativePhotoEditor] = useState(false);
    const navigate = useNavigate();

    // Check if this is the "new patient" form
    const isNewPatient = personId === 'new';

    // Cache for timepoints — held in a ref so updating it doesn't change
    // loadTimepoints' identity (which would re-fire the load effect → refetch loop).
    const cacheRef = useRef<Map<string, CacheEntry>>(new Map());
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes

    const loadTimepoints = useCallback(async (personIdParam: string) => {
        if (!personIdParam || personIdParam === 'new') return;

        const cacheKey = `patient_${personIdParam}`;
        const cached = cacheRef.current.get(cacheKey);

        // Check cache first
        if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
            setTimepoints(cached.data);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);

            const data = await fetchJSON<Timepoint[]>(`/api/patients/${personIdParam}/timepoints`, { schema: patientContract.timepoints.response });

            // Update cache
            cacheRef.current.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });

            setTimepoints(data);
            setError(null);
        } catch (err) {
            console.error('Failed to load timepoints:', err);
            setError(httpErrorMessage(err, 'Unknown error'));
            setTimepoints([]);
        } finally {
            setLoading(false);
        }
    }, [cacheTimeout]);

    useEffect(() => {
        // Skip API calls for new patient form
        if (personId && personId !== 'new') {
            loadTimepoints(personId);
            loadPatientInfo(personId);
        }
        loadPatientsFolder();
    }, [personId, loadTimepoints]);

    const loadPatientsFolder = async () => {
        try {
            // Try to get from localStorage first
            const cached = localStorage.getItem('patientsFolder');
            if (cached) {
                setPatientsFolder(cached);
                return;
            }

            // If not in cache, fetch from API
            const data = await fetchJSON<{ patientsFolder?: string }>('/api/settings/patients-folder', { schema: patientContract.patientsFolder.response });
            const folderPath = data.patientsFolder || '';

            // Store in localStorage for future use
            if (folderPath) {
                localStorage.setItem('patientsFolder', folderPath);
            }

            setPatientsFolder(folderPath);
        } catch (err) {
            console.error('Error loading patients folder setting:', err);
        }
    };

    const loadPatientInfo = async (personIdParam: string) => {
        if (!personIdParam || personIdParam === 'new') return;

        try {
            const data = await fetchJSON<PatientInfo>(`/api/patients/${personIdParam}/info`, { schema: patientContract.patientInfo.response });
            setPatientInfo(data);
        } catch (err) {
            console.error('Error loading patient info:', err);
        }
    };

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

    const handleOpen3Shape = () => {
        try {
            const patientName = patientInfo?.patient_name
                || patientInfo?.patientName
                || patientInfo?.Name
                || patientInfo?.name
                || '';
            const names = String(patientName).trim().split(' ');
            const firstName = names[0] || '';
            const lastName = names.slice(1).join(' ') || '';

            // Use dedicated tshape: protocol handler (named "tshape" because URI schemes must start with a letter)
            const url = `tshape:${personId}?firstname=${encodeURIComponent(firstName)}&lastname=${encodeURIComponent(lastName)}`;
            window.location.href = url;

        } catch (err) {
            console.error('Error opening 3Shape Unite:', err);
            toast.error('Failed to open 3Shape Unite: ' + (err instanceof Error ? err.message : 'Unknown error'));
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

    const formatDate = (dateTime: string | null | undefined): string => {
        if (!dateTime) return '';
        return dateTime.substring(0, 10).split("-").reverse().join("-");
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

    const renderTimepointItem = (timepoint: Timepoint) => {
        // Check if this timepoint is currently active
        const currentTp = tpCode ? tpCode.replace('tp', '') : '0';
        const isActive = currentTp === timepoint.tp_code;

        return (
            <Link
                key={timepoint.tp_code}
                to={`/patient/${personId}/photos/tp${timepoint.tp_code}`}
                className={`sidebar-nav-item timepoint-subitem ${isActive ? 'active' : ''}`}
                onClick={() => setPhotosExpanded(false)}
            >
                <div className="nav-item-icon">
                    <i className="fas fa-circle icon-xs" />
                </div>
                <div className="timepoint-content">
                    <span className="timepoint-description">{timepoint.tp_description}</span>
                    <span className="timepoint-date">{formatDate(timepoint.tp_date_time)}</span>
                </div>
            </Link>
        );
    };

    const isPhotosPageActive = currentPage === 'photos';

    const handlePhotosMouseEnter = () => {
        if (isNewPatient) return; // Disable for new patients
        if (photosButtonRef.current) {
            const rect = photosButtonRef.current.getBoundingClientRect();
            const viewportHeight = window.innerHeight;
            const flyoutMaxHeight = 450; // Photos flyout can be taller (max-height: 500px)

            // Calculate ideal top position (aligned with button)
            let calculatedTop = rect.top;

            // Check if flyout would extend beyond viewport bottom
            if (calculatedTop + flyoutMaxHeight > viewportHeight) {
                // Position flyout above the bottom edge with padding
                calculatedTop = viewportHeight - flyoutMaxHeight - 20;
            }

            // Ensure flyout doesn't go above viewport top
            calculatedTop = Math.max(10, calculatedTop);

            setFlyoutPosition({ top: calculatedTop });
        }
        setPhotosExpanded(true);
    };

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

                    {/* Photos section with flyout menu for timepoints */}
                    <div className="nav-section photos-section">
                        <div
                            ref={photosButtonRef}
                            className="photos-wrapper"
                            onMouseEnter={handlePhotosMouseEnter}
                            onMouseLeave={() => setPhotosExpanded(false)}
                        >
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
                                    <span className="nav-item-label">Photos</span>
                                </Link>
                            )}

                            {/* Flyout menu for timepoints */}
                            {photosExpanded && (
                                <div
                                    className="photos-flyout-menu"
                                    style={{ top: `${flyoutPosition.top}px` }}
                                    onMouseEnter={() => setPhotosExpanded(true)}
                                    onMouseLeave={() => setPhotosExpanded(false)}
                                >
                                    <div className="flyout-header">
                                        <i className="fas fa-images" />
                                        Photo Sessions
                                    </div>
                                    <div className="flyout-content">
                                        {loading ? (
                                            <div className="flyout-loading">
                                                <i className="fas fa-spinner fa-spin" />
                                                <span>Loading timepoints...</span>
                                            </div>
                                        ) : error ? (
                                            <div className="flyout-error">
                                                <i className="fas fa-exclamation-triangle" />
                                                <span>Error loading timepoints</span>
                                            </div>
                                        ) : timepoints.length > 0 ? (
                                            timepoints.map(timepoint => renderTimepointItem(timepoint))
                                        ) : (
                                            <div className="flyout-empty">
                                                <i className="fas fa-info-circle" />
                                                <span>No photo sessions yet</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
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
                            className={`sidebar-nav-item more-actions-btn ${(currentPage === 'compare' || currentPage === 'xrays' || currentPage === 'slideshow') ? 'active' : ''} ${isNewPatient ? 'disabled' : ''}`}
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
                            to="#"
                            className={`flyout-action-item ${isNewPatient ? 'disabled' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                if (isNewPatient) return;
                                handleOpen3Shape();
                                setMoreActionsExpanded(false);
                            }}
                            title={isNewPatient ? "Save patient first" : "Launch 3Shape Unite with patient data"}
                        >
                            <div className="action-item-icon">
                                <img src="/images/3Shape_transparent_256x256.png" alt="3Shape" />
                            </div>
                            <span className="action-item-label">3Shape</span>
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
