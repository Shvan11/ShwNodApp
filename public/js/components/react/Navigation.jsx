import React, { useState, useEffect, useCallback } from 'react'

const Navigation = ({ patientId, currentPath, onNavigate }) => {
    const [timepoints, setTimepoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [isCollapsed, setIsCollapsed] = useState(true);
    const [isMobile, setIsMobile] = useState(false);
    
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

    // Check for mobile screen size
    useEffect(() => {
        const checkMobile = () => {
            const mobile = window.innerWidth <= 768;
            setIsMobile(mobile);
            if (mobile) {
                setIsCollapsed(true);
            }
        };
        
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);

    const toggleSidebar = () => {
        setIsCollapsed(!isCollapsed);
    };
    
    const formatDate = (dateTime) => {
        return dateTime.substring(0, 10).split("-").reverse().join("-");
    };
    
    const isCurrentPath = (path) => {
        return currentPath.includes(path);
    };
    
    const handleNavigation = (page) => {
        onNavigate(page);
    };
    
    // Define static navigation items - using page names instead of paths
    const staticNavItems = [
        { key: 'grid', page: 'grid', label: 'Photos', icon: 'fas fa-images' },
        { key: 'compare', page: 'compare', label: 'Compare', icon: 'fas fa-exchange-alt' },
        { key: 'xrays', page: 'xrays', label: 'X-rays', icon: 'fas fa-x-ray' },
        { key: 'visits', page: 'visits', label: 'Visit Summary', icon: 'fas fa-clipboard-list' },
        { key: 'payments', page: 'payments', label: 'Payments', icon: 'fas fa-credit-card' }
    ];

    const renderNavItem = (item, isActive = false) => {
        return (
            <div
                key={item.key}
                className={`sidebar-nav-item ${isActive ? 'active' : ''}`}
                onClick={(e) => {
                    e.preventDefault();
                    handleNavigation(item.page);
                    if (isMobile) setIsCollapsed(true);
                }}
            >
                <div className="nav-item-icon">
                    <i className={item.icon} />
                </div>
                {!isCollapsed && (
                    <span className="nav-item-label">{item.label}</span>
                )}
            </div>
        );
    };

    const renderTimepointItem = (timepoint) => {
        // Check if this timepoint is currently active
        const urlParams = new URLSearchParams(window.location.search);
        const currentTp = urlParams.get('tp') || '0';
        const isActive = currentTp === timepoint.tpCode;
        
        return (
            <div
                key={timepoint.tpCode}
                className={`sidebar-nav-item timepoint-item ${isActive ? 'active' : ''}`}
                onClick={(e) => {
                    e.preventDefault();
                    // Navigate to grid page with specific timepoint
                    const newUrl = `${window.location.pathname}?code=${patientId}&page=grid&tp=${timepoint.tpCode}`;
                    window.history.pushState({}, '', newUrl);
                    // Force PatientShell to update by dispatching a custom event
                    window.dispatchEvent(new CustomEvent('urlChanged'));
                    if (isMobile) setIsCollapsed(true);
                }}
            >
                <div className="nav-item-icon">
                    <i className="fas fa-camera" />
                </div>
                {!isCollapsed && (
                    <div className="timepoint-content">
                        <span className="timepoint-description">{timepoint.tpDescription}</span>
                        <span className="timepoint-date">{formatDate(timepoint.tpDateTime)}</span>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={`patient-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''}`}>
            {/* Sidebar header with toggle */}
            <div className="sidebar-header">
                <button
                    className="sidebar-toggle"
                    onClick={toggleSidebar}
                    aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                >
                    <i className={`fas ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'}`} />
                </button>
                {!isCollapsed && (
                    <h3 className="sidebar-title">Patient Navigation</h3>
                )}
            </div>

            {/* Main navigation content */}
            <div className="sidebar-content">
                {/* Static navigation items section */}
                <div className="nav-section">
                    {!isCollapsed && (
                        <div className="section-title">Patient Records</div>
                    )}
                    
                    {staticNavItems.map(item => {
                        // Check if this page is currently active based on URL params
                        const urlParams = new URLSearchParams(window.location.search);
                        const currentPage = urlParams.get('page') || 'grid';
                        const isActive = currentPage === item.page;
                        
                        return renderNavItem(item, isActive);
                    })}
                </div>

                {/* Timepoints section */}
                {loading ? (
                    <div className="nav-section loading">
                        <div className="nav-item-icon">
                            <i className="fas fa-spinner fa-spin" />
                        </div>
                        {!isCollapsed && (
                            <span className="nav-item-label">Loading timepoints...</span>
                        )}
                    </div>
                ) : error ? (
                    <div className="nav-section error">
                        <div className="nav-item-icon">
                            <i className="fas fa-exclamation-triangle" />
                        </div>
                        {!isCollapsed && (
                            <span className="nav-item-label">Error loading timepoints</span>
                        )}
                    </div>
                ) : timepoints.length > 0 && (
                    <div className="nav-section timepoints-section">
                        {!isCollapsed && (
                            <div className="section-title">Photo Sessions</div>
                        )}
                        
                        {timepoints.map(timepoint => renderTimepointItem(timepoint))}
                    </div>
                )}
            </div>

            {/* Sidebar footer */}
            <div className="sidebar-footer">
                <div
                    className="sidebar-nav-item appointments-item"
                    onClick={(e) => {
                        e.preventDefault();
                        window.location.href = '/daily-appointments';
                    }}
                >
                    <div className="nav-item-icon">
                        <i className="fas fa-calendar-day" />
                    </div>
                    {!isCollapsed && (
                        <span className="nav-item-label">Today's Appointments</span>
                    )}
                </div>

                {/* Calendar item */}
                <div
                    className="sidebar-nav-item calendar-item"
                    onClick={(e) => {
                        e.preventDefault();
                        window.location.href = '/calendar.html';
                    }}
                    title="Full Calendar View"
                >
                    <div className="nav-item-icon">
                        <i className="fas fa-calendar-alt" />
                    </div>
                    {!isCollapsed && (
                        <span className="nav-item-label">Calendar</span>
                    )}
                </div>
            </div>
        </div>
    );
};

export default Navigation;