import React, { useState, useEffect, useRef } from 'react'

const UniversalHeader = () => {
    const [currentPatient, setCurrentPatient] = useState(null);
    const [navigationContext, setNavigationContext] = useState(null);
    const [isSearchVisible, setIsSearchVisible] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [allPatients, setAllPatients] = useState([]);
    
    const searchTimeoutRef = useRef(null);

    useEffect(() => {
        loadPatientData();
        setupNavigationContext();
        // loadAllPatients(); // Temporarily disabled - endpoint doesn't exist
    }, []);

    const loadPatientData = () => {
        const patientCode = extractPatientCodeFromURL();
        
        if (patientCode) {
            fetch(`/api/getinfos?code=${patientCode}`)
                .then(response => response.json())
                .then(data => {
                    if (data && data.length > 0) {
                        setCurrentPatient(data[0]);
                    }
                })
                .catch(error => console.error('Error loading patient data:', error));
        }
    };

    const extractPatientCodeFromURL = () => {
        const path = window.location.pathname;
        const patientMatch = path.match(/\/patient\/(\d+)/);
        return patientMatch ? patientMatch[1] : null;
    };

    const setupNavigationContext = () => {
        const referrer = document.referrer;
        const currentPath = window.location.pathname;
        
        let context = {
            currentPage: getCurrentPageType(currentPath),
            previousPage: getCurrentPageType(referrer),
            breadcrumbs: []
        };
        
        // Simple breadcrumb logic - can be enhanced
        if (referrer && referrer !== currentPath) {
            context.breadcrumbs.push({
                name: context.previousPage,
                url: referrer
            });
        }
        
        setNavigationContext(context);
    };

    const getCurrentPageType = (url) => {
        if (!url) return 'Unknown';
        
        if (url.includes('/search')) return 'Search';
        if (url.includes('/patient')) return 'Patient';
        if (url.includes('/appointment')) return 'Appointments';
        if (url.includes('/home')) return 'Home';
        
        return 'Dashboard';
    };

    const loadAllPatients = () => {
        // Temporarily disabled - endpoint doesn't exist
        // TODO: Create /api/getallpatients endpoint or use alternative
        setAllPatients([]);
    };

    const handleSearchInput = (event) => {
        const value = event.target.value;
        setSearchTerm(value);
        
        // Clear existing timeout
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        
        // Set new timeout for debounced search
        searchTimeoutRef.current = setTimeout(() => {
            performSearch(value);
        }, 300);
    };

    const performSearch = (term) => {
        if (!term || term.length < 2) {
            setSearchResults([]);
            return;
        }
        
        const filtered = allPatients
            .filter(patient => 
                patient.name?.toLowerCase().includes(term.toLowerCase()) ||
                patient.phone?.includes(term) ||
                patient.code?.toString().includes(term)
            )
            .slice(0, 8); // Limit to 8 results
        
        setSearchResults(filtered);
    };

    const toggleSearch = () => {
        setIsSearchVisible(!isSearchVisible);
        if (isSearchVisible) {
            // Clear search when hiding
            setSearchTerm('');
            setSearchResults([]);
        }
    };

    const navigateToPatient = (patientCode) => {
        window.location.href = `/patient/${patientCode}/grid`;
    };


    const navigateToSearch = () => {
        window.location.href = '/patient-management';
    };

    const navigateBack = () => {
        if (navigationContext && navigationContext.breadcrumbs.length > 0) {
            const lastBreadcrumb = navigationContext.breadcrumbs[navigationContext.breadcrumbs.length - 1];
            window.location.href = lastBreadcrumb.url;
        } else {
            window.history.back();
        }
    };

    const navigateToDashboard = () => {
        window.location.href = '/dashboard';
    };

    const navigateToAppointments = () => {
        window.location.href = '/appointments';
    };


    // Header navigation items configuration
    const getNavigationItems = () => {
        return [
            {
                key: 'dashboard',
                label: 'Dashboard',
                icon: 'fas fa-home',
                onClick: navigateToDashboard,
                isActive: window.location.pathname === '/' || window.location.pathname === '/dashboard'
            },
            {
                key: 'appointments',
                label: 'Appointments',
                icon: 'fas fa-calendar-alt',
                onClick: navigateToAppointments,
                isActive: window.location.pathname.includes('/appointment')
            },
            {
                key: 'search',
                label: 'Search',
                icon: 'fas fa-search',
                onClick: navigateToSearch,
                isActive: window.location.pathname.includes('/search')
            },
        ];
    };

    return (
        <header className="universal-header">
            <div className="header-container">
                {/* Header Left - Logo/Brand */}
                <div className="header-left">
                    <div className="logo-section" onClick={() => window.location.href = '/'}>
                        <h1 className="clinic-name">Shwan Orthodontics</h1>
                    </div>
                </div>

                {/* Header Center - Main Navigation */}
                <div className="header-center">
                    <nav className="main-navigation">
                        {getNavigationItems().map(item => (
                            <button
                                key={item.key}
                                className={`nav-btn ${item.isActive ? 'active' : ''}`}
                                onClick={item.onClick}
                            >
                                <i className={item.icon} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                        
                        {/* Current Patient Navigation */}
                        {currentPatient && (
                            <button
                                className="nav-btn patient-nav active"
                                onClick={() => navigateToPatient(currentPatient.code)}
                            >
                                <i className="fas fa-user" />
                                <span>{currentPatient.name}</span>
                            </button>
                        )}
                    </nav>
                </div>

                {/* Header Right - Quick Actions */}
                <div className="header-right">
                    {/* Quick Search */}
                    <div className="quick-search-section">
                        <button className="search-toggle-btn" onClick={toggleSearch}>
                            <i className="fas fa-search" />
                        </button>
                        
                        {isSearchVisible && (
                            <div className="quick-search-dropdown">
                                <input
                                    type="text"
                                    placeholder="Search patients..."
                                    value={searchTerm}
                                    onChange={handleSearchInput}
                                    className="quick-search-input"
                                    autoFocus
                                />
                                
                                {searchResults.length > 0 && (
                                    <div className="search-results">
                                        {searchResults.map(patient => (
                                            <div
                                                key={patient.code}
                                                className="search-result-item"
                                                onClick={() => {
                                                    navigateToPatient(patient.code);
                                                    toggleSearch();
                                                }}
                                            >
                                                <div className="patient-name">{patient.name}</div>
                                                <div className="patient-details">
                                                    ID: {patient.code} | Phone: {patient.phone}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                
                                {searchTerm.length >= 2 && searchResults.length === 0 && (
                                    <div className="no-results">
                                        No patients found matching "{searchTerm}"
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Back Button */}
                    {navigationContext && navigationContext.breadcrumbs.length > 0 && (
                        <button className="back-btn" onClick={navigateBack}>
                            <i className="fas fa-arrow-left" />
                        </button>
                    )}
                </div>
            </div>
        </header>
    );
};

export default UniversalHeader;