// PatientShell.js - Main patient shell component
const PatientShell = () => {
    const { useState, useEffect, useCallback } = React;
    
    // Simple URL parser
    const parseCurrentUrl = () => {
        const path = window.location.pathname;
        const search = window.location.search;
        const pathParts = path.split('/');
        
        return {
            patientId: pathParts[2] || '',
            page: pathParts[3] || 'grid',
            search: search,
            fullPath: path + search
        };
    };
    
    const [currentUrl, setCurrentUrl] = useState(parseCurrentUrl());
    
    const handleNavigate = useCallback((newPath) => {
        // Update browser URL without reload
        window.history.pushState({}, '', newPath);
        
        // Update component state to trigger re-render
        setCurrentUrl(parseCurrentUrl());
    }, []);
    
    // Listen for browser back/forward events
    useEffect(() => {
        const handlePopState = () => {
            setCurrentUrl(parseCurrentUrl());
        };
        
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, []);
    
    const params = {
        tp: new URLSearchParams(currentUrl.search).get('tp'),
        // Add other params as needed
    };
    
    return React.createElement('div', {
        id: 'patient-shell',
        className: 'patient-shell-container'
    }, [
        React.createElement(window.Navigation, {
            key: 'navigation',
            patientId: currentUrl.patientId,
            currentPath: currentUrl.fullPath,
            onNavigate: handleNavigate
        }),
        React.createElement('div', {
            key: 'main-content',
            className: 'main-content-area'
        },
            React.createElement(window.ContentRenderer, {
                key: 'content',
                patientId: currentUrl.patientId,
                page: currentUrl.page,
                params: params
            })
        )
    ]);
};

window.PatientShell = PatientShell;