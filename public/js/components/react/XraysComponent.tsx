import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { fetchJSON, httpErrorMessage } from '@/core/http';
import { formatDate } from '@/core/utils';
import * as patientContract from '@shared/contracts/patient.contract';
import { patientInfoQuery } from '../../query/queries';
import { useToast } from '../../contexts/ToastContext';
import styles from './XraysComponent.module.css';

interface Props {
    personId?: number | null;
}

type Xray = patientContract.XrayRow;

/**
 * An X-ray's capture date for display. CS-Imaging's `seriesDate` is DICOM-style
 * `YYYYMMDD` (the format is assumed from DICOM; confirm against one real `meta`
 * file); anything else parseable is shown as-is through `formatDate`. An
 * unreadable value is "Unknown Date" — the old fallback parsed the FILE NAME
 * (`new Date('OPG_2.pano')`), which does not throw, so every undated card read
 * "Invalid Date" (FE-F9-10).
 */
function formatXrayDate(raw: string | null | undefined): string {
    if (!raw) return 'Unknown Date';
    const dicom = /^(\d{4})(\d{2})(\d{2})$/.exec(raw.trim());
    const formatted = formatDate(dicom ? `${dicom[1]}-${dicom[2]}-${dicom[3]}` : raw);
    return formatted || 'Unknown Date';
}

const XraysComponent = ({ personId }: Props) => {
    const toast = useToast();
    // Shares the patientInfoQuery cache key with PatientShell/ViewPatientInfo —
    // one fetch, deduped. `xrays` is modelled by the patient-info contract.
    const { data: patientInfo, isLoading, error } = useQuery({
        ...patientInfoQuery(personId ?? ''),
        enabled: !!personId,
    });
    // Previews that failed to load show the placeholder instead (by name).
    const [brokenPreviews, setBrokenPreviews] = useState<ReadonlySet<string>>(() => new Set());
    const [preparingSend, setPreparingSend] = useState<string | null>(null);

    const xrayQuery = (xray: Xray): string =>
        `file=${encodeURIComponent(xray.name)}&detailsDir=${encodeURIComponent(xray.detailsDirName ?? '')}`;

    const handleXrayClick = (xray: Xray) => {
        window.open(`/api/patients/${personId}/xray?${xrayQuery(xray)}`, '_blank');
    };

    /**
     * `/send-message` posts its `?file=` to `/api/wa/sendmedia2`, which takes a
     * clinic FILESYSTEM path — the viewer's API URL was refused every time
     * (FE-F9-3). Ask the server to render the image and say where it is, the
     * way the photo grid asks `/api/convert-path`. The tab is opened up front,
     * inside the click, so a slow render can't trip the popup blocker.
     */
    const handleSendClick = async (xray: Xray) => {
        const tab = window.open('', '_blank');
        setPreparingSend(xray.name);
        try {
            const { path } = await fetchJSON<patientContract.XraySendPathResponse>(
                `/api/patients/${personId}/xray/send-path?${xrayQuery(xray)}`,
                { schema: patientContract.xraySendPath.response }
            );
            const url = `/send-message?file=${encodeURIComponent(path)}`;
            if (tab) tab.location.assign(url);
            else window.open(url, '_blank');
        } catch (err) {
            tab?.close();
            toast.error(httpErrorMessage(err, 'Could not prepare this X-ray for sending.'));
        } finally {
            setPreparingSend(null);
        }
    };

    if (isLoading) {
        return (
            <div className="loading-spinner">
                <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                <span>Loading X-rays...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="error-message">
                <i className="fas fa-exclamation-triangle" aria-hidden="true"></i>
                <span>Error: {httpErrorMessage(error, 'Unknown error')}</span>
            </div>
        );
    }

    const xrays = (patientInfo?.xrays ?? []).filter(xray => xray.name !== 'PatientInfo.xml');

    if (xrays.length === 0) {
        return (
            <div className="no-data-message">
                <i className="fas fa-x-ray" aria-hidden="true"></i>
                <h3>No X-rays Available</h3>
                <p>No X-ray records found for this patient.</p>
            </div>
        );
    }

    return (
        <div className={styles.component}>
            <div className={styles.header}>
                <h2>
                    <i className="fas fa-x-ray" aria-hidden="true"></i>
                    X-Ray Images ({xrays.length})
                </h2>
            </div>

            <div className={styles.grid}>
                {xrays.map((xray) => {
                    const showPreview = !!xray.previewImagePartialPath
                        && !!xray.detailsDirName
                        && !brokenPreviews.has(xray.name);
                    return (
                        <div key={xray.name} className={styles.card}>
                            <div className={styles.preview}>
                                <button
                                    type="button"
                                    className={styles.viewBtn}
                                    onClick={() => handleXrayClick(xray)}
                                    title="Click to view X-ray in full size"
                                >
                                    {showPreview ? (
                                        <img
                                            src={`/api/patients/${personId}/xray/preview?detailsDir=${encodeURIComponent(xray.detailsDirName ?? '')}`}
                                            className={styles.thumbnail}
                                            alt={`X-ray ${xray.name}`}
                                            onError={() => setBrokenPreviews(prev => new Set(prev).add(xray.name))}
                                        />
                                    ) : (
                                        <div className={styles.placeholder}>
                                            <i className="fas fa-x-ray" aria-hidden="true"></i>
                                            <span>View X-ray</span>
                                        </div>
                                    )}
                                </button>
                            </div>

                            <div className={styles.info}>
                                <div className={styles.date}>
                                    <i className="fas fa-calendar-alt" aria-hidden="true"></i>
                                    <span>{formatXrayDate(xray.date)}</span>
                                </div>

                                <div className={styles.actions}>
                                    <button
                                        type="button"
                                        className="btn btn-primary btn-sm"
                                        onClick={() => handleXrayClick(xray)}
                                        title="Open X-ray in new window"
                                    >
                                        <i className="fas fa-eye" aria-hidden="true"></i>
                                        View
                                    </button>

                                    <button
                                        type="button"
                                        className="btn btn-secondary btn-sm"
                                        onClick={() => void handleSendClick(xray)}
                                        disabled={preparingSend === xray.name}
                                        title="Send X-ray via message"
                                    >
                                        <i
                                            className={preparingSend === xray.name ? 'fas fa-spinner fa-spin' : 'fas fa-paper-plane'}
                                            aria-hidden="true"
                                        ></i>
                                        Send
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })}
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
