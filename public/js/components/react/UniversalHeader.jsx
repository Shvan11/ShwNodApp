import React, { useState, useEffect, useRef } from 'react'
import { useNavigate, useLocation } from 'react-router-dom';

const UniversalHeader = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [currentPatient, setCurrentPatient] = useState(null);
    const [navigationContext, setNavigationContext] = useState(null);
    const [isSearchVisible, setIsSearchVisible] = useState(false);
    const [searchResults, setSearchResults] = useState([]);
    const [searchTerm, setSearchTerm] = useState('');
    const [allPatients, setAllPatients] = useState([]);
    const [currentUser, setCurrentUser] = useState(null);

    const searchTimeoutRef = useRef(null);

    // Load user info once on mount
    useEffect(() => {
        loadCurrentUser();
        // loadAllPatients(); // Temporarily disabled - endpoint doesn't exist

        // Cleanup: Remove any legacy fullscreen preference from localStorage
        localStorage.removeItem('preferFullscreen');
    }, []); // Only run once on mount

    // Load patient data and setup navigation context when route changes
    useEffect(() => {
        loadPatientData();
        setupNavigationContext();
    }, [location.pathname]); // Re-run when route changes

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

    const loadCurrentUser = () => {
        fetch('/api/auth/me')
            .then(response => {
                if (response.status === 401) {
                    // Not authenticated - redirect to login
                    window.location.href = '/login.html';
                    return null;
                }
                return response.json();
            })
            .then(data => {
                if (data && data.success && data.user) {
                    setCurrentUser(data.user);
                }
            })
            .catch(error => console.error('Error loading user info:', error));
    };

    const extractPatientCodeFromURL = () => {
        const path = location.pathname;
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
        navigate(`/patient/${patientCode}/grid`);
    };

    const navigateToSearch = () => {
        // Open the search dropdown instead of navigating immediately
        setIsSearchVisible(true);
    };

    const handleSearchSubmit = (e) => {
        if (e.key === 'Enter' && searchTerm.trim()) {
            // Navigate to patient-management with search term
            navigate(`/patient-management?search=${encodeURIComponent(searchTerm.trim())}`);
        }
    };

    const navigateBack = () => {
        window.history.back();
    };

    const navigateToDashboard = () => {
        navigate('/dashboard');
    };

    const navigateToAppointments = () => {
        navigate('/appointments');
    };

    const navigateToPatientManagement = () => {
        navigate('/patient-management');
    };

    // Header navigation items configuration
    const getNavigationItems = () => {
        return [
            {
                key: 'dashboard',
                label: 'Dashboard',
                icon: 'fas fa-home',
                onClick: navigateToDashboard,
                isActive: location.pathname === '/' || location.pathname === '/dashboard'
            },
            {
                key: 'appointments',
                label: 'Appointments',
                icon: 'fas fa-calendar-alt',
                onClick: navigateToAppointments,
                isActive: location.pathname.includes('/appointment')
            },
            {
                key: 'search',
                label: 'Search',
                icon: 'fas fa-search',
                onClick: navigateToPatientManagement,
                isActive: location.pathname.includes('/patient-management')
            },
        ];
    };

    return (
        <header className="universal-header">
            <div className="header-container">
                {/* Header Left - Logo/Brand */}
                <div className="header-left">
                    <div className="logo-section" onClick={() => navigate('/')}>
                        <h1 className="clinic-name">Shwan Orthodontics</h1>
                    </div>
                </div>

                {/* Header Center - Main Navigation */}
                <div className="header-center">
                    <nav className="main-navigation">
                        {getNavigationItems().map(item => (
                            <button
                                key={item.key}
                                className={`nav-btn ${item.isActive ? 'active' : ''} ${item.disabled ? 'disabled' : ''}`}
                                onClick={item.onClick}
                                disabled={item.disabled}
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
                    {/* Current User Info */}
                    {currentUser && (
                        <div className="user-info">
                            <i className="fas fa-user-circle" />
                            <div className="user-details">
                                <span className="user-name">{currentUser.fullName || currentUser.username}</span>
                                <span className="user-role">{currentUser.role}</span>
                            </div>
                        </div>
                    )}

                    {/* Quick Search */}
                    <div className="quick-search-section">
                        <button className="search-toggle-btn" onClick={toggleSearch}>
                            <i className="fas fa-search" />
                        </button>

                        {isSearchVisible && (
                            <div className="quick-search-dropdown">
                                <input
                                    type="text"
                                    placeholder="Search patients (Arabic name)..."
                                    value={searchTerm}
                                    onChange={handleSearchInput}
                                    onKeyDown={handleSearchSubmit}
                                    className="quick-search-input"
                                    autoFocus
                                    style={{ direction: 'rtl', textAlign: 'right' }}
                                    lang="ar"
                                    dir="rtl"
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