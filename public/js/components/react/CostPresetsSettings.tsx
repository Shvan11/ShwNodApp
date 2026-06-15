import { useState, ChangeEvent, FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { costPresetsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import styles from './CostPresetsSettings.module.css';

type Currency = 'IQD' | 'USD' | 'EUR';

interface CostPreset {
    preset_id: number;
    amount: number;
    currency: Currency;
    display_order: number;
}

interface FormData {
    amount: string;
    currency: Currency;
    displayOrder: number;
}

const CostPresetsSettings = () => {
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const { data, isLoading: loading } = useQuery(costPresetsQuery());
    const presets: CostPreset[] = data ?? [];
    const [activeCurrency, setActiveCurrency] = useState<Currency>('IQD');
    const [editingPreset, setEditingPreset] = useState<CostPreset | null>(null);
    const [formData, setFormData] = useState<FormData>({
        amount: '',
        currency: 'IQD',
        displayOrder: 0
    });
    const [displayAmount, setDisplayAmount] = useState('');

    // Refresh the shared cost-presets cache after a write.
    const reloadPresets = () => queryClient.invalidateQueries({ queryKey: qk.lookups.costPresets() });

    // Filter presets by currency
    const filteredPresets = presets.filter(p => p.currency === activeCurrency);

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
            await postJSON('/api/settings/cost-presets', {
                amount: parseFloat(formData.amount),
                currency: formData.currency,
                displayOrder: parseInt(String(formData.displayOrder)) || 0
            });

            toast.success('Preset created successfully');
            setFormData({ amount: '', currency: activeCurrency, displayOrder: 0 });
            setDisplayAmount('');
            reloadPresets();
        } catch (error) {
            console.error('Error creating preset:', error);
            toast.error(httpErrorMessage(error, 'Failed to create preset'));
        }
    };

    // Edit preset
    const handleEditPreset = (preset: CostPreset) => {
        setEditingPreset(preset);
        setFormData({
            amount: String(preset.amount),
            currency: preset.currency,
            displayOrder: preset.display_order
        });
        setDisplayAmount(preset.amount ? formatNumber(preset.amount) : '');
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
            await putJSON(`/api/settings/cost-presets/${editingPreset.preset_id}`, {
                amount: parseFloat(formData.amount),
                currency: formData.currency,
                displayOrder: parseInt(String(formData.displayOrder)) || 0
            });

            toast.success('Preset updated successfully');
            setEditingPreset(null);
            setFormData({ amount: '', currency: activeCurrency, displayOrder: 0 });
            setDisplayAmount('');
            reloadPresets();
        } catch (error) {
            console.error('Error updating preset:', error);
            toast.error(httpErrorMessage(error, 'Failed to update preset'));
        }
    };

    // Delete preset
    const handleDeletePreset = async (preset_id: number) => {
        if (!await confirm('Are you sure you want to delete this preset?', { title: 'Delete Preset', danger: true, confirmText: 'Delete' })) {
            return;
        }

        try {
            await deleteJSON(`/api/settings/cost-presets/${preset_id}`);

            toast.success('Preset deleted successfully');
            reloadPresets();
        } catch (error) {
            console.error('Error deleting preset:', error);
            toast.error(httpErrorMessage(error, 'Failed to delete preset'));
        }
    };

    // Cancel edit
    const handleCancelEdit = () => {
        setEditingPreset(null);
        setFormData({ amount: '', currency: activeCurrency, displayOrder: 0 });
        setDisplayAmount('');
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
                                type="text"
                                id="amount"
                                name="amount"
                                value={displayAmount}
                                onChange={(e) => {
                                    const digits = e.target.value.replace(/[^\d]/g, '');
                                    const num = parseInt(digits, 10) || 0;
                                    setDisplayAmount(num ? num.toLocaleString('en-US') : '');
                                    setFormData(prev => ({ ...prev, amount: String(num) }));
                                }}
                                onBlur={() => setDisplayAmount(formData.amount ? formatNumber(parseInt(formData.amount, 10)) : '')}
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
                                    <tr key={preset.preset_id}>
                                        <td>{formatNumber(preset.amount)}</td>
                                        <td>{preset.currency}</td>
                                        <td>{preset.display_order}</td>
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
                                                onClick={() => handleDeletePreset(preset.preset_id)}
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
