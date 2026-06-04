import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { fetchJSON } from '@/core/http';
import LookupEditor from './LookupEditor';
import HolidayEditor from './HolidayEditor';
import CostPresetsSettings from './CostPresetsSettings';

// Import component-specific CSS
import '../../../css/components/lookup-editor.css';

// Synthetic table entry for cost presets — backed by /api/settings/cost-presets,
// not the generic /api/admin/lookups CRUD (Decimal Amount column isn't
// representable in the generic lookup-admin whitelist).
const COST_PRESETS_TABLE_KEY = 'tblEstimatedCostPresets';

// Types
interface ReferenceConfig {
    table: string;
    idColumn: string;
    displayColumn: string;
}

interface ColumnConfig {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    maxLength?: number;
    reference?: ReferenceConfig;
}

interface TableConfig {
    key: string;
    displayName: string;
    icon: string;
    columns: ColumnConfig[];
    idColumn: string;
}

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
    const [tables, setTables] = useState<TableConfig[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [expandedTable, setExpandedTable] = useState<string | null>(null);

    useEffect(() => {
        loadTableConfigs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const loadTableConfigs = async (): Promise<void> => {
        try {
            setLoading(true);
            const data = await fetchJSON<TableConfig[]>('/api/admin/lookups/tables');
            const costPresetsEntry: TableConfig = {
                key: COST_PRESETS_TABLE_KEY,
                displayName: 'Cost Presets',
                icon: 'fas fa-dollar-sign',
                idColumn: 'PresetID',
                columns: [],
            };
            setTables([...data, costPresetsEntry]);
        } catch {
            toast.error('Failed to load lookup tables configuration');
        } finally {
            setLoading(false);
        }
    };

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
            keys: ['tblWorkType', 'tblKeyWord', 'tblDetail', 'tblImplantManufacturer']
        },
        {
            name: 'Patient Information',
            icon: 'fas fa-user',
            keys: ['tblPatientType', 'tblTagOptions', 'tblReferrals', 'tblAddress', 'tblAlertTypes']
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
            <div className="lookups-settings">
                <div className="settings-section">
                    <h3>
                        <i className="fas fa-list"></i>
                        Lookup Table Management
                    </h3>
                    <div className="lookup-loading">
                        <i className="fas fa-spinner fa-spin"></i>
                        <span>Loading lookup tables...</span>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="lookups-settings">
            <div className="settings-section">
                <h3>
                    <i className="fas fa-list"></i>
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
                        <div key={group.name} className="lookup-group">
                            <h4 className="lookup-group-header">
                                <i className={group.icon}></i>
                                {group.name}
                            </h4>

                            <div className="lookup-accordion">
                                {groupTables.map(table => (
                                    <div
                                        key={table.key}
                                        className={`lookup-accordion-item ${expandedTable === table.key ? 'expanded' : ''}`}
                                    >
                                        <button
                                            className="lookup-accordion-header"
                                            onClick={() => toggleTable(table.key)}
                                            type="button"
                                        >
                                            <span className="accordion-title">
                                                <i className={table.icon}></i>
                                                <span className="accordion-title-text">{table.displayName}</span>
                                            </span>
                                            <i className={`fas fa-chevron-${expandedTable === table.key ? 'up' : 'down'} accordion-chevron`}></i>
                                        </button>

                                        {expandedTable === table.key && (
                                            <div className="lookup-accordion-content">
                                                {table.key === 'tblHolidays' ? (
                                                    <HolidayEditor
                                                        tableKey={table.key}
                                                        tableName={table.displayName}
                                                        columns={table.columns}
                                                        idColumn={table.idColumn}
                                                    />
                                                ) : table.key === COST_PRESETS_TABLE_KEY ? (
                                                    <CostPresetsSettings />
                                                ) : (
                                                    <LookupEditor
                                                        tableKey={table.key}
                                                        tableName={table.displayName}
                                                        columns={table.columns}
                                                        idColumn={table.idColumn}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
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
                        <div className="lookup-group">
                            <h4 className="lookup-group-header">
                                <i className="fas fa-folder"></i>
                                Other
                            </h4>

                            <div className="lookup-accordion">
                                {uncategorizedTables.map(table => (
                                    <div
                                        key={table.key}
                                        className={`lookup-accordion-item ${expandedTable === table.key ? 'expanded' : ''}`}
                                    >
                                        <button
                                            className="lookup-accordion-header"
                                            onClick={() => toggleTable(table.key)}
                                            type="button"
                                        >
                                            <span className="accordion-title">
                                                <i className={table.icon}></i>
                                                <span className="accordion-title-text">{table.displayName}</span>
                                            </span>
                                            <i className={`fas fa-chevron-${expandedTable === table.key ? 'up' : 'down'} accordion-chevron`}></i>
                                        </button>

                                        {expandedTable === table.key && (
                                            <div className="lookup-accordion-content">
                                                {table.key === 'tblHolidays' ? (
                                                    <HolidayEditor
                                                        tableKey={table.key}
                                                        tableName={table.displayName}
                                                        columns={table.columns}
                                                        idColumn={table.idColumn}
                                                    />
                                                ) : table.key === COST_PRESETS_TABLE_KEY ? (
                                                    <CostPresetsSettings />
                                                ) : (
                                                    <LookupEditor
                                                        tableKey={table.key}
                                                        tableName={table.displayName}
                                                        columns={table.columns}
                                                        idColumn={table.idColumn}
                                                    />
                                                )}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    );
                })()}
            </div>
        </div>
    );
};

export default LookupsSettings;
