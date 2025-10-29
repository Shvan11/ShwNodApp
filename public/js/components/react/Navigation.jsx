import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';

const Navigation = ({ patientId, currentPage }) => {
    const [timepoints, setTimepoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [photosExpanded, setPhotosExpanded] = useState(false);
    const [searchParams] = useSearchParams();
    const photosButtonRef = useRef(null);
    const [flyoutPosition, setFlyoutPosition] = useState({ top: 0 });

    // Cache for timepoints
    const [cache, setCache] = useState(new Map());
    const cacheTimeout = 5 * 60 * 1000; // 5 minutes

    const loadTimepoints = useCallback(async (patientId) => {
        if (!patientId) return;

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
        loadTimepoints(patientId);
    }, [patientId, loadTimepoints]);

    const formatDate = (dateTime) => {
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };

    // Define static navigation items (Photos removed - will be its own expandable section)
    const staticNavItems = [
        { key: 'works', page: 'works', label: 'Works', icon: 'fas fa-tooth' },
        { key: 'new-appointment', page: 'new-appointment', label: 'New Appointment', icon: 'fas fa-plus-circle' },
        { key: 'edit-patient', page: 'edit-patient', label: 'Edit Patient', icon: 'fas fa-user-edit' }
    ];

    const renderNavItem = (item, isActive = false) => {
        const className = `sidebar-nav-item ${isActive ? 'active' : ''} ${item.highlight ? 'highlighted' : ''}`;

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
        const currentTp = searchParams.get('tp') || '0';
        const isActive = currentTp === timepoint.tpCode;

        return (
            <Link
                key={timepoint.tpCode}
                to={`/patient/${patientId}/grid?tp=${timepoint.tpCode}`}
                className={`sidebar-nav-item timepoint-subitem ${isActive ? 'active' : ''}`}
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

    const isPhotosPageActive = currentPage === 'grid';

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
                        <Link
                            to={`/patient/${patientId}/grid?tp=0`}
                            className={`sidebar-nav-item photos-main-btn ${isPhotosPageActive ? 'active' : ''}`}
                            title="Photos"
                        >
                            <div className="nav-item-icon">
                                <i className="fas fa-images" />
                            </div>
                            <span className="nav-item-label">Photos</span>
                        </Link>

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
                <Link
                    to={`/patient/${patientId}/compare`}
                    className={`sidebar-nav-item compare-item ${currentPage === 'compare' ? 'active' : ''}`}
                    title="Compare"
                >
                    <div className="nav-item-icon">
                        <i className="fas fa-exchange-alt" />
                    </div>
                    <span className="nav-item-label">Compare</span>
                </Link>

                <Link
                    to={`/patient/${patientId}/xrays`}
                    className={`sidebar-nav-item xrays-item ${currentPage === 'xrays' ? 'active' : ''}`}
                    title="X-rays"
                >
                    <div className="nav-item-icon">
                        <i className="fas fa-x-ray" />
                    </div>
                    <span className="nav-item-label">X-rays</span>
                </Link>

                <div
                    className="sidebar-nav-item appointments-item"
                    onClick={(e) => {
                        e.preventDefault();
                        window.location.href = '/daily-appointments';
                    }}
                    title="Today's Appointments"
                >
                    <div className="nav-item-icon">
                        <i className="fas fa-calendar-day" />
                    </div>
                    <span className="nav-item-label">Today's Appointments</span>
                </div>

                <div
                    className="sidebar-nav-item calendar-item"
                    onClick={(e) => {
                        e.preventDefault();
                        window.location.href = '/calendar';
                    }}
                    title="Calendar"
                >
                    <div className="nav-item-icon">
                        <i className="fas fa-calendar-alt" />
                    </div>
                    <span className="nav-item-label">Calendar</span>
                </div>
            </div>
        </div>
    );
};

export default Navigation;
