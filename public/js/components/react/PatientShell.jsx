import React, { useState, useEffect, useCallback } from 'react'
import Navigation from './Navigation.jsx'
import ContentRenderer from './ContentRenderer.jsx'

const PatientShell = () => {
    // Simple URL parser
    const parseCurrentUrl = () => {
        const path = window.location.pathname;
        const search = window.location.search;
        const urlParams = new URLSearchParams(search);
        
        // Get patient ID from query param ?patient=214 or ?code=214
        const patientId = urlParams.get('patient') || urlParams.get('code') || '';
        
        // Get page from query param ?page=grid or default to grid
        const page = urlParams.get('page') || 'grid';
        
        return {
            patientId: patientId,
            page: page,
            search: search,
            fullPath: path + search
        };
    };
    
    const [currentUrl, setCurrentUrl] = useState(parseCurrentUrl());
    const [isNavigationCollapsed, setIsNavigationCollapsed] = useState(false);
    const [patientData, setPatientData] = useState({ name: '', loading: true, error: null });
    
    const handleNavigate = useCallback((page) => {
        // Build new URL with current patient ID and new page
        const currentPatientId = currentUrl.patientId;
        const newUrl = `${window.location.pathname}?patient=${currentPatientId}&page=${page}`;
        
        // Update browser URL without reload
        window.history.pushState({}, '', newUrl);
        
        // Update component state to trigger re-render
        setCurrentUrl(parseCurrentUrl());
    }, [currentUrl.patientId]);

    // Fetch patient data when patient ID changes
    const fetchPatientData = useCallback(async (patientId) => {
        if (!patientId) {
            setPatientData({ name: '', loading: false, error: 'No patient ID provided' });
            return;
        }

        try {
            setPatientData(prev => ({ ...prev, loading: true, error: null }));
            const response = await fetch(`/api/getinfos?code=${patientId}`);
            
            if (!response.ok) {
                throw new Error(`Failed to fetch patient data: ${response.status}`);
            }
            
            const data = await response.json();
            const patientName = data.name || `Patient ${patientId}`;
            
            setPatientData({ name: patientName, loading: false, error: null });
        } catch (error) {
            console.error('Error fetching patient data:', error);
            setPatientData({ 
                name: `Patient ${patientId}`, 
                loading: false, 
                error: error.message 
            });
        }
    }, []);

    // Fetch patient data when patient ID changes
    useEffect(() => {
        if (currentUrl.patientId) {
            fetchPatientData(currentUrl.patientId);
        }
    }, [currentUrl.patientId, fetchPatientData]);
    
    // Listen for browser back/forward events and custom URL changes
    useEffect(() => {
        const handlePopState = () => {
            setCurrentUrl(parseCurrentUrl());
        };
        
        const handleUrlChanged = () => {
            setCurrentUrl(parseCurrentUrl());
        };
        
        window.addEventListener('popstate', handlePopState);
        window.addEventListener('urlChanged', handleUrlChanged);
        return () => {
            window.removeEventListener('popstate', handlePopState);
            window.removeEventListener('urlChanged', handleUrlChanged);
        };
    }, []);

    // Check for mobile screen size
    useEffect(() => {
        const checkMobile = () => {
            const isMobile = window.innerWidth <= 768;
            if (isMobile) {
                setIsNavigationCollapsed(true);
            }
        };
        
        checkMobile();
        window.addEventListener('resize', checkMobile);
        return () => window.removeEventListener('resize', checkMobile);
    }, []);
    
    const params = {
        tp: new URLSearchParams(currentUrl.search).get('tp'),
        view: new URLSearchParams(currentUrl.search).get('view'),
        filter: new URLSearchParams(currentUrl.search).get('filter'),
        // Add other params as needed
    };

    const toggleNavigation = () => {
        setIsNavigationCollapsed(!isNavigationCollapsed);
    };
    
    return (
        <div 
            id="patient-shell" 
            className={`patient-shell-container ${isNavigationCollapsed ? 'nav-collapsed' : ''}`}
        >
            {/* Navigation Toggle Button (Mobile) */}
            <button 
                className="nav-toggle-btn"
                onClick={toggleNavigation}
                aria-label={isNavigationCollapsed ? 'Show navigation' : 'Hide navigation'}
            >
                <i className={`fas ${isNavigationCollapsed ? 'fa-bars' : 'fa-times'}`}></i>
            </button>

            {/* Navigation Sidebar */}
            <div className={`navigation-sidebar ${isNavigationCollapsed ? 'collapsed' : ''}`}>
                <Navigation
                    patientId={currentUrl.patientId}
                    currentPath={currentUrl.fullPath}
                    onNavigate={handleNavigate}
                />
            </div>

            {/* Main Content Area */}
            <div className="main-content-area">
                {/* Breadcrumb */}
                <div className="breadcrumb-container">
                    <nav className="breadcrumb">
                        <span className="breadcrumb-item">
                            <i className="fas fa-user"></i>
                            {' '}
                            {patientData.loading ? `Patient ${currentUrl.patientId}` : patientData.name}
                        </span>
                        {currentUrl.page !== 'grid' && (
                            <>
                                <span className="breadcrumb-separator">/</span>
                                <span className="breadcrumb-item active">
                                    {currentUrl.page.charAt(0).toUpperCase() + currentUrl.page.slice(1)}
                                </span>
                            </>
                        )}
                    </nav>
                </div>

                {/* Page Content */}
                <div className="page-content">
                    <ContentRenderer
                        patientId={currentUrl.patientId}
                        page={currentUrl.page}
                        params={params}
                    />
                </div>
            </div>

            {/* Mobile Navigation Overlay */}
            {!isNavigationCollapsed && (
                <div 
                    className="nav-overlay mobile-only"
                    onClick={toggleNavigation}
                ></div>
            )}
        </div>
    );
};

export default PatientShell;