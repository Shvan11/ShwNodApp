// Navigation.js - Navigation component for patient portal
const Navigation = ({ patientId, currentPath, onNavigate }) => {
    const { useState, useEffect, useCallback } = React;
    
    const [timepoints, setTimepoints] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
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
    
    const isCurrentPath = (path) => {
        return currentPath.includes(path);
    };
    
    const handleNavigation = (path) => {
        onNavigate(path);
    };
    
    if (loading) {
        return React.createElement('div', {
            className: 'header'
        }, 
            React.createElement('ul', { className: 'nav' },
                React.createElement('li', null,
                    React.createElement('a', {
                        href: '#',
                        style: { color: '#ccc' }
                    }, 'Loading navigation...')
                )
            )
        );
    }
    
    if (error) {
        return React.createElement('div', {
            className: 'header'
        },
            React.createElement('ul', { className: 'nav' },
                React.createElement('li', null,
                    React.createElement('a', {
                        href: '/',
                        style: { color: '#ff6b6b' }
                    }, 'Navigation Error - Go Home')
                )
            )
        );
    }
    
    return React.createElement('div', {
        className: 'header navigation-header'
    },
        React.createElement('ul', { className: 'nav' }, [
            // Dynamic timepoint tabs
            ...timepoints.map((timepoint) =>
                React.createElement('li', { key: timepoint.tpCode },
                    React.createElement('a', {
                        href: '#',
                        className: isCurrentPath(`tp=${timepoint.tpCode}`) ? 'selectedTP' : '',
                        onClick: (e) => {
                            e.preventDefault();
                            handleNavigation(`/patient/${patientId}/grid?tp=${timepoint.tpCode}`);
                        }
                    }, `${timepoint.tpDescription} ${formatDate(timepoint.tpDateTime)}`)
                )
            ),
            
            // Static tabs
            React.createElement('li', { key: 'compare' },
                React.createElement('a', {
                    href: '#',
                    className: isCurrentPath('/compare') ? 'selectedTP' : '',
                    onClick: (e) => {
                        e.preventDefault();
                        handleNavigation(`/patient/${patientId}/compare`);
                    }
                }, 'Compare')
            ),
            
            React.createElement('li', { key: 'xrays' },
                React.createElement('a', {
                    href: '#',
                    className: isCurrentPath('/xrays') ? 'selectedTP' : '',
                    onClick: (e) => {
                        e.preventDefault();
                        handleNavigation(`/patient/${patientId}/xrays`);
                    }
                }, 'X-rays')
            ),
            
            React.createElement('li', { key: 'visits' },
                React.createElement('a', {
                    href: '#',
                    className: isCurrentPath('/visits') ? 'selectedTP' : '',
                    onClick: (e) => {
                        e.preventDefault();
                        handleNavigation(`/patient/${patientId}/visits`);
                    }
                }, 'Visit Summary')
            ),
            
            React.createElement('li', { key: 'payments' },
                React.createElement('a', {
                    href: '#',
                    className: isCurrentPath('/payments') ? 'selectedTP' : '',
                    onClick: (e) => {
                        e.preventDefault();
                        handleNavigation(`/patient/${patientId}/payments`);
                    }
                }, 'Payments')
            ),
            
            React.createElement('li', { key: 'home' },
                React.createElement('a', {
                    href: '/',
                    onClick: (e) => {
                        e.preventDefault();
                        window.location.href = '/';
                    }
                }, 'Home')
            )
        ])
    );
};

window.Navigation = Navigation;