import React, { useState, useEffect, SyntheticEvent } from 'react';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import * as patientContract from '@shared/contracts/patient.contract';
import styles from './XraysComponent.module.css';

interface Props {
    personId?: number | null;
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

const XraysComponent = ({ personId }: Props) => {
    const [patientInfo, setPatientInfo] = useState<PatientInfo | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (personId) {
            loadXrays();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [personId]);

    const loadXrays = async () => {
        try {
            setLoading(true);

            const patientData = await fetchJSON<PatientInfo>(`/api/patients/${personId}/info`, { schema: patientContract.patientInfo.response });
            setPatientInfo(patientData);
        } catch (err) {
            console.error('Error loading X-rays:', err);
            setError(httpErrorMessage(err, 'Unknown error'));
        } finally {
            setLoading(false);
        }
    };

    const buildXrayUrl = (xray: Xray): string =>
        `/api/patients/${personId}/xray?file=${encodeURIComponent(xray.name)}&detailsDir=${encodeURIComponent(xray.detailsDirName ?? '')}`;

    const handleXrayClick = (xray: Xray) => {
        window.open(buildXrayUrl(xray), '_blank');
    };

    const handleSendClick = (xray: Xray) => {
        const xrayUrl = buildXrayUrl(xray);
        const sendMessageUrl = `/send-message?file=${encodeURIComponent(xrayUrl)}`;
        window.open(sendMessageUrl, '_blank');
    };

    const formatXrayDate = (dateString: string | undefined): string => {
        if (!dateString) return 'Unknown Date';
        try {
            const date = new Date(dateString);
            return date.toLocaleDateString(undefined, {
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

    return (
        <div className={styles.component}>
            <div className={styles.header}>
                <h2>
                    <i className="fas fa-x-ray"></i>
                    X-Ray Images ({xrays.length})
                </h2>
            </div>

            <div className={styles.grid}>
                {xrays.map((xray, index) => (
                    <div key={index} className={styles.card}>
                        <div className={styles.preview}>
                            <button
                                className={styles.viewBtn}
                                onClick={() => handleXrayClick(xray)}
                                title="Click to view X-ray in full size"
                            >
                                {xray.previewImagePartialPath ? (
                                    <img
                                        src={`/clinic-assets/${personId}${xray.previewImagePartialPath}`}
                                        className={styles.thumbnail}
                                        alt={`X-ray ${xray.name}`}
                                        onError={handleImageError}
                                    />
                                ) : null}

                                <div
                                    className={`${styles.placeholder} ${xray.previewImagePartialPath ? 'hidden' : ''}`}
                                >
                                    <i className="fas fa-x-ray"></i>
                                    <span>View X-ray</span>
                                </div>
                            </button>
                        </div>

                        <div className={styles.info}>
                            <div className={styles.date}>
                                <i className="fas fa-calendar-alt"></i>
                                <span>{formatXrayDate(xray.date || xray.name)}</span>
                            </div>

                            <div className={styles.actions}>
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

            <div className={styles.footer}>
                <div className={styles.summary}>
                    <span className={styles.summaryText}>
                        Total X-rays: <strong>{xrays.length}</strong>
                    </span>
                </div>
            </div>
        </div>
    );
};

export default XraysComponent;
