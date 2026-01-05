import { useState, useEffect, useCallback, useRef } from 'react';
import type { MouseEvent } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import DolphinPhotoDialog from './DolphinPhotoDialog';

interface Timepoint {
    tpCode: string;
    tpDescription: string;
    tpDateTime: string;
}

interface PatientInfo {
    PatientName?: string;
    patientName?: string;
    Name?: string;
    name?: string;
    FullName?: string;
    fullName?: string;
    FirstName?: string;
    LastName?: string;
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
    const [showDolphinPhotoDialog, setShowDolphinPhotoDialog] = useState(false);

    // Check if this is the "new patient" form
    const isNewPatient = personId === 'new';

    // Cache for timepoints
    const [cache, setCache] = useState<Map<string, CacheEntry>>(new Map());
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes

    const loadTimepoints = useCallback(async (personIdParam: string) => {
        if (!personIdParam || personIdParam === 'new') return;

        const cacheKey = `patient_${personIdParam}`;
        const cached = cache.get(cacheKey);

        // Check cache first
        if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
            console.log('Using cached timepoints for patient', personIdParam);
            setTimepoints(cached.data);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            console.log('Fetching timepoints for patient', personIdParam);

            const response = await fetch(`/api/patients/${personIdParam}/timepoints`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const data = await response.json();

            // Update cache
            const newCache = new Map(cache);
            newCache.set(cacheKey, {
                data: data,
                timestamp: Date.now()
            });
            setCache(newCache);

            setTimepoints(data);
            setError(null);
        } catch (err) {
            console.error('Failed to load timepoints:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
            setTimepoints([]);
        } finally {
            setLoading(false);
        }
    }, [cache, cacheTimeout]);

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
            const response = await fetch('/api/settings/patients-folder');
            if (!response.ok) {
                throw new Error('Failed to fetch patients folder setting');
            }
            const data = await response.json();
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
            const response = await fetch(`/api/patients/${personIdParam}/info`);
            if (!response.ok) {
                throw new Error('Failed to fetch patient info');
            }
            const data = await response.json();
            setPatientInfo(data);
        } catch (err) {
            console.error('Error loading patient info:', err);
        }
    };

    const handleOpenCSImaging = () => {
        try {
            // Debug: Log patient info to see what we have
            console.log('Patient Info:', patientInfo);
            console.log('Patient Info Keys:', patientInfo ? Object.keys(patientInfo) : 'null');

            // Try different possible field names for patient name
            const patientName = patientInfo?.PatientName
                || patientInfo?.patientName
                || patientInfo?.Name
                || patientInfo?.name
                || patientInfo?.FullName
                || patientInfo?.fullName
                || 'Unknown';

            console.log('Resolved Patient Name:', patientName);

            // Format patient name (replace spaces with underscores for URL)
            const formattedName = String(patientName).replace(/ /g, '_');

            // Construct csimaging: URL
            const csimagingUrl = `csimaging:${personId}?name=${encodeURIComponent(formattedName)}`;

            // Trigger the protocol handler
            window.location.href = csimagingUrl;

            console.log('Opening CS Imaging for patient:', personId, formattedName);
        } catch (err) {
            console.error('Error opening CS Imaging:', err);
            toast.error('Failed to open CS Imaging: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    const handleOpen3Shape = () => {
        try {
            const patientName = patientInfo?.PatientName
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

            console.log('Opening 3Shape Unite for patient:', personId, firstName, lastName);
        } catch (err) {
            console.error('Error opening 3Shape Unite:', err);
            toast.error('Failed to open 3Shape Unite: ' + (err instanceof Error ? err.message : 'Unknown error'));
        }
    };

    const formatDate = (dateTime: string): string => {
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    // Define static navigation items (Photos removed - will be its own expandable section)
    const staticNavItems: NavItem[] = [
        { key: 'works', page: 'works', label: 'Works', icon: 'fas fa-tooth' },
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
        const isActive = currentTp === timepoint.tpCode;

        return (
            <Link
                key={timepoint.tpCode}
                to={`/patient/${personId}/photos/tp${timepoint.tpCode}`}
                className={`sidebar-nav-item timepoint-subitem ${isActive ? 'active' : ''}`}
                onClick={() => setPhotosExpanded(false)}
            >
                <div className="nav-item-icon">
                    <i className="fas fa-circle icon-xs" />
                </div>
                <div className="timepoint-content">
                    <span className="timepoint-description">{timepoint.tpDescription}</span>
                    <span className="timepoint-date">{formatDate(timepoint.tpDateTime)}</span>
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

    const handleCSImagingClick = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        if (isNewPatient) return;
        handleOpenCSImaging();
    };

    const handleFolderClick = (e: MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
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
                        onClick={handleCSImagingClick}
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
                        onClick={handleFolderClick}
                        title={isNewPatient ? "Save patient first to access folder" : "Open Patient Folder"}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-folder-open" />
                        </div>
                        <span className="nav-item-label">Open Folder</span>
                    </div>

                    {/* More Actions Button with Flyout - ONLY this button triggers the flyout */}
                    <div
                        ref={moreActionsButtonRef}
                        className="more-actions-wrapper"
                        onMouseEnter={handleMoreActionsMouseEnter}
                        onMouseLeave={() => setMoreActionsExpanded(false)}
                    >
                        <div
                            className={`sidebar-nav-item more-actions-btn ${(currentPage === 'compare' || currentPage === 'xrays') ? 'active' : ''} ${isNewPatient ? 'disabled' : ''}`}
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
                    className="more-actions-flyout"
                    style={{
                        bottom: `${window.innerHeight - moreActionsFlyoutPosition.bottom}px`,
                        top: 'auto',
                        transform: 'none'
                    }}
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

                                window.location.href = `dolphin:${personId}?action=open`;
                                setMoreActionsExpanded(false);
                            }}
                            title={isNewPatient ? "Save patient first to access Dolphin Imaging" : "Launch Dolphin Imaging with patient data"}
                        >
                            <div className="action-item-icon dolphin-icon">
                                🐬
                            </div>
                            <span className="action-item-label">Dolphin Imaging</span>
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
                                <i className="fas fa-cube" />
                            </div>
                            <span className="action-item-label">3Shape Unite</span>
                        </Link>

                        <Link
                            to="#"
                            className={`flyout-action-item ${isNewPatient ? 'disabled' : ''}`}
                            onClick={(e) => {
                                e.preventDefault();
                                if (isNewPatient) return;
                                setShowDolphinPhotoDialog(true);
                                setMoreActionsExpanded(false);
                            }}
                            title={isNewPatient ? "Save patient first" : "Add photos from memory card to Dolphin Imaging"}
                        >
                            <div className="action-item-icon">
                                <i className="fas fa-camera" />
                            </div>
                            <span className="action-item-label">Add Photos to Dolphin</span>
                        </Link>
                    </div>
                </div>
            )}

            {showDolphinPhotoDialog && (
                <DolphinPhotoDialog
                    personId={personId}
                    patientInfo={patientInfo}
                    onClose={() => setShowDolphinPhotoDialog(false)}
                />
            )}
        </>
    );
};

export default Navigation;
