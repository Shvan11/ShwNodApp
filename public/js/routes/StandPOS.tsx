import { useState, useCallback } from 'react';
import { useStandItemByBarcode, useStandSaleMutations } from '../hooks/useStand';
import type { StandItem } from '../hooks/useStand';
import BarcodeInput from '../components/stand/BarcodeInput';
import POSItemSearch from '../components/stand/POSItemSearch';
import POSCart from '../components/stand/POSCart';
import POSCheckout from '../components/stand/POSCheckout';
import { useToast } from '../contexts/ToastContext';
import { formatNumber } from '../utils/formatters';
import styles from './StandPOS.module.css';

interface CartItem {
  item: StandItem;
  quantity: number;
}

export default function StandPOS() {
  const toast = useToast();
  const { lookupByBarcode } = useStandItemByBarcode();
  const { createSale, loading: saleLoading } = useStandSaleMutations();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastSale, setLastSale] = useState<{ change: number; saleId: number } | null>(null);

  const total = cart.reduce((sum, ci) => sum + ci.item.SellPrice * ci.quantity, 0);

  const addToCart = useCallback((item: StandItem) => {
    setCart(prev => {
      const existing = prev.find(ci => ci.item.ItemID === item.ItemID);
      if (existing) {
        if (existing.quantity >= item.CurrentStock) {
          toast.warning(`Max stock available: ${item.CurrentStock}`);
          return prev;
        }
        return prev.map(ci =>
          ci.item.ItemID === item.ItemID
            ? { ...ci, quantity: ci.quantity + 1 }
            : ci
        );
      }
      if (item.CurrentStock <= 0) {
        toast.error(`"${item.ItemName}" is out of stock`);
        return prev;
      }
      return [...prev, { item, quantity: 1 }];
    });
  }, [toast]);

  const handleBarcodeScan = async (barcode: string) => {
    const item = await lookupByBarcode(barcode);
    if (item) {
      addToCart(item);
    } else {
      toast.error(`No item found for barcode: ${barcode}`);
    }
  };

  const handleUpdateQuantity = (itemId: number, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(ci => ci.item.ItemID !== itemId));
      return;
    }
    setCart(prev =>
      prev.map(ci => {
        if (ci.item.ItemID !== itemId) return ci;
        if (quantity > ci.item.CurrentStock) {
          toast.warning(`Max stock: ${ci.item.CurrentStock}`);
          return { ...ci, quantity: ci.item.CurrentStock };
        }
        return { ...ci, quantity };
      })
    );
  };

  const handleRemove = (itemId: number) => {
    setCart(prev => prev.filter(ci => ci.item.ItemID !== itemId));
  };

  const handleConfirmSale = async (
    amountPaid: number,
    paymentMethod: string,
    personId: number | null,
    customerNote: string | null
  ) => {
    try {
      const result = await createSale({
        items: cart.map(ci => ({ itemId: ci.item.ItemID, quantity: ci.quantity })),
        amountPaid,
        paymentMethod,
        customerNote,
        personId,
      }) as { saleId: number; change: number };

      setLastSale({ change: result.change, saleId: result.saleId });
      setCart([]);
      toast.success('Sale completed!');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete sale');
    }
  };

  return (
    <div className={styles.posContainer}>
      <div className={styles.pageHeader}>
        <h1>Point of Sale</h1>
      </div>

      <div className={styles.posLayout}>
        <div className={styles.posLeft}>
          <div className={styles.scanSection}>
            <h2>Add Items</h2>
            <div className={styles.scanInputs}>
              <BarcodeInput onScan={handleBarcodeScan} placeholder="Scan barcode or type..." />
              <POSItemSearch onSelect={addToCart} />
            </div>
          </div>

          <POSCart
            items={cart}
            onUpdateQuantity={handleUpdateQuantity}
            onRemove={handleRemove}
            total={total}
          />
        </div>

        <div className={styles.posRight}>
          <POSCheckout
            total={total}
            onConfirm={handleConfirmSale}
            disabled={saleLoading || cart.length === 0}
          />
        </div>
      </div>

      {lastSale && (
        <div className={styles.successOverlay} onClick={() => setLastSale(null)}>
          <div className={styles.successCard} onClick={e => e.stopPropagation()}>
            <div className={styles.successIcon}><i className="fas fa-check-circle"></i></div>
            <h2>Sale Complete!</h2>
            <p>Sale #{lastSale.saleId}</p>
            {lastSale.change > 0 && (
              <div className={styles.changeAmount}>
                Change: {formatNumber(lastSale.change)} IQD
              </div>
            )}
            <button className="btn btn-primary" onClick={() => setLastSale(null)}>
              New Sale
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
