import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { patientTypesQuery } from '@/query/queries';

/**
 * Read-only Patient Types viewer for the Lookups settings tab.
 *
 * Patient type is NO LONGER a staff-editable lookup — it is DERIVED from each
 * patient's works by the classifier (shared/treatment-taxonomy.ts) and materialized
 * into patients.patient_type_id on every works change. Editing these rows would
 * corrupt that classifier, so the table is intentionally excluded from the generic
 * lookup CRUD (LOOKUP_TABLE_CONFIG). This surfaces the current rows as a read-only
 * reference table "for completeness", reusing the shared lookup-editor table styles.
 */
const PatientTypesReadOnly: React.FC = () => {
    const { data, isLoading, isError } = useQuery(patientTypesQuery());
    const rows = data ?? [];

    return (
        <div className="lookup-editor">
            <p className="section-description">
                <i className="fas fa-circle-info"></i>{' '}
                Patient type is set automatically from each patient&apos;s treatments — it can&apos;t be
                edited here. This list is shown for reference only.
            </p>

            {isLoading ? (
                <div className="lookup-loading">
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading patient types...</span>
                </div>
            ) : isError ? (
                <div className="lookup-loading">
                    <i className="fas fa-triangle-exclamation"></i>
                    <span>Failed to load patient types.</span>
                </div>
            ) : (
                <div className="lookup-table-container">
                    <table className="lookup-table">
                        <thead>
                            <tr>
                                <th className="id-column">ID</th>
                                <th>Patient Type</th>
                            </tr>
                        </thead>
                        <tbody>
                            {rows.length === 0 ? (
                                <tr>
                                    <td colSpan={2} className="empty-row">
                                        <i className="fas fa-inbox"></i> No patient types found.
                                    </td>
                                </tr>
                            ) : (
                                rows.map((row) => (
                                    <tr key={row.id}>
                                        <td className="id-cell">{row.id}</td>
                                        <td>{row.name ?? '—'}</td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                    {rows.length > 0 && (
                        <div className="lookup-table-footer">
                            <span className="item-count">{rows.length} patient types</span>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};

export default PatientTypesReadOnly;
