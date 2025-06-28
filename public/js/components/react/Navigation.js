// Navigation.js - Sidebar navigation component for patient portal
const Navigation = ({ patientId, currentPath, onNavigate }) => {
    const { useState, useEffect, useCallback } = React;
    
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
    
    const handleNavigation = (path) => {
        onNavigate(path);
    };
    
    // Define static navigation items
    const staticNavItems = [
        { key: 'compare', path: '/compare', label: 'Compare', icon: 'fas fa-exchange-alt' },
        { key: 'xrays', path: '/xrays', label: 'X-rays', icon: 'fas fa-x-ray' },
        { key: 'visits', path: '/visits', label: 'Visit Summary', icon: 'fas fa-clipboard-list' },
        { key: 'payments', path: '/payments', label: 'Payments', icon: 'fas fa-credit-card' }
    ];

    const renderNavItem = (item, isActive = false) => {
        return React.createElement('div', {
            key: item.key,
            className: `sidebar-nav-item ${isActive ? 'active' : ''}`,
            onClick: (e) => {
                e.preventDefault();
                handleNavigation(item.path);
                if (isMobile) setIsCollapsed(true);
            }
        }, [
            React.createElement('div', { 
                key: 'icon',
                className: 'nav-item-icon' 
            },
                React.createElement('i', { className: item.icon })
            ),
            !isCollapsed && React.createElement('span', { 
                key: 'label',
                className: 'nav-item-label' 
            }, item.label)
        ]);
    };

    const renderTimepointItem = (timepoint) => {
        const isActive = isCurrentPath(`tp=${timepoint.tpCode}`);
        const path = `/patient/${patientId}/grid?tp=${timepoint.tpCode}`;
        
        return React.createElement('div', {
            key: timepoint.tpCode,
            className: `sidebar-nav-item timepoint-item ${isActive ? 'active' : ''}`,
            onClick: (e) => {
                e.preventDefault();
                handleNavigation(path);
                if (isMobile) setIsCollapsed(true);
            }
        }, [
            React.createElement('div', { 
                key: 'icon',
                className: 'nav-item-icon' 
            },
                React.createElement('i', { className: 'fas fa-camera' })
            ),
            !isCollapsed && React.createElement('div', { 
                key: 'content',
                className: 'timepoint-content' 
            }, [
                React.createElement('span', { 
                    key: 'desc',
                    className: 'timepoint-description' 
                }, timepoint.tpDescription),
                React.createElement('span', { 
                    key: 'date',
                    className: 'timepoint-date' 
                }, formatDate(timepoint.tpDateTime))
            ])
        ]);
    };

    return React.createElement('div', {
        className: `patient-sidebar ${isCollapsed ? 'collapsed' : ''} ${isMobile ? 'mobile' : ''}`
    }, [
        // Sidebar header with toggle
        React.createElement('div', { 
            key: 'header',
            className: 'sidebar-header' 
        }, [
            React.createElement('button', {
                key: 'toggle',
                className: 'sidebar-toggle',
                onClick: toggleSidebar,
                'aria-label': isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
            },
                React.createElement('i', { 
                    className: `fas ${isCollapsed ? 'fa-chevron-right' : 'fa-chevron-left'}` 
                })
            ),
            !isCollapsed && React.createElement('h3', { 
                key: 'title',
                className: 'sidebar-title' 
            }, 'Patient Navigation')
        ]),

        // Main navigation content
        React.createElement('div', { 
            key: 'content',
            className: 'sidebar-content' 
        }, [
            // Static navigation items section
            React.createElement('div', { 
                key: 'static',
                className: 'nav-section' 
            }, [
                !isCollapsed && React.createElement('div', { 
                    key: 'title',
                    className: 'section-title' 
                }, 'Patient Records'),
                
                ...staticNavItems.map(item => 
                    renderNavItem({
                        ...item,
                        path: `/patient/${patientId}${item.path}`
                    }, isCurrentPath(item.path))
                )
            ]),

            // Timepoints section
            loading ? React.createElement('div', { 
                key: 'loading',
                className: 'nav-section loading' 
            }, [
                React.createElement('div', { 
                    key: 'icon',
                    className: 'nav-item-icon' 
                },
                    React.createElement('i', { className: 'fas fa-spinner fa-spin' })
                ),
                !isCollapsed && React.createElement('span', { 
                    key: 'text',
                    className: 'nav-item-label' 
                }, 'Loading timepoints...')
            ]) : 
            
            error ? React.createElement('div', { 
                key: 'error',
                className: 'nav-section error' 
            }, [
                React.createElement('div', { 
                    key: 'icon',
                    className: 'nav-item-icon' 
                },
                    React.createElement('i', { className: 'fas fa-exclamation-triangle' })
                ),
                !isCollapsed && React.createElement('span', { 
                    key: 'text',
                    className: 'nav-item-label' 
                }, 'Error loading timepoints')
            ]) :
            
            timepoints.length > 0 && React.createElement('div', { 
                key: 'timepoints',
                className: 'nav-section timepoints-section' 
            }, [
                !isCollapsed && React.createElement('div', { 
                    key: 'title',
                    className: 'section-title' 
                }, 'Photo Sessions'),
                
                ...timepoints.map(timepoint => renderTimepointItem(timepoint))
            ])
        ]),

        // Sidebar footer
        React.createElement('div', { 
            key: 'footer',
            className: 'sidebar-footer' 
        }, [
            React.createElement('div', {
                key: 'appointments',
                className: 'sidebar-nav-item appointments-item',
                onClick: (e) => {
                    e.preventDefault();
                    window.location.href = '/simplified';
                }
            }, [
                React.createElement('div', { 
                    key: 'icon',
                    className: 'nav-item-icon' 
                },
                    React.createElement('i', { className: 'fas fa-calendar-day' })
                ),
                !isCollapsed && React.createElement('span', { 
                    key: 'label',
                    className: 'nav-item-label' 
                }, 'Today\'s Appointments')
            ])
        ])
    ]);
};

window.Navigation = Navigation;