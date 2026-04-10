import { useNavigate } from 'react-router-dom';
import { useStandDashboardKPIs, useLowStockItems, useExpiringItems } from '../hooks/useStand';
import type { StandItem } from '../hooks/useStand';
import StandKPICards from '../components/stand/StandKPICards';
import LowStockPanel from '../components/stand/LowStockPanel';
import ExpiringItemsPanel from '../components/stand/ExpiringItemsPanel';
import RestockModal from '../components/stand/RestockModal';
import { useStandItemMutations } from '../hooks/useStand';
import { useToast } from '../contexts/ToastContext';
import { useState } from 'react';
import styles from './Stand.module.css';

export default function Stand() {
  const navigate = useNavigate();
  const toast = useToast();

  const { kpis, loading: kpisLoading, refetch: refetchKPIs } = useStandDashboardKPIs();
  const { items: lowStockItems, loading: lowStockLoading, refetch: refetchLowStock } = useLowStockItems();
  const { items: expiringItems, loading: expiringLoading } = useExpiringItems(30);

  const [restockItem, setRestockItem] = useState<StandItem | null>(null);

  const { restockItem: doRestock } = useStandItemMutations(() => {
    refetchKPIs();
    refetchLowStock();
  });

  const handleRestock = async (quantity: number, unitCost: number) => {
    if (!restockItem) return;
    try {
      await doRestock(restockItem.ItemID, quantity, unitCost);
      toast.success('Item restocked successfully');
      setRestockItem(null);
    } catch {
      toast.error('Failed to restock item');
    }
  };

  return (
    <div className={styles.standContainer}>
      <div className={styles.pageHeader}>
        <h1>Stand / Mini Pharmacy</h1>
        <div className={styles.quickActions}>
          <button className="btn btn-primary" onClick={() => navigate('/stand/pos')}>
            <i className="fas fa-cash-register"></i> New Sale
          </button>
          <button className="btn btn-secondary" onClick={() => navigate('/stand/inventory')}>
            <i className="fas fa-boxes"></i> Inventory
          </button>
        </div>
      </div>

      <div className={styles.kpiSection}>
        <StandKPICards kpis={kpis} loading={kpisLoading} />
      </div>

      <div className={styles.panelsGrid}>
        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Low Stock Items</h2>
          </div>
          <LowStockPanel
            items={lowStockItems}
            loading={lowStockLoading}
            onRestock={(item) => setRestockItem(item)}
          />
        </div>

        <div className={styles.panel}>
          <div className={styles.panelHeader}>
            <h2>Expiring Soon</h2>
          </div>
          <ExpiringItemsPanel items={expiringItems} loading={expiringLoading} />
        </div>
      </div>

      <div className={styles.navCards}>
        <button className={styles.navCard} onClick={() => navigate('/stand/inventory')}>
          <div className={styles.navCardIcon}><i className="fas fa-boxes"></i></div>
          <div className={styles.navCardText}>
            <h3>Inventory</h3>
            <p>Manage items, stock, categories</p>
          </div>
        </button>
        <button className={styles.navCard} onClick={() => navigate('/stand/pos')}>
          <div className={styles.navCardIcon}><i className="fas fa-cash-register"></i></div>
          <div className={styles.navCardText}>
            <h3>Point of Sale</h3>
            <p>Barcode scanning, multi-item checkout</p>
          </div>
        </button>
        <button className={styles.navCard} onClick={() => navigate('/stand/sales')}>
          <div className={styles.navCardIcon}><i className="fas fa-receipt"></i></div>
          <div className={styles.navCardText}>
            <h3>Sales History</h3>
            <p>View and void past sales</p>
          </div>
        </button>
        <button className={styles.navCard} onClick={() => navigate('/stand/reports')}>
          <div className={styles.navCardIcon}><i className="fas fa-chart-line"></i></div>
          <div className={styles.navCardText}>
            <h3>Reports</h3>
            <p>Revenue, profit, top items</p>
          </div>
        </button>
      </div>

      <RestockModal
        isOpen={!!restockItem}
        item={restockItem}
        onClose={() => setRestockItem(null)}
        onSave={handleRestock}
      />
    </div>
  );
}
