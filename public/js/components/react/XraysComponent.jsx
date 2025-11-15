import React, { useState, useEffect } from 'react'

const XraysComponent = ({ patientId }) => {
    const [patientInfo, setPatientInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    useEffect(() => {
        if (patientId && patientId !== 'new') {
            loadXrays();
        }
    }, [patientId]);

    const loadXrays = async () => {
        try {
            setLoading(true);
            console.log('Loading X-rays for patient:', patientId);

            const response = await fetch(`/api/getinfos?code=${patientId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const patientData = await response.json();
            console.log('Patient info received:', patientData);
            setPatientInfo(patientData);
        } catch (err) {
            console.error('Error loading X-rays:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const handleXrayClick = (xray) => {
        const xrayUrl = `/api/getxray/?code=${patientId}&file=${xray.name}&detailsDir=${xray.detailsDirName}`;
        window.open(xrayUrl, '_blank');
    };
    
    const handleSendClick = (xray) => {
        const xrayUrl = `/api/getxray/?code=${patientId}&file=${xray.name}&detailsDir=${xray.detailsDirName}`;
        const sendMessageUrl = `/send-message?file=${encodeURIComponent(xrayUrl)}`;
        window.open(sendMessageUrl, '_blank');
    };

    const formatXrayDate = (dateString) => {
        if (!dateString) return 'Unknown Date';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
            });
        } catch {
            return dateString;
        }
    };
    
    if (loading) {
        return (
            <div className="loading-spinner">
                <i className="fas fa-spinner fa-spin"></i>
                <span>Loading X-rays...</span>
            </div>
        );
    }
    
    if (error) {
        return (
            <div className="error-message">
                <i className="fas fa-exclamation-triangle"></i>
                <span>Error: {error}</span>
            </div>
        );
    }
    
    const xrays = patientInfo?.xrays?.filter(xray => xray.name !== 'PatientInfo.xml') || [];
    
    if (xrays.length === 0) {
        return (
            <div className="no-data-message">
                <i className="fas fa-x-ray"></i>
                <h3>No X-rays Available</h3>
                <p>No X-ray records found for this patient.</p>
            </div>
        );
    }
    
    console.log('🎯 X-rays Component Rendering:', { patientId, xraysCount: xrays.length });
    
    return (
        <div className="xrays-component">
            <div className="xrays-header">
                <h2>
                    <i className="fas fa-x-ray"></i>
                    X-Ray Images ({xrays.length})
                </h2>
            </div>
            
            <div className="xrays-grid">
                {xrays.map((xray, index) => (
                    <div key={index} className="xray-card">
                        <div className="xray-preview">
                            <button
                                className="xray-view-btn"
                                onClick={() => handleXrayClick(xray)}
                                title="Click to view X-ray in full size"
                            >
                                {xray.previewImagePartialPath ? (
                                    <img
                                        src={`/clinic-assets/${patientId}${xray.previewImagePartialPath}`}
                                        className="xray-thumbnail"
                                        alt={`X-ray ${xray.name}`}
                                        onError={(e) => {
                                            e.target.style.display = 'none';
                                            e.target.nextSibling.style.display = 'flex';
                                        }}
                                    />
                                ) : null}
                                
                                <div 
                                    className="xray-placeholder"
                                    style={{ 
                                        display: xray.previewImagePartialPath ? 'none' : 'flex' 
                                    }}
                                >
                                    <i className="fas fa-x-ray"></i>
                                    <span>View X-ray</span>
                                </div>
                            </button>
                        </div>
                        
                        <div className="xray-info">
                            <div className="xray-date">
                                <i className="fas fa-calendar-alt"></i>
                                <span>{formatXrayDate(xray.date || xray.name)}</span>
                            </div>
                            
                            <div className="xray-actions">
                                <button
                                    className="btn btn-primary btn-sm"
                                    onClick={() => handleXrayClick(xray)}
                                    title="Open X-ray in new window"
                                >
                                    <i className="fas fa-eye"></i>
                                    View
                                </button>
                                
                                <button
                                    className="btn btn-secondary btn-sm"
                                    onClick={() => handleSendClick(xray)}
                                    title="Send X-ray via message"
                                >
                                    <i className="fas fa-paper-plane"></i>
                                    Send
                                </button>
                            </div>
                        </div>
                    </div>
                ))}
            </div>
            
            <div className="xrays-footer">
                <div className="xrays-summary">
                    <span className="summary-text">
                        Total X-rays: <strong>{xrays.length}</strong>
                    </span>
                </div>
            </div>
        </div>
    );
};

export default XraysComponent;