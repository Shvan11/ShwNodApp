import React, { useState, useEffect } from 'react';
import { useToast } from '../../contexts/ToastContext';
import LookupEditor from './LookupEditor';
import HolidayEditor from './HolidayEditor';

// Import component-specific CSS
import '../../../css/components/lookup-editor.css';

// Types
interface ColumnConfig {
    name: string;
    label: string;
    type: string;
    required?: boolean;
    maxLength?: number;
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
const LookupsSettings: React.FC<LookupsSettingsProps> = ({ onChangesUpdate }) => {
    const toast = useToast();
    const [tables, setTables] = useState<TableConfig[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [expandedTable, setExpandedTable] = useState<string | null>(null);

    useEffect(() => {
        loadTableConfigs();
    }, []);

    const loadTableConfigs = async (): Promise<void> => {
        try {
            setLoading(true);
            const response = await fetch('/api/admin/lookups/tables');
            if (response.ok) {
                const data: TableConfig[] = await response.json();
                setTables(data);
            } else {
                toast.error('Failed to load lookup tables configuration');
            }
        } catch (error) {
            toast.error('Error loading lookup tables');
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
