import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Link } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext.jsx';

const Navigation = ({ patientId, currentPage }) => {
    const navigate = useNavigate();
    const toast = useToast();
    const { tpCode } = useParams();
    const [timepoints, setTimepoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [photosExpanded, setPhotosExpanded] = useState(false);
    const [moreActionsExpanded, setMoreActionsExpanded] = useState(false);
    const photosButtonRef = useRef(null);
    const moreActionsButtonRef = useRef(null);
    const [flyoutPosition, setFlyoutPosition] = useState({ top: 0 });
    const [moreActionsFlyoutPosition, setMoreActionsFlyoutPosition] = useState({ top: 0 });
    const [patientInfo, setPatientInfo] = useState(null);
    const [patientsFolder, setPatientsFolder] = useState('');

    // Check if this is the "new patient" form
    const isNewPatient = patientId === 'new';

    // Cache for timepoints
    const [cache, setCache] = useState(new Map());
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes

    const loadTimepoints = useCallback(async (patientId) => {
        if (!patientId || patientId === 'new') return;

        const cacheKey = `patient_${patientId}`;
        const cached = cache.get(cacheKey);

        // Check cache first
        if (cached && (Date.now() - cached.timestamp) < cacheTimeout) {
            console.log('Using cached timepoints for patient', patientId);
            setTimepoints(cached.data);
            setLoading(false);
            return;
        }

        try {
            setLoading(true);
            console.log('Fetching timepoints for patient', patientId);

            const response = await fetch(`/api/gettimepoints?code=${patientId}`);
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
            setError(err.message);
            setTimepoints([]);
        } finally {
            setLoading(false);
        }
    }, [cache, cacheTimeout]);

    useEffect(() => {
        // Skip API calls for new patient form
        if (patientId && patientId !== 'new') {
            loadTimepoints(patientId);
            loadPatientInfo(patientId);
        }
        loadPatientsFolder();
    }, [patientId, loadTimepoints]);

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

    const loadPatientInfo = async (patientId) => {
        if (!patientId || patientId === 'new') return;

        try {
            const response = await fetch(`/api/getinfos?code=${patientId}`);
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
            const formattedName = patientName.replace(/ /g, '_');

            // Construct csimaging: URL
            const csimagingUrl = `csimaging:${patientId}?name=${encodeURIComponent(formattedName)}`;

            // Trigger the protocol handler
            window.location.href = csimagingUrl;

            console.log('Opening CS Imaging for patient:', patientId, formattedName);
        } catch (err) {
            console.error('Error opening CS Imaging:', err);
            toast.error('Failed to open CS Imaging: ' + err.message);
        }
    };

    const formatDate = (dateTime) => {
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    // Define static navigation items (Photos removed - will be its own expandable section)
    const staticNavItems = [
        { key: 'works', page: 'works', label: 'Works', icon: 'fas fa-tooth' },
        { key: 'new-appointment', page: 'new-appointment', label: 'New Appointment', icon: 'fas fa-plus-circle' },
        { key: 'appointments', page: 'appointments', label: 'Appointments', icon: 'fas fa-calendar-check' },
        { key: 'patient-info', page: 'patient-info', label: 'Patient Info', icon: 'fas fa-id-card' }
    ];

    const renderNavItem = (item, isActive = false) => {
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
                to={`/patient/${patientId}/${item.page}`}
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

    const renderTimepointItem = (timepoint) => {
        // Check if this timepoint is currently active
        const currentTp = tpCode ? tpCode.replace('tp', '') : '0';
        const isActive = currentTp === timepoint.tpCode;

        return (
            <Link
                key={timepoint.tpCode}
                to={`/patient/${patientId}/photos/tp${timepoint.tpCode}`}
                className={`sidebar-nav-item timepoint-subitem ${isActive ? 'active' : ''}`}
                onClick={() => setPhotosExpanded(false)}
            >
                <div className="nav-item-icon">
                    <i className="fas fa-circle" style={{ fontSize: '0.5rem' }} />
                </div>
                <div className="timepoint-content">
                    <span className="timepoint-description">{timepoint.tpDescription}</span>
                    <span className="timepoint-date">{formatDate(timepoint.tpDateTime)}</span>
                </div>
            </Link>
        );
    };

    const isPhotosPageActive = currentPage === 'photos';

    return (
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
                        onMouseEnter={() => {
                            if (isNewPatient) return; // Disable for new patients
                            if (photosButtonRef.current) {
                                const rect = photosButtonRef.current.getBoundingClientRect();
                                setFlyoutPosition({ top: rect.top });
                            }
                            setPhotosExpanded(true);
                        }}
                        onMouseLeave={() => {
                            setPhotosExpanded(false);
                        }}
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
                                to={`/patient/${patientId}/photos/tp0`}
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
                {/* More Actions Button with Flyout */}
                <div
                    ref={moreActionsButtonRef}
                    className="more-actions-wrapper"
                    onMouseEnter={() => {
                        if (isNewPatient) return; // Disable for new patients
                        if (moreActionsButtonRef.current) {
                            const rect = moreActionsButtonRef.current.getBoundingClientRect();
                            setMoreActionsFlyoutPosition({ top: rect.top });
                        }
                        setMoreActionsExpanded(true);
                    }}
                    onMouseLeave={() => {
                        setMoreActionsExpanded(false);
                    }}
                >

                    <div
                        className={`sidebar-nav-item csimaging-item ${isNewPatient ? 'disabled' : ''}`}
                        onClick={(e) => {
                            e.preventDefault();
                            if (isNewPatient) return;
                            handleOpenCSImaging();
                        }}
                        title={isNewPatient ? "Save patient first to access CS Imaging" : "Open CS Imaging Trophy"}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-radiation" />
                        </div>
                        <span className="nav-item-label">CS Imaging</span>
                    </div>

                    <div
                        className={`sidebar-nav-item folder-item ${isNewPatient ? 'disabled' : ''}`}
                        onClick={(e) => {
                            e.preventDefault();
                            if (isNewPatient) return;
                            if (!patientsFolder) {
                                toast.error('Patients folder path is not configured. Please check settings.');
                                return;
                            }
                            // Construct full path: PatientsFolder + PatientID
                            const fullPath = `${patientsFolder}${patientId}`;
                            window.location.href = `explorer:${fullPath}`;
                        }}
                        title={isNewPatient ? "Save patient first to access folder" : "Open Patient Folder"}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-folder-open" />
                        </div>
                        <span className="nav-item-label">Open Folder</span>
                    </div>



                    <div
                        className={`sidebar-nav-item more-actions-btn ${(currentPage === 'compare' || currentPage === 'xrays') ? 'active' : ''} ${isNewPatient ? 'disabled' : ''}`}
                        title={isNewPatient ? "Save patient first to access more actions" : "More Actions"}
                    >
                        <div className="nav-item-icon">
                            <i className="fas fa-ellipsis-h" />
                        </div>
                        <span className="nav-item-label">More Actions</span>
                    </div>

                    {/* More Actions Flyout Menu */}
                    {moreActionsExpanded && (
                        <div
                            className="more-actions-flyout"
                            style={{ top: `${moreActionsFlyoutPosition.top}px` }}
                            onMouseEnter={() => setMoreActionsExpanded(true)}
                            onMouseLeave={() => setMoreActionsExpanded(false)}
                        >
                            <div className="flyout-header">
                                <i className="fas fa-ellipsis-h" />
                                More Actions
                            </div>
                            <div className="flyout-content">
                                <Link
                                    to={`/patient/${patientId}/compare`}
                                    className={`flyout-action-item ${currentPage === 'compare' ? 'active' : ''}`}
                                    onClick={() => setMoreActionsExpanded(false)}
                                >
                                    <div className="action-item-icon">
                                        <i className="fas fa-exchange-alt" />
                                    </div>
                                    <span className="action-item-label">Compare Photos</span>
                                </Link>

                                <Link
                                    to={`/patient/${patientId}/xrays`}
                                    className={`flyout-action-item ${currentPage === 'xrays' ? 'active' : ''}`}
                                    onClick={() => setMoreActionsExpanded(false)}
                                >
                                    <div className="action-item-icon">
                                        <i className="fas fa-x-ray" />
                                    </div>
                                    <span className="action-item-label">X-rays</span>
                                </Link>
                            </div>
                        </div>
                    )}
                </div>


            </div>
        </div>
    );
};

export default Navigation;
