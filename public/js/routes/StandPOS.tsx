import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { lookupStandItemByBarcode, useStandSaleMutations } from '../hooks/useStand';
import type { StandItem } from '../hooks/useStand';
import BarcodeInput from '../components/stand/BarcodeInput';
import POSItemSearch from '../components/stand/POSItemSearch';
import POSCart from '../components/stand/POSCart';
import POSCheckout, { type CheckoutDetails } from '../components/stand/POSCheckout';
import Modal from '../components/react/Modal';
import { useToast } from '../contexts/ToastContext';
import { useConfirm } from '../contexts/ConfirmContext';
import { httpErrorMessage, type HttpError } from '@/core/http';
import { formatNumber, formatLocaleDate } from '../utils/formatters';
import { isExpired, localToday } from '../utils/expiryDate';
import { addItem, cartTotal, removeItem, repriceCart, setQuantity, type CartChange, type CartItem } from '../utils/standCart';
import { useScannerCapture } from '../hooks/useScannerCapture';
import styles from './StandPOS.module.css';

/** The body of a 409 PRICE_CHANGED refusal (StandService.validateAndCreateSale). */
interface PriceChangedBody {
  details?: { code?: string; totalAmount?: number; prices?: Array<{ itemId: number; unitPrice: number }> };
}

export default function StandPOS() {
  const toast = useToast();
  const confirm = useConfirm();
  const navigate = useNavigate();
  const { createSale, loading: saleLoading } = useStandSaleMutations();

  // The cart lives in state for rendering and in a ref for the event handlers, so
  // two scans landing before a re-render both count, and the notices are shown
  // after the change is decided instead of from inside a state updater (FE-F19-14c).
  const [cart, setCart] = useState<CartItem[]>([]);
  const cartRef = useRef<CartItem[]>([]);
  const [lastSale, setLastSale] = useState<{ change: number; saleId: number } | null>(null);
  // Bumped after every sale: the checkout panel is keyed on it, so the next
  // customer starts with no patient, note or payment method left over (FE-F19-4).
  const [saleSeq, setSaleSeq] = useState(0);
  // A double click on Confirm used to record two sales: `disabled` waits for the
  // mutation's pending flag to reach React, which lands after the second click (FE-F19-5).
  const submittingRef = useRef(false);
  const barcodeRef = useRef<HTMLInputElement>(null);

  const total = cartTotal(cart);

  const apply = ({ cart: next, notice }: CartChange) => {
    if (notice) toast[notice.level](notice.message);
    if (next !== cartRef.current) {
      cartRef.current = next;
      setCart(next);
    }
  };

  const focusScanner = () => barcodeRef.current?.focus();

  const addToCart = async (item: StandItem) => {
    // An expired item is sold only on the cashier's say-so (owner decision 2026-10-04,
    // FE-F19-2); the till used to add it without a word.
    const expired = isExpired(item.expiry_date, localToday());
    if (expired && !cartRef.current.some((ci) => ci.item.item_id === item.item_id)) {
      const ok = await confirm(
        `"${item.item_name}" expired on ${formatLocaleDate(item.expiry_date)}. Sell it anyway?`,
        { title: 'Expired item', danger: true, confirmText: 'Sell anyway', cancelText: 'Leave it out' }
      );
      if (!ok) {
        focusScanner();
        return;
      }
    }
    apply(addItem(cartRef.current, item, expired));
    focusScanner();
  };

  const handleBarcodeScan = async (barcode: string) => {
    try {
      const item = await lookupStandItemByBarcode(barcode);
      if (item) await addToCart(item);
      else toast.error(`No item found for barcode: ${barcode}`);
    } catch (err) {
      toast.error(httpErrorMessage(err, 'Barcode lookup failed'));
    }
  };

  // A scan typed while the focus is somewhere else on the till (FE-F19-6).
  useScannerCapture((code) => void handleBarcodeScan(code), barcodeRef);

  const handleConfirmSale = async (details: CheckoutDetails) => {
    if (submittingRef.current) return;
    submittingRef.current = true;
    const lines = cartRef.current;
    try {
      const result = await createSale({
        items: lines.map((ci) => ({ itemId: ci.item.item_id, quantity: ci.quantity })),
        amountPaid: details.amountPaid,
        expectedTotal: cartTotal(lines),
        paymentMethod: details.paymentMethod,
        customerNote: details.customerNote,
        personId: details.personId,
      });
      setLastSale({ change: result.change, saleId: result.saleId });
      apply({ cart: [] });
      setSaleSeq((n) => n + 1);
      toast.success('Sale completed!');
    } catch (err) {
      const body = (err as HttpError).data as PriceChangedBody | undefined;
      if (body?.details?.code === 'PRICE_CHANGED' && body.details.prices) {
        // A price was edited after the item went into the cart: show the new total
        // and let the cashier take the right amount (FE-F19-14a).
        apply({ cart: repriceCart(cartRef.current, body.details.prices) });
        toast.warning(
          `Prices changed since these items were added. The total is now ${formatNumber(body.details.totalAmount ?? 0)} IQD — check the amount and confirm again.`
        );
      } else {
        toast.error(httpErrorMessage(err, 'Failed to complete sale'));
      }
    } finally {
      submittingRef.current = false;
    }
  };

  // The success dialog hands focus back to the Confirm button, which is disabled by
  // then, so focus fell to <body> and the next scan was lost. Put it in the scan box.
  useEffect(() => {
    if (!lastSale) barcodeRef.current?.focus();
  }, [lastSale]);

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
              <POSItemSearch onSelect={(item) => void addToCart(item)} />
              <BarcodeInput
                inputRef={barcodeRef}
                onScan={(code) => void handleBarcodeScan(code)}
                placeholder="Scan barcode or type..."
              />
            </div>
          </div>

          <POSCart
            items={cart}
            onUpdateQuantity={(itemId, quantity) => apply(setQuantity(cartRef.current, itemId, quantity))}
            onRemove={(itemId) => apply({ cart: removeItem(cartRef.current, itemId) })}
            total={total}
          />
        </div>

        <div className={styles.posRight}>
          <POSCheckout
            key={saleSeq}
            total={total}
            onConfirm={(details) => void handleConfirmSale(details)}
            disabled={saleLoading || cart.length === 0}
            busy={saleLoading}
          />
        </div>
      </div>

      {lastSale && (
        <Modal
          isOpen
          onClose={() => setLastSale(null)}
          overlayClassName={styles.successOverlay}
          contentClassName={styles.successCard}
          ariaLabelledBy="sale-complete-modal-title"
        >
          <div className={styles.successIcon}>
            <i className="fas fa-check-circle" aria-hidden="true"></i>
          </div>
          <h2 id="sale-complete-modal-title">Sale Complete!</h2>
          <p>Sale #{lastSale.saleId}</p>
          {lastSale.change > 0 && <div className={styles.changeAmount}>Change: {formatNumber(lastSale.change)} IQD</div>}
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
