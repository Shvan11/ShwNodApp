import { useState, useEffect } from 'react';
import { useStandItems, useStandItemMutations } from '../hooks/useStand';
import type { StandItem, StandItemFilters, CreateItemBody, UpdateItemBody } from '../hooks/useStand';
import ItemTable from '../components/stand/ItemTable';
import ItemFilters from '../components/stand/ItemFilters';
import ItemFormModal from '../components/stand/ItemFormModal';
import CategoryManagerModal from '../components/stand/CategoryManagerModal';
import DeleteItemModal from '../components/stand/DeleteItemModal';
import RestockModal from '../components/stand/RestockModal';
import StockAdjustModal from '../components/stand/StockAdjustModal';
import StockMovementsModal from '../components/stand/StockMovementsModal';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { useAuthUser } from '../contexts/GlobalStateContext';
import { roleCaps, type UserRole } from '@shared/auth/roles';
import { httpErrorMessage } from '@/core/http';
import { formatNumber } from '../utils/formatters';
import styles from './StandInventory.module.css';

const MODAL_STATE_KEY = 'standInventory.modalState';

interface PersistedModalState {
  isOpen: boolean;
  item: StandItem | null;
}

/**
 * The item form survives a RELOAD (a phone's camera can kill the tab mid-entry),
 * so its open state is kept in `sessionStorage`. Leaving the page is not a reload:
 * the flag is cleared on unmount, or an empty form reopened on every later visit
 * (FE-F19-13). A reload runs no cleanup, so the restore still works.
 */
function loadModalState(): PersistedModalState {
  try {
    const saved = sessionStorage.getItem(MODAL_STATE_KEY);
    if (saved) return JSON.parse(saved) as PersistedModalState;
  } catch {
    // ignore malformed storage
  }
  return { isOpen: false, item: null };
}

export default function StandInventory() {
  const toast = useToast();
  const confirm = useConfirm();
  const user = useAuthUser();
  // Delete, Adjust, Reactivate and the category manager are admin-only on the
  // server; front desk used to be offered them and get a 403 (FE-F19-7).
  const canAdmin = roleCaps(user?.role as UserRole | undefined).adminWrites;

  // Filters
  const [filters, setFilters] = useState<StandItemFilters>({});
  const [appliedFilters, setAppliedFilters] = useState<StandItemFilters>({});

  // Data
  const { items, asOf, loading, error, refetch } = useStandItems(appliedFilters);

  // Mutations
  const {
    createItem,
    updateItem,
    deleteItem,
    reactivateItem,
    restockItem,
    adjustStock,
    loading: mutationLoading,
  } = useStandItemMutations();

  // Modal state (restored from sessionStorage so camera/refresh doesn't lose work)
  const [initialModalState] = useState(loadModalState);
  const [formItem, setFormItem] = useState<StandItem | null>(initialModalState.item);
  const [isFormOpen, setIsFormOpen] = useState(initialModalState.isOpen);

  useEffect(() => {
    if (isFormOpen) {
      sessionStorage.setItem(
        MODAL_STATE_KEY,
        JSON.stringify({ isOpen: true, item: formItem } satisfies PersistedModalState)
      );
    } else {
      sessionStorage.removeItem(MODAL_STATE_KEY);
    }
  }, [isFormOpen, formItem]);

  useEffect(() => () => sessionStorage.removeItem(MODAL_STATE_KEY), []);

  const [deleteTarget, setDeleteTarget] = useState<StandItem | null>(null);
  const [restockTarget, setRestockTarget] = useState<StandItem | null>(null);
  const [adjustTarget, setAdjustTarget] = useState<StandItem | null>(null);
  const [movementsTarget, setMovementsTarget] = useState<StandItem | null>(null);
  const [isCategoryManagerOpen, setIsCategoryManagerOpen] = useState(false);

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

  const closeForm = () => {
    setIsFormOpen(false);
    setFormItem(null);
  };

  const handleCreateItem = async (data: CreateItemBody) => {
    try {
      await createItem(data);
      toast.success('Item created successfully');
      closeForm();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to create item'));
    }
  };

  const handleUpdateItem = async (changes: UpdateItemBody) => {
    if (!formItem) return;
    if (Object.keys(changes).length === 0) {
      closeForm();
      return;
    }
    try {
      await updateItem(formItem.item_id, changes);
      toast.success('Item updated successfully');
      closeForm();
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to update item'));
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    try {
      await deleteItem(deleteTarget.item_id);
      toast.success('Item deactivated successfully');
      setDeleteTarget(null);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to deactivate item'));
    }
  };

  const handleReactivate = async (item: StandItem) => {
    const ok = await confirm(`Bring "${item.item_name}" back into the active inventory and the till?`, {
      title: 'Reactivate Item',
      confirmText: 'Reactivate',
    });
    if (!ok) return;
    try {
      await reactivateItem(item.item_id);
      toast.success(`"${item.item_name}" is active again`);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to reactivate item'));
    }
  };

  const handleConfirmRestock = async (quantity: number, unitCost: number) => {
    if (!restockTarget) return;
    try {
      const { costPrice } = await restockItem(restockTarget.item_id, quantity, unitCost);
      toast.success(`Restocked — cost is now ${formatNumber(costPrice)} IQD (average)`);
      setRestockTarget(null);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to restock item'));
    }
  };

  const handleConfirmAdjust = async (delta: number, reason: string) => {
    if (!adjustTarget) return;
    try {
      await adjustStock(adjustTarget.item_id, delta, reason);
      toast.success('Stock adjusted successfully');
      setAdjustTarget(null);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to adjust stock'));
    }
  };

  return (
    <div className={styles.inventoryContainer}>
      <div className={styles.pageHeader}>
        <h1>Stand Inventory</h1>
        <div className={styles.headerActions}>
          {canAdmin && (
            <button className="btn btn-secondary" onClick={() => setIsCategoryManagerOpen(true)}>
              Manage Categories
            </button>
          )}
          <button className="btn btn-primary" onClick={handleAddItem} disabled={mutationLoading}>
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

      {!error && (
        <ItemTable
          items={items}
          asOf={asOf}
          loading={loading}
          canAdmin={canAdmin}
          onEdit={handleEditItem}
          onDelete={(item) => setDeleteTarget(item)}
          onReactivate={(item) => void handleReactivate(item)}
          onRestock={(item) => setRestockTarget(item)}
          onAdjust={(item) => setAdjustTarget(item)}
          onMovements={(item) => setMovementsTarget(item)}
        />
      )}

      <ItemFormModal
        isOpen={isFormOpen}
        item={formItem}
        onClose={closeForm}
        onCreate={handleCreateItem}
        onUpdate={handleUpdateItem}
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

      {canAdmin && (
        <CategoryManagerModal
          isOpen={isCategoryManagerOpen}
          onClose={() => setIsCategoryManagerOpen(false)}
        />
      )}
    </div>
  );
}
