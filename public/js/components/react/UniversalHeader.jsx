import React, { useState, useEffect } from 'react'
import { useNavigate, useLocation } from 'react-router-dom';

const UniversalHeader = () => {
    const navigate = useNavigate();
    const location = useLocation();

    const [currentPatient, setCurrentPatient] = useState(null);
    const [navigationContext, setNavigationContext] = useState(null);
    const [currentUser, setCurrentUser] = useState(null);

    // Load user info once on mount
    useEffect(() => {
        loadCurrentUser();
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

    const navigateToPatient = (patientCode) => {
        navigate(`/patient/${patientCode}/photos/tp0`);
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