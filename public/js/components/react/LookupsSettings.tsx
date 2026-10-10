import React, { useState, useEffect } from 'react';
import cn from 'classnames';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { adminLookupTablesQuery, photoSlotsQuery } from '@/query/queries';
import LookupEditor from './LookupEditor';
import HolidayEditor from './HolidayEditor';
import CostPresetsSettings from './CostPresetsSettings';
import PatientTypesReadOnly from './PatientTypesReadOnly';
import PhotoSlotNamesEditor from './PhotoSlotNamesEditor';
import type { LookupTableInfo } from '@shared/contracts/lookup-admin.contract';

// The accordion shell is this tab's own module; the global sheet stays imported
// for the editor internals it shares with LookupEditor/HolidayEditor/etc.
import styles from './LookupsSettings.module.css';
import '../../../css/components/lookup-editor.css';

// Synthetic table entry for cost presets — backed by /api/settings/cost-presets,
// not the generic /api/admin/lookups CRUD (Decimal Amount column isn't
// representable in the generic lookup-admin whitelist).
const COST_PRESETS_TABLE_KEY = 'tblEstimatedCostPresets';

// Synthetic READ-ONLY entry for patient types — the rows are code-coupled to the
// works-derived classifier so they aren't staff-editable; shown for reference via
// the /api/patient-types feed, not the generic lookup CRUD.
const PATIENT_TYPES_TABLE_KEY = 'patientTypesReadOnly';

// Synthetic entry for the clinic's names for Dolphin's photo slots outside the grid views
// (/api/photo-slots: the codes are fixed by Dolphin's files, so it is rename-only, which the
// generic CRUD can't express). Listed only where some photo uses such a slot: an install that
// never ran Dolphin has none.
const PHOTO_SLOTS_TABLE_KEY = 'photoSlotNames';

type TableConfig = LookupTableInfo;

interface TableGroup {
    name: string;
    icon: string;
    keys: string[];
}

interface LookupsSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

/**
 * Main Lookups Settings tab component
 * Displays all lookup tables in an accordion layout
 */
const LookupsSettings: React.FC<LookupsSettingsProps> = ({ onChangesUpdate: _onChangesUpdate }) => {
    const toast = useToast();
    const { data, isLoading: loading, isError } = useQuery(adminLookupTablesQuery());
    const { data: photoSlots } = useQuery(photoSlotsQuery());
    const [expandedTable, setExpandedTable] = useState<string | null>(null);

    useEffect(() => {
        if (isError) toast.error('Failed to load lookup tables configuration');
    }, [isError, toast]);

    // Append the synthetic cost-presets entry (its own endpoint, not the generic CRUD).
    const costPresetsEntry: TableConfig = {
        key: COST_PRESETS_TABLE_KEY,
        displayName: 'Cost Presets',
        icon: 'fas fa-dollar-sign',
        idColumn: 'PresetID',
        columns: [],
        protectedIds: [],
    };
    // Append the synthetic READ-ONLY patient-types entry (derived-not-editable).
    const patientTypesEntry: TableConfig = {
        key: PATIENT_TYPES_TABLE_KEY,
        displayName: 'Patient Types (read-only)',
        icon: 'fas fa-user-tag',
        idColumn: 'id',
        columns: [],
        protectedIds: [],
    };
    const photoSlotsEntry: TableConfig = {
        key: PHOTO_SLOTS_TABLE_KEY,
        displayName: 'Photo Slot Names',
        icon: 'fas fa-images',
        idColumn: 'code',
        columns: [],
        protectedIds: [],
    };
    const hasPhotoSlots = photoSlots?.some((s) => s.images > 0) ?? false;
    const tables = data
        ? [...data, costPresetsEntry, patientTypesEntry, ...(hasPhotoSlots ? [photoSlotsEntry] : [])]
        : [];

    const toggleTable = (tableKey: string): void => {
        setExpandedTable(expandedTable === tableKey ? null : tableKey);
    };

    // Group tables by category for better organization
    const tableGroups: TableGroup[] = [
        {
            name: 'Scheduling',
            icon: 'fas fa-calendar-alt',
            keys: ['tblHolidays']
        },
        {
            name: 'Clinical',
            icon: 'fas fa-stethoscope',
            keys: ['tblWorkType', 'tblKeyWord', 'tblDetail', 'tblImplantManufacturer', 'tblShadeVitaClassic', 'tblShade3dMaster', 'tblLabs', 'tblTimePointNames', PHOTO_SLOTS_TABLE_KEY]
        },
        {
            name: 'Patient Information',
            icon: 'fas fa-user',
            // patient_types is code-coupled to the works-derived classifier, so it's not
            // staff-editable — it appears here only as a READ-ONLY reference table.
            keys: ['tblTagOptions', 'tblReferrals', 'tblAddress', 'tblAlertTypes', PATIENT_TYPES_TABLE_KEY]
        },
        {
            name: 'Templates',
            icon: 'fas fa-file-alt',
            keys: ['DocumentTypes']
        },
        {
            name: 'Financial',
            icon: 'fas fa-dollar-sign',
            keys: [COST_PRESETS_TABLE_KEY, 'tblExpenseCategories', 'tblExpenseSubcategories']
        }
    ];

    // Create a map of tables by key for quick lookup
    const tableMap: Record<string, TableConfig> = {};
    tables.forEach(table => {
        tableMap[table.key] = table;
    });

    if (loading) {
        return (
            <div className={styles.lookupsSettings}>
                <div className="settings-section">
                    <h3>
                        <i className="fas fa-list" aria-hidden="true"></i>
                        Lookup Table Management
                    </h3>
                    <div className="lookup-loading">
                        <i className="fas fa-spinner fa-spin" aria-hidden="true"></i>
                        <span>Loading lookup tables...</span>
                    </div>
                </div>
            </div>
        );
    }

    // One accordion row. Shared by the grouped sections and the "Other" catch-all
    // below so the two can't drift; the editor a row opens is chosen here, since
    // four tables are backed by something other than the generic lookup CRUD.
    const renderAccordionItem = (table: TableConfig) => (
        <div
            key={table.key}
            className={cn(styles.item, expandedTable === table.key && styles.expanded)}
        >
            <button
                className={styles.itemHeader}
                onClick={() => toggleTable(table.key)}
                type="button"
            >
                <span className={styles.title}>
                    <i className={table.icon} aria-hidden="true"></i>
                    <span className={styles.titleText}>{table.displayName}</span>
                </span>
                <i className={cn(`fas fa-chevron-${expandedTable === table.key ? 'up' : 'down'}`, styles.chevron)} aria-hidden="true"></i>
            </button>

            {expandedTable === table.key && (
                <div className={styles.content}>
                    {table.key === 'tblHolidays' ? (
                        <HolidayEditor
                            tableKey={table.key}
                            tableName={table.displayName}
                            columns={table.columns}
                            idColumn={table.idColumn}
                        />
                    ) : table.key === COST_PRESETS_TABLE_KEY ? (
                        <CostPresetsSettings />
                    ) : table.key === PATIENT_TYPES_TABLE_KEY ? (
                        <PatientTypesReadOnly />
                    ) : table.key === PHOTO_SLOTS_TABLE_KEY ? (
                        <PhotoSlotNamesEditor />
                    ) : (
                        <LookupEditor
                            tableKey={table.key}
                            tableName={table.displayName}
                            columns={table.columns}
                            idColumn={table.idColumn}
                            protectedIds={table.protectedIds}
                        />
                    )}
                </div>
            )}
        </div>
    );

    return (
        <div className={styles.lookupsSettings}>
            <div className="settings-section">
                <h3>
                    <i className="fas fa-list" aria-hidden="true"></i>
                    Lookup Table Management
                </h3>
                <p className="section-description">
                    Manage dropdown values and reference data used throughout the application.
                    Click on a section to expand and edit its values.
                </p>

                {tableGroups.map(group => {
                    // Get tables that exist in this group
                    const groupTables = group.keys
                        .map(key => tableMap[key])
                        .filter(Boolean);

                    if (groupTables.length === 0) return null;

                    return (
                        <div key={group.name} className={styles.group}>
                            <h4 className={styles.groupHeader}>
                                <i className={group.icon} aria-hidden="true"></i>
                                {group.name}
                            </h4>

                            <div className={styles.accordion}>
                                {groupTables.map(renderAccordionItem)}
                            </div>
                        </div>
                    );
                })}

                {/* Show any uncategorized tables */}
                {(() => {
                    const categorizedKeys = tableGroups.flatMap(g => g.keys);
                    const uncategorizedTables = tables.filter(t => !categorizedKeys.includes(t.key));

                    if (uncategorizedTables.length === 0) return null;

                    return (
                        <div className={styles.group}>
                            <h4 className={styles.groupHeader}>
                                <i className="fas fa-folder" aria-hidden="true"></i>
                                Other
                            </h4>

                            <div className={styles.accordion}>
                                {uncategorizedTables.map(renderAccordionItem)}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default LookupsSettings;
