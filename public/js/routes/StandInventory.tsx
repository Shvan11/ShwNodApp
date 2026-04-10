import { useState } from 'react';
import {
  useStandItems,
  useStandItemMutations,
} from '../hooks/useStand';
import type { StandItem, StandItemFilters } from '../hooks/useStand';
import ItemTable from '../components/stand/ItemTable';
import ItemFilters from '../components/stand/ItemFilters';
import ItemFormModal from '../components/stand/ItemFormModal';
import DeleteItemModal from '../components/stand/DeleteItemModal';
import RestockModal from '../components/stand/RestockModal';
import StockAdjustModal from '../components/stand/StockAdjustModal';
import StockMovementsModal from '../components/stand/StockMovementsModal';
import { useToast } from '../contexts/ToastContext';
import styles from './StandInventory.module.css';

export default function StandInventory() {
  const toast = useToast();

  // Filters
  const [filters, setFilters] = useState<StandItemFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<StandItemFilters>({});

  // Data
  const { items, loading, error, refetch } = useStandItems(appliedFilters);

  // Mutations
  const {
    createItem,
    updateItem,
    deleteItem,
    restockItem,
    adjustStock,
    loading: mutationLoading,
  } = useStandItemMutations(refetch);

  // Modal state
  const [formItem, setFormItem] = useState<StandItem | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<StandItem | null>(null);
  const [restockTarget, setRestockTarget] = useState<StandItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<StandItem | null>(null);
  const [movementsTarget, setMovementsTarget] = useState<StandItem | null>(null);

  // Filter handlers
  const handleFilterChange = (updates: Partial<StandItemFilters>) => {
    setFilters(prev => ({ ...prev, ...updates }));
  };

  const handleApplyFilters = () => setAppliedFilters(filters);

  const handleResetFilters = () => {
    setFilters({});
    setAppliedFilters({});
  };

  // CRUD handlers
  const handleAddItem = () => {
    setFormItem(null);
    setIsFormOpen(true);
  };

  const handleEditItem = (item: StandItem) => {
    setFormItem(item);
    setIsFormOpen(true);
  };

  const handleSaveItem = async (data: Record<string, unknown>) => {
    try {
      if (formItem) {
        await updateItem(formItem.ItemID, data);
        toast.success('Item updated successfully');
      } else {
        await createItem(data as unknown as Parameters<typeof createItem>[0]);
        toast.success('Item created successfully');
      }
      setIsFormOpen(false);
      setFormItem(null);
    } catch {
      toast.error(formItem ? 'Failed to update item' : 'Failed to create item');
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteItem(deleteTarget.ItemID);
      toast.success('Item deactivated successfully');
      setDeleteTarget(null);
    } catch {
      toast.error('Failed to deactivate item');
    }
  };

  const handleConfirmRestock = async (quantity: number, unitCost: number) => {
    if (!restockTarget) return;
    try {
      await restockItem(restockTarget.ItemID, quantity, unitCost);
      toast.success('Item restocked successfully');
      setRestockTarget(null);
    } catch {
      toast.error('Failed to restock item');
    }
  };

  const handleConfirmAdjust = async (delta: number, reason: string) => {
    if (!adjustTarget) return;
    try {
      await adjustStock(adjustTarget.ItemID, delta, reason);
      toast.success('Stock adjusted successfully');
      setAdjustTarget(null);
    } catch {
      toast.error('Failed to adjust stock');
    }
  };

  return (
    <div className={styles.inventoryContainer}>
      <div className={styles.pageHeader}>
        <h1>Stand Inventory</h1>
        <div className={styles.headerActions}>
          <button
            className="btn btn-primary"
            onClick={handleAddItem}
            disabled={mutationLoading}
          >
            Add New Item
          </button>
        </div>
      </div>

      <ItemFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onApply={handleApplyFilters}
        onReset={handleResetFilters}
      />

      {error && (
        <div className={styles.errorBanner}>
          <p>Error loading items: {error}</p>
          <button onClick={refetch} className="btn btn-secondary">Retry</button>
        </div>
      )}

      <ItemTable
        items={items}
        loading={loading}
        onEdit={handleEditItem}
        onDelete={(item) => setDeleteTarget(item)}
        onRestock={(item) => setRestockTarget(item)}
        onAdjust={(item) => setAdjustTarget(item)}
        onMovements={(item) => setMovementsTarget(item)}
      />

      <ItemFormModal
        isOpen={isFormOpen}
        item={formItem}
        onClose={() => { setIsFormOpen(false); setFormItem(null); }}
        onSave={handleSaveItem}
      />

      <DeleteItemModal
        isOpen={!!deleteTarget}
        item={deleteTarget}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      <RestockModal
        isOpen={!!restockTarget}
        item={restockTarget}
        onClose={() => setRestockTarget(null)}
        onSave={handleConfirmRestock}
      />

      <StockAdjustModal
        isOpen={!!adjustTarget}
        item={adjustTarget}
        onClose={() => setAdjustTarget(null)}
        onSave={handleConfirmAdjust}
      />

      <StockMovementsModal
        isOpen={!!movementsTarget}
        item={movementsTarget}
        onClose={() => setMovementsTarget(null)}
      />
    </div>
  );
}
