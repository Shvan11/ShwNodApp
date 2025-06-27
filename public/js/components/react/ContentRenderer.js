// ContentRenderer.js - Content area renderer for patient portal
const ContentRenderer = ({ patientId, page, params }) => {
    const { useState, useEffect } = React;
    
    const [loading, setLoading] = useState(true);
    const [contentUrl, setContentUrl] = useState('');
    
    // For React components, render directly instead of iframe
    if (page === 'grid') {
        return React.createElement(window.GridComponent, {
            patientId: patientId,
            tpCode: params.tp || '0'
        });
    }
    
    if (page === 'payments') {
        return React.createElement(window.PaymentsComponent, {
            patientId: patientId
        });
    }
    
    if (page === 'xrays') {
        return React.createElement(window.XraysComponent, {
            patientId: patientId
        });
    }
    
    if (page === 'visits') {
        return React.createElement(window.VisitsComponent, {
            patientId: patientId
        });
    }
    
    if (page === 'compare') {
        return React.createElement(window.CompareComponent, {
            patientId: patientId,
            phone: new URLSearchParams(window.location.search).get('phone')
        });
    }
    
    useEffect(() => {
        let url = '';
        
        switch (page) {
            case 'payments':
                url = `/views/patient/payments-content.html?code=${patientId}`;
                break;
            case 'xrays':
                url = `/views/xrays.html?code=${patientId}`;
                break;
            case 'visits':
                url = `/views/patient/visits-summary.html?PID=${patientId}`;
                break;
            default:
                url = `/views/patient/grid-content.html?code=${patientId}`;
        }
        
        setContentUrl(url);
        setLoading(true);
    }, [patientId, page, params]);
    
    const handleIframeLoad = () => {
        setLoading(false);
    };
    
    return React.createElement('div', {
        className: 'content-area'
    }, [
        loading && React.createElement('div', {
            key: 'loading',
            className: 'loading-spinner'
        }, 'Loading content...'),
        
        React.createElement('iframe', {
            key: 'iframe',
            className: 'content-iframe',
            src: contentUrl,
            onLoad: handleIframeLoad,
            style: { display: loading ? 'none' : 'block' }
        })
    ]);
};

window.ContentRenderer = ContentRenderer;