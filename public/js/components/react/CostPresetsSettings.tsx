import { useState, useEffect, ChangeEvent, FormEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import styles from './CostPresetsSettings.module.css';

type Currency = 'IQD' | 'USD' | 'EUR';

interface CostPreset {
    PresetID: number;
    Amount: number;
    Currency: Currency;
    DisplayOrder: number;
}

interface FormData {
    amount: string;
    currency: Currency;
    displayOrder: number;
}

const CostPresetsSettings = () => {
    const toast = useToast();
    const [presets, setPresets] = useState<CostPreset[]>([]);
    const [loading, setLoading] = useState(true);
    const [activeCurrency, setActiveCurrency] = useState<Currency>('IQD');
    const [editingPreset, setEditingPreset] = useState<CostPreset | null>(null);
    const [formData, setFormData] = useState<FormData>({
        amount: '',
        currency: 'IQD',
        displayOrder: 0
    });

    // Load presets
    const loadPresets = async () => {
        try {
            setLoading(true);
            const response = await fetch('/api/settings/cost-presets');
            if (response.ok) {
                const data = await response.json();
                setPresets(data);
            } else {
                toast.error('Failed to load cost presets');
            }
        } catch (error) {
            console.error('Error loading presets:', error);
            toast.error('Error loading cost presets');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadPresets();
    }, []);

    // Filter presets by currency
    const filteredPresets = presets.filter(p => p.Currency === activeCurrency);

    // Handle form input changes
    const handleInputChange = (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    // Create new preset
    const handleCreatePreset = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.warning('Please enter a valid amount');
            return;
        }

        try {
            const response = await fetch('/api/settings/cost-presets', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: parseFloat(formData.amount),
                    currency: formData.currency,
                    displayOrder: parseInt(String(formData.displayOrder)) || 0
                })
            });

            if (response.ok) {
                toast.success('Preset created successfully');
                setFormData({ amount: '', currency: activeCurrency, displayOrder: 0 });
                loadPresets();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to create preset');
            }
        } catch (error) {
            console.error('Error creating preset:', error);
            toast.error('Error creating preset');
        }
    };

    // Edit preset
    const handleEditPreset = (preset: CostPreset) => {
        setEditingPreset(preset);
        setFormData({
            amount: String(preset.Amount),
            currency: preset.Currency,
            displayOrder: preset.DisplayOrder
        });
    };

    // Update preset
    const handleUpdatePreset = async (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.warning('Please enter a valid amount');
            return;
        }

        if (!editingPreset) return;

        try {
            const response = await fetch(`/api/settings/cost-presets/${editingPreset.PresetID}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    amount: parseFloat(formData.amount),
                    currency: formData.currency,
                    displayOrder: parseInt(String(formData.displayOrder)) || 0
                })
            });

            if (response.ok) {
                toast.success('Preset updated successfully');
                setEditingPreset(null);
                setFormData({ amount: '', currency: activeCurrency, displayOrder: 0 });
                loadPresets();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to update preset');
            }
        } catch (error) {
            console.error('Error updating preset:', error);
            toast.error('Error updating preset');
        }
    };

    // Delete preset
    const handleDeletePreset = async (presetId: number) => {
        if (!confirm('Are you sure you want to delete this preset?')) {
            return;
        }

        try {
            const response = await fetch(`/api/settings/cost-presets/${presetId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                toast.success('Preset deleted successfully');
                loadPresets();
            } else {
                const error = await response.json();
                toast.error(error.error || 'Failed to delete preset');
            }
        } catch (error) {
            console.error('Error deleting preset:', error);
            toast.error('Error deleting preset');
        }
    };

    // Cancel edit
    const handleCancelEdit = () => {
        setEditingPreset(null);
        setFormData({ amount: '', currency: activeCurrency, displayOrder: 0 });
    };

    // Format number with commas
    const formatNumber = (num: number): string => {
        return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    };

    if (loading) {
        return (
            <div className={`${styles.costPresetsSettings} ${styles.loading}`}>
                <i className="fas fa-spinner fa-spin fa-2x"></i>
                <p>Loading cost presets...</p>
            </div>
        );
    }

    return (
        <div className={styles.costPresetsSettings}>
            <div className={styles.settingsHeader}>
                <h2>
                    <i className="fas fa-dollar-sign"></i> Estimated Cost Presets
                </h2>
                <p>Manage preset values for estimated treatment costs</p>
            </div>

            {/* Currency Tabs */}
            <div className={styles.currencyTabs}>
                <button
                    className={`${styles.currencyTab} ${activeCurrency === 'IQD' ? styles.active : ''}`}
                    onClick={() => setActiveCurrency('IQD')}
                >
                    <i className="fas fa-coins"></i> IQD
                </button>
                <button
                    className={`${styles.currencyTab} ${activeCurrency === 'USD' ? styles.active : ''}`}
                    onClick={() => setActiveCurrency('USD')}
                >
                    <i className="fas fa-dollar-sign"></i> USD
                </button>
                <button
                    className={`${styles.currencyTab} ${activeCurrency === 'EUR' ? styles.active : ''}`}
                    onClick={() => setActiveCurrency('EUR')}
                >
                    <i className="fas fa-euro-sign"></i> EUR
                </button>
            </div>

            <div className={styles.presetsContent}>
                {/* Add/Edit Form */}
                <div className={styles.presetFormCard}>
                    <h3>{editingPreset ? 'Edit Preset' : 'Add New Preset'}</h3>
                    <form onSubmit={editingPreset ? handleUpdatePreset : handleCreatePreset}>
                        <div className={styles.formGroup}>
                            <label htmlFor="amount">Amount</label>
                            <input
                                type="number"
                                id="amount"
                                name="amount"
                                value={formData.amount}
                                onChange={handleInputChange}
                                placeholder="Enter amount"
                                required
                            />
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="currency">Currency</label>
                            <select
                                id="currency"
                                name="currency"
                                value={formData.currency}
                                onChange={handleInputChange}
                            >
                                <option value="IQD">IQD</option>
                                <option value="USD">USD</option>
                                <option value="EUR">EUR</option>
                            </select>
                        </div>

                        <div className={styles.formGroup}>
                            <label htmlFor="displayOrder">Display Order</label>
                            <input
                                type="number"
                                id="displayOrder"
                                name="displayOrder"
                                value={formData.displayOrder}
                                onChange={handleInputChange}
                                placeholder="0"
                            />
                        </div>

                        <div className={styles.formActions}>
                            {editingPreset ? (
                                <>
                                    <button type="submit" className="btn btn-primary">
                                        <i className="fas fa-save"></i> Update
                                    </button>
                                    <button type="button" className="btn btn-secondary" onClick={handleCancelEdit}>
                                        <i className="fas fa-times"></i> Cancel
                                    </button>
                                </>
                            ) : (
                                <button type="submit" className="btn btn-primary">
                                    <i className="fas fa-plus"></i> Add Preset
                                </button>
                            )}
                        </div>
                    </form>
                </div>

                {/* Presets Table */}
                <div className={styles.presetsTableCard}>
                    <h3>{activeCurrency} Presets ({filteredPresets.length})</h3>
                    {filteredPresets.length > 0 ? (
                        <table className={styles.presetsTable}>
                            <thead>
                                <tr>
                                    <th>Amount</th>
                                    <th>Currency</th>
                                    <th>Display Order</th>
                                    <th>Actions</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPresets.map(preset => (
                                    <tr key={preset.PresetID}>
                                        <td>{formatNumber(preset.Amount)}</td>
                                        <td>{preset.Currency}</td>
                                        <td>{preset.DisplayOrder}</td>
                                        <td className={styles.actions}>
                                            <button
                                                className={`${styles.btnIcon} ${styles.btnEdit}`}
                                                onClick={() => handleEditPreset(preset)}
                                                title="Edit"
                                            >
                                                <i className="fas fa-edit"></i>
                                            </button>
                                            <button
                                                className={`${styles.btnIcon} ${styles.btnDelete}`}
                                                onClick={() => handleDeletePreset(preset.PresetID)}
                                                title="Delete"
                                            >
                                                <i className="fas fa-trash"></i>
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className={styles.emptyState}>
                            <i className="fas fa-inbox fa-3x"></i>
                            <p>No presets found for {activeCurrency}</p>
                            <p className={styles.hint}>Add a preset using the form above</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CostPresetsSettings;
