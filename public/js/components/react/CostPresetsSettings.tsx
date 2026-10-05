import { useRef, useState, ChangeEvent, FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { costPresetsQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import type { GetPresetsResponse } from '@shared/contracts/cost-preset.contract';
import styles from './CostPresetsSettings.module.css';

type CostPreset = GetPresetsResponse[number];
type Currency = CostPreset['currency'];

interface FormData {
    amount: string;
    displayOrder: number;
}

const CURRENCIES: ReadonlyArray<{ value: Currency; icon: string }> = [
    { value: 'IQD', icon: 'fas fa-coins' },
    { value: 'USD', icon: 'fas fa-dollar-sign' },
    { value: 'EUR', icon: 'fas fa-euro-sign' },
];

const CostPresetsSettings = () => {
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();
    const { data, isLoading: loading } = useQuery(costPresetsQuery());
    const presets: CostPreset[] = data ?? [];
    // The preset writes are admin-only on the server; everyone else gets the list
    // read-only instead of a form that 403s at Save (FE-F21-3).
    const user = useAuthUser();
    const canEdit = roleCaps(user?.role as UserRole | undefined).manageSettings;
    // The currency a new preset is saved in IS the tab being viewed. The form had its
    // own currency select, starting at IQD and never following the tabs, so a preset
    // added on the USD tab was saved as IQD (FE-F21-8).
    const [activeCurrency, setActiveCurrency] = useState<Currency>('IQD');
    const [editingPreset, setEditingPreset] = useState<CostPreset | null>(null);
    const [formData, setFormData] = useState<FormData>({ amount: '', displayOrder: 0 });
    const [displayAmount, setDisplayAmount] = useState('');
    // One write at a time (a double-clicked Add made two presets).
    const writingRef = useRef(false);
    const [writing, setWriting] = useState(false);
    const runWrite = async (fn: () => Promise<void>): Promise<void> => {
        if (writingRef.current) return;
        writingRef.current = true;
        setWriting(true);
        try {
            await fn();
        } finally {
            writingRef.current = false;
            setWriting(false);
        }
    };

    // Refresh the shared cost-presets cache after a write.
    const reloadPresets = () => queryClient.invalidateQueries({ queryKey: qk.lookups.costPresets() });

    // Filter presets by currency
    const filteredPresets = presets.filter(p => p.currency === activeCurrency);

    const handleDisplayOrderChange = (e: ChangeEvent<HTMLInputElement>) => {
        setFormData(prev => ({ ...prev, displayOrder: parseInt(e.target.value, 10) || 0 }));
    };

    const resetForm = () => {
        setEditingPreset(null);
        setFormData({ amount: '', displayOrder: 0 });
        setDisplayAmount('');
    };

    const switchCurrency = (currency: Currency) => {
        // A half-typed edit belongs to the preset's own currency; leaving its tab ends it.
        if (editingPreset && editingPreset.currency !== currency) resetForm();
        setActiveCurrency(currency);
    };

    // Create or update a preset in the active tab's currency.
    const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
        e.preventDefault();

        if (!formData.amount || parseFloat(formData.amount) <= 0) {
            toast.warning('Please enter a valid amount');
            return;
        }

        const editing = editingPreset;
        const body = {
            amount: parseFloat(formData.amount),
            currency: activeCurrency,
            displayOrder: formData.displayOrder,
        };
        void runWrite(async () => {
            try {
                if (editing) {
                    await putJSON(`/api/settings/cost-presets/${editing.preset_id}`, body);
                    toast.success('Preset updated successfully');
                } else {
                    await postJSON('/api/settings/cost-presets', body);
                    toast.success('Preset created successfully');
                }
                resetForm();
                reloadPresets();
            } catch (error) {
                toast.error(httpErrorMessage(error, editing ? 'Failed to update preset' : 'Failed to create preset'));
            }
        });
    };

    const handleEditPreset = (preset: CostPreset) => {
        setActiveCurrency(preset.currency);
        setEditingPreset(preset);
        setFormData({ amount: String(preset.amount), displayOrder: preset.display_order });
        setDisplayAmount(preset.amount ? formatNumber(preset.amount) : '');
    };

    const handleDeletePreset = async (preset_id: number) => {
        if (!await confirm('Are you sure you want to delete this preset?', { title: 'Delete Preset', danger: true, confirmText: 'Delete' })) {
            return;
        }
        await runWrite(async () => {
            try {
                await deleteJSON(`/api/settings/cost-presets/${preset_id}`);
                toast.success('Preset deleted successfully');
                if (editingPreset?.preset_id === preset_id) resetForm();
                reloadPresets();
            } catch (error) {
                toast.error(httpErrorMessage(error, 'Failed to delete preset'));
            }
        });
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
                {CURRENCIES.map(({ value, icon }) => (
                    <button
                        key={value}
                        type="button"
                        className={`${styles.currencyTab} ${activeCurrency === value ? styles.active : ''}`}
                        aria-pressed={activeCurrency === value}
                        onClick={() => switchCurrency(value)}
                    >
                        <i className={icon}></i> {value}
                    </button>
                ))}
            </div>

            <div className={`${styles.presetsContent} ${canEdit ? '' : styles.presetsContentReadOnly}`}>
                {/* Add/Edit Form — admin only */}
                {canEdit && (
                    <div className={styles.presetFormCard}>
                        <h3>{editingPreset ? `Edit ${activeCurrency} Preset` : `Add ${activeCurrency} Preset`}</h3>
                        <form onSubmit={handleSubmit}>
                            <div className={styles.formGroup}>
                                <label htmlFor="amount">Amount ({activeCurrency})</label>
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
                                <label htmlFor="displayOrder">Display Order</label>
                                <input
                                    type="number"
                                    id="displayOrder"
                                    name="displayOrder"
                                    value={formData.displayOrder}
                                    onChange={handleDisplayOrderChange}
                                    placeholder="0"
                                />
                            </div>

                            <div className={styles.formActions}>
                                {editingPreset ? (
                                    <>
                                        <button type="submit" className="btn btn-primary" disabled={writing}>
                                            <i className="fas fa-save"></i> Update
                                        </button>
                                        <button type="button" className="btn btn-secondary" onClick={resetForm} disabled={writing}>
                                            <i className="fas fa-times"></i> Cancel
                                        </button>
                                    </>
                                ) : (
                                    <button type="submit" className="btn btn-primary" disabled={writing}>
                                        <i className="fas fa-plus"></i> Add Preset
                                    </button>
                                )}
                            </div>
                        </form>
                    </div>
                )}

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
                                    {canEdit && <th>Actions</th>}
                                </tr>
                            </thead>
                            <tbody>
                                {filteredPresets.map(preset => (
                                    <tr key={preset.preset_id}>
                                        <td>{formatNumber(preset.amount)}</td>
                                        <td>{preset.currency}</td>
                                        <td>{preset.display_order}</td>
                                        {canEdit && (
                                            <td className={styles.actions}>
                                                <button
                                                    type="button"
                                                    className={`${styles.btnIcon} ${styles.btnEdit}`}
                                                    onClick={() => handleEditPreset(preset)}
                                                    title="Edit"
                                                    aria-label="Edit"
                                                >
                                                    <i className="fas fa-edit" aria-hidden="true"></i>
                                                </button>
                                                <button
                                                    type="button"
                                                    className={`${styles.btnIcon} ${styles.btnDelete}`}
                                                    onClick={() => handleDeletePreset(preset.preset_id)}
                                                    disabled={writing}
                                                    title="Delete"
                                                    aria-label="Delete"
                                                >
                                                    <i className="fas fa-trash" aria-hidden="true"></i>
                                                </button>
                                            </td>
                                        )}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className={styles.emptyState}>
                            <i className="fas fa-inbox fa-3x"></i>
                            <p>No presets found for {activeCurrency}</p>
                            {canEdit && <p className={styles.hint}>Add a preset using the form above</p>}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default CostPresetsSettings;
