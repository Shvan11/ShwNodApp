import React, { useState, useEffect, SyntheticEvent } from 'react';

interface Props {
    patientId?: string;
}

interface Xray {
    name: string;
    date?: string;
    detailsDirName: string;
    previewImagePartialPath?: string;
}

interface PatientInfo {
    xrays?: Xray[];
}

const XraysComponent = ({ patientId }: Props) => {
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (patientId && patientId !== 'new') {
            loadXrays();
        }
    }, [patientId]);

    const loadXrays = async () => {
        try {
            setLoading(true);
            console.log('Loading X-rays for patient:', patientId);

            const response = await fetch(`/api/patients/${patientId}/info`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const patientData = await response.json();
            console.log('Patient info received:', patientData);
            setPatientInfo(patientData);
        } catch (err) {
            console.error('Error loading X-rays:', err);
            setError(err instanceof Error ? err.message : 'Unknown error');
        } finally {
            setLoading(false);
        }
    };

    const handleXrayClick = (xray: Xray) => {
        const xrayUrl = `/api/patients/${patientId}/xray?file=${xray.name}&detailsDir=${xray.detailsDirName}`;
        window.open(xrayUrl, '_blank');
    };

    const handleSendClick = (xray: Xray) => {
        const xrayUrl = `/api/patients/${patientId}/xray?file=${xray.name}&detailsDir=${xray.detailsDirName}`;
        const sendMessageUrl = `/send-message?file=${encodeURIComponent(xrayUrl)}`;
        window.open(sendMessageUrl, '_blank');
    };

    const formatXrayDate = (dateString: string | undefined): string => {
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

    const handleImageError = (e: SyntheticEvent<HTMLImageElement>) => {
        const target = e.target as HTMLImageElement;
        target.style.display = 'none';
        const nextSibling = target.nextSibling as HTMLElement;
        if (nextSibling) {
            nextSibling.style.display = 'flex';
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

    console.log('X-rays Component Rendering:', { patientId, xraysCount: xrays.length });

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
                                        onError={handleImageError}
                                    />
                                ) : null}

                                <div
                                    className={`xray-placeholder ${xray.previewImagePartialPath ? 'hidden' : ''}`}
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
