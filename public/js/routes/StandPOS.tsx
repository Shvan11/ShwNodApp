import { useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStandItemByBarcode, useStandSaleMutations } from '../hooks/useStand';
import type { StandItem } from '../hooks/useStand';
import BarcodeInput from '../components/stand/BarcodeInput';
import POSItemSearch from '../components/stand/POSItemSearch';
import POSCart from '../components/stand/POSCart';
import POSCheckout from '../components/stand/POSCheckout';
import Modal from '../components/react/Modal';
import { useToast } from '../contexts/ToastContext';
import { httpErrorMessage } from '@/core/http';
import { formatNumber } from '../utils/formatters';
import styles from './StandPOS.module.css';

interface CartItem {
  item: StandItem;
  quantity: number;
}

export default function StandPOS() {
  const toast = useToast();
  const navigate = useNavigate();
  const { lookupByBarcode } = useStandItemByBarcode();
  const { createSale, loading: saleLoading } = useStandSaleMutations();

  const [cart, setCart] = useState<CartItem[]>([]);
  const [lastSale, setLastSale] = useState<{ change: number; saleId: number } | null>(null);

  const total = cart.reduce((sum, ci) => sum + ci.item.sell_price * ci.quantity, 0);

  const addToCart = useCallback((item: StandItem) => {
    setCart(prev => {
      const existing = prev.find(ci => ci.item.item_id === item.item_id);
      if (existing) {
        if (existing.quantity >= item.current_stock) {
          toast.warning(`Max stock available: ${item.current_stock}`);
          return prev;
        }
        return prev.map(ci =>
          ci.item.item_id === item.item_id
            ? { ...ci, quantity: ci.quantity + 1 }
            : ci
        );
      }
      if (item.current_stock <= 0) {
        toast.error(`"${item.item_name}" is out of stock`);
        return prev;
      }
      return [...prev, { item, quantity: 1 }];
    });
  }, [toast]);

  const handleBarcodeScan = async (barcode: string) => {
    try {
      const item = await lookupByBarcode(barcode);
      if (item) {
        addToCart(item);
      } else {
        toast.error(`No item found for barcode: ${barcode}`);
      }
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Barcode lookup failed'));
    }
  };

  const handleUpdateQuantity = (itemId: number, quantity: number) => {
    if (quantity <= 0) {
      setCart(prev => prev.filter(ci => ci.item.item_id !== itemId));
      return;
    }
    setCart(prev =>
      prev.map(ci => {
        if (ci.item.item_id !== itemId) return ci;
        if (quantity > ci.item.current_stock) {
          toast.warning(`Max stock: ${ci.item.current_stock}`);
          return { ...ci, quantity: ci.item.current_stock };
        }
        return { ...ci, quantity };
      })
    );
  };

  const handleRemove = (itemId: number) => {
    setCart(prev => prev.filter(ci => ci.item.item_id !== itemId));
  };

  const handleConfirmSale = async (
    amountPaid: number,
    paymentMethod: string,
    personId: number | null,
    customerNote: string | null
  ) => {
    try {
      const result = await createSale({
        items: cart.map(ci => ({ itemId: ci.item.item_id, quantity: ci.quantity })),
        amountPaid,
        paymentMethod,
        customerNote,
        personId,
      });

      setLastSale({ change: result.change, saleId: result.saleId });
      setCart([]);
      toast.success('Sale completed!');
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Failed to complete sale'));
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
              <POSItemSearch onSelect={addToCart} />
              <BarcodeInput onScan={handleBarcodeScan} placeholder="Scan barcode or type..." />
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
        <Modal
          isOpen
          onClose={() => setLastSale(null)}
          overlayClassName={styles.successOverlay}
          contentClassName={styles.successCard}
        >
            <div className={styles.successIcon}><i className="fas fa-check-circle"></i></div>
            <h2>Sale Complete!</h2>
            <p>Sale #{lastSale.saleId}</p>
            {lastSale.change > 0 && (
              <div className={styles.changeAmount}>
                Change: {formatNumber(lastSale.change)} IQD
              </div>
            )}
            <div className={styles.successActions}>
              <button className="btn btn-secondary" onClick={() => navigate('/stand')}>
                Back to Stand
              </button>
              <button className="btn btn-primary" onClick={() => setLastSale(null)}>
                New Sale
              </button>
            </div>
        </Modal>
      )}
    </div>
  );
}
