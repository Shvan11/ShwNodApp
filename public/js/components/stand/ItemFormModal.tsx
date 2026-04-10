/**
 * ItemFormModal Component
 * Modal for adding or editing a stand inventory item
 */
import { useState, useEffect } from 'react';
import type { ChangeEvent, FormEvent, MouseEvent } from 'react';
import type { StandItem } from '../../hooks/useStand';
import { useStandCategories } from '../../hooks/useStand';
import { useToast } from '../../contexts/ToastContext';
import { formatNumber } from '../../utils/formatters';
import styles from './ItemFormModal.module.css';

interface ItemFormModalProps {
  isOpen: boolean;
  item: StandItem | null;
  onClose: () => void;
  onSave: (data: Record<string, unknown>) => void;
}

interface FormData {
  itemName: string;
  sku: string;
  barcode: string;
  categoryId: string;
  costPrice: number;
  sellPrice: number;
  currentStock: number;
  reorderLevel: number;
  expiryDate: string;
  unit: string;
  notes: string;
}

interface FormErrors {
  itemName?: string | null;
  costPrice?: string | null;
  sellPrice?: string | null;
  currentStock?: string | null;
}

interface VisionScanResult {
  ItemName: string;
  Barcode: string | null;
  ExpiryDate: string | null;
  CategorySuggestion: string;
  Unit: string;
  Notes: string;
}

function compressImage(file: File, maxWidth = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const canvas = document.createElement('canvas');
      let { width, height } = img;
      if (width > maxWidth) {
        height = Math.round((height * maxWidth) / width);
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('Canvas context unavailable')); return; }
      ctx.drawImage(img, 0, 0, width, height);
      resolve(canvas.toDataURL('image/jpeg', 0.8));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Failed to load image')); };
    img.src = url;
  });
}

async function detectBarcode(files: File[]): Promise<string | null> {
  if (typeof BarcodeDetector === 'undefined') return null;
  try {
    const detector = new BarcodeDetector({
      formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'],
    });
    for (const file of files) {
      const bitmap = await createImageBitmap(file);
      const barcodes = await detector.detect(bitmap);
      bitmap.close();
      if (barcodes.length > 0) return barcodes[0].rawValue;
    }
  } catch {
    // BarcodeDetector not supported or detection failed — fall through
  }
  return null;
}

const UNIT_OPTIONS = ['piece', 'box', 'tube', 'bottle', 'pack'];

const DEFAULT_FORM: FormData = {
  itemName: '',
  sku: '',
  barcode: '',
  categoryId: '',
  costPrice: 0,
  sellPrice: 0,
  currentStock: 0,
  reorderLevel: 5,
  expiryDate: '',
  unit: '',
  notes: '',
};

export default function ItemFormModal({ isOpen, item, onClose, onSave }: ItemFormModalProps) {
  const { categories } = useStandCategories();
  const toast = useToast();
  const [formData, setFormData] = useState<FormData>({ ...DEFAULT_FORM });
  const [errors, setErrors] = useState<FormErrors>({});
  const [displayCost, setDisplayCost] = useState('');
  const [displaySell, setDisplaySell] = useState('');
  const [scanImages, setScanImages] = useState<File[]>([]);
  const [scanPreviews, setScanPreviews] = useState<string[]>([]);
  const [scanning, setScanning] = useState(false);

  const isEditMode = !!item;

  useEffect(() => {
    if (!isOpen) {
      scanPreviews.forEach((url) => URL.revokeObjectURL(url));
      setScanImages([]);
      setScanPreviews([]);
      setScanning(false);
      return;
    }

    if (item) {
      setFormData({
        itemName: item.ItemName,
        sku: item.SKU || '',
        barcode: item.Barcode || '',
        categoryId: item.CategoryID != null ? String(item.CategoryID) : '',
        costPrice: item.CostPrice,
        sellPrice: item.SellPrice,
        currentStock: item.CurrentStock,
        reorderLevel: item.ReorderLevel,
        expiryDate: item.ExpiryDate ? item.ExpiryDate.split('T')[0] : '',
        unit: item.Unit || '',
        notes: item.Notes || '',
      });
      setDisplayCost(item.CostPrice ? formatNumber(item.CostPrice) : '');
      setDisplaySell(item.SellPrice ? formatNumber(item.SellPrice) : '');
    } else {
      setFormData({ ...DEFAULT_FORM });
      setDisplayCost('');
      setDisplaySell('');
    }
    setErrors({});
  }, [isOpen, item]);

  const handleChange = (
    field: keyof FormData,
    value: string
  ) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const handleAmountChange = (
    field: 'costPrice' | 'sellPrice',
    rawValue: string,
    setDisplay: (v: string) => void
  ) => {
    const digits = rawValue.replace(/[^\d]/g, '');
    const num = parseInt(digits, 10) || 0;
    setDisplay(num ? num.toLocaleString('en-US') : '');
    setFormData((prev) => ({ ...prev, [field]: num }));
    if (errors[field]) {
      setErrors((prev) => ({ ...prev, [field]: null }));
    }
  };

  const matchCategory = (suggestion: string): string => {
    if (!suggestion || categories.length === 0) return '';
    const lower = suggestion.toLowerCase().trim();

    const exact = categories.find((c) => c.CategoryName.toLowerCase() === lower);
    if (exact) return String(exact.CategoryID);

    const partial = categories.find(
      (c) =>
        c.CategoryName.toLowerCase().includes(lower) ||
        lower.includes(c.CategoryName.toLowerCase())
    );
    if (partial) return String(partial.CategoryID);

    const suggestionWords = lower.split(/\s+/);
    let bestMatch: { id: number; score: number } | null = null;
    for (const cat of categories) {
      const catWords = cat.CategoryName.toLowerCase().split(/\s+/);
      const score = suggestionWords.filter((w) =>
        catWords.some((cw) => cw.includes(w) || w.includes(cw))
      ).length;
      if (score > 0 && (!bestMatch || score > bestMatch.score)) {
        bestMatch = { id: cat.CategoryID, score };
      }
    }
    if (bestMatch) return String(bestMatch.id);

    return '';
  };

  const handleImageSelect = (e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (files.length > 3) {
      toast.warning('Maximum 3 images allowed');
      return;
    }
    scanPreviews.forEach((url) => URL.revokeObjectURL(url));
    setScanImages(files);
    setScanPreviews(files.map((f) => URL.createObjectURL(f)));
  };

  const handleRemoveImage = (index: number) => {
    URL.revokeObjectURL(scanPreviews[index]);
    setScanImages((prev) => prev.filter((_, i) => i !== index));
    setScanPreviews((prev) => prev.filter((_, i) => i !== index));
  };

  const handleScanItem = async () => {
    if (scanImages.length === 0) {
      toast.warning('Please select at least one image');
      return;
    }

    try {
      setScanning(true);

      const base64Images = await Promise.all(
        scanImages.map((file) => compressImage(file, 1024))
      );

      // Run barcode detection (local, instant) in parallel with Gemini API call
      const [localBarcode, response] = await Promise.all([
        detectBarcode(scanImages),
        fetch('/api/stand/items/scan-vision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ images: base64Images }),
        }),
      ]);

      if (!response.ok) {
        const errData = await response.json().catch(() => null);
        throw new Error(
          (errData as { error?: string } | null)?.error || 'Failed to scan product'
        );
      }

      const result = (await response.json()) as { success: boolean; data: VisionScanResult };
      const scan = result.data;

      // Prefer local BarcodeDetector result over Gemini's AI-read barcode
      const barcode = localBarcode || scan.Barcode;

      setFormData((prev) => ({
        ...prev,
        itemName: scan.ItemName || prev.itemName,
        barcode: barcode || prev.barcode,
        expiryDate: scan.ExpiryDate || prev.expiryDate,
        unit: UNIT_OPTIONS.includes(scan.Unit?.toLowerCase()) ? scan.Unit.toLowerCase() : prev.unit,
        notes: scan.Notes || prev.notes,
        categoryId: matchCategory(scan.CategorySuggestion) || prev.categoryId,
      }));

      toast.success('Item details extracted successfully! Please verify the fields.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to scan product');
    } finally {
      setScanning(false);
    }
  };

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {};

    if (!formData.itemName.trim()) {
      newErrors.itemName = 'Item name is required';
    }
    if (formData.costPrice < 0) {
      newErrors.costPrice = 'Cost price must be 0 or greater';
    }
    if (formData.sellPrice < 0) {
      newErrors.sellPrice = 'Sell price must be 0 or greater';
    }
    if (!isEditMode && formData.currentStock < 0) {
      newErrors.currentStock = 'Initial stock cannot be negative';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!validateForm()) return;

    const data: Record<string, unknown> = {
      itemName: formData.itemName.trim(),
      sku: formData.sku.trim() || null,
      barcode: formData.barcode.trim() || null,
      categoryId: formData.categoryId ? Number(formData.categoryId) : null,
      costPrice: formData.costPrice,
      sellPrice: formData.sellPrice,
      reorderLevel: formData.reorderLevel,
      expiryDate: formData.expiryDate || null,
      unit: formData.unit || null,
      notes: formData.notes.trim() || null,
    };

    if (!isEditMode) {
      data.currentStock = formData.currentStock;
    }

    onSave(data);
  };

  const handleClose = () => {
    setFormData({ ...DEFAULT_FORM });
    setDisplayCost('');
    setDisplaySell('');
    setErrors({});
    scanPreviews.forEach((url) => URL.revokeObjectURL(url));
    setScanImages([]);
    setScanPreviews([]);
    setScanning(false);
    onClose();
  };

  const handleOverlayClick = (e: MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      handleClose();
    }
  };

  if (!isOpen) return null;

  const profit = formData.sellPrice - formData.costPrice;

  return (
    <div className="modal-overlay" onClick={handleOverlayClick}>
      <div className={styles.modalContent} onClick={(e) => e.stopPropagation()}>
        <div className={styles.modalHeader}>
          <h2>{isEditMode ? 'Edit Item' : 'Add New Item'}</h2>
          <button className={styles.closeBtn} onClick={handleClose} aria-label="Close modal">
            &times;
          </button>
        </div>

        <form onSubmit={handleSubmit}>
          <div className={styles.modalBody}>
            {/* Vision Scanner — Add mode only */}
            {!isEditMode && (
              <div className={styles.visionScanner}>
                <div className={styles.visionHeader}>
                  <span className={styles.visionIcon}>&#128247;</span>
                  <span>Auto-Fill with AI</span>
                </div>
                <p className={styles.visionHint}>
                  Take 1–3 photos of the product to auto-fill the form
                </p>
                <div className={styles.visionControls}>
                  <label className={styles.visionFileLabel}>
                    <input
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      onChange={handleImageSelect}
                      className={styles.visionFileInput}
                      disabled={scanning}
                    />
                    Choose Photos
                  </label>
                  <button
                    type="button"
                    className={styles.visionScanBtn}
                    onClick={handleScanItem}
                    disabled={scanning || scanImages.length === 0}
                  >
                    {scanning ? (
                      <>
                        <span className={styles.spinner} />
                        Scanning...
                      </>
                    ) : (
                      'Scan Item'
                    )}
                  </button>
                </div>
                {scanPreviews.length > 0 && (
                  <div className={styles.visionPreviews}>
                    {scanPreviews.map((src, idx) => (
                      <div key={idx} className={styles.visionThumb}>
                        <img src={src} alt={`Preview ${idx + 1}`} />
                        <button
                          type="button"
                          className={styles.visionThumbRemove}
                          onClick={() => handleRemoveImage(idx)}
                          disabled={scanning}
                          aria-label="Remove image"
                        >
                          &times;
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Name */}
            <div className={styles.formGroup}>
              <label htmlFor="item-name">
                Name <span className={styles.required}>*</span>
              </label>
              <input
                type="text"
                id="item-name"
                className={`${styles.formInput} ${errors.itemName ? styles.inputError : ''}`}
                value={formData.itemName}
                onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('itemName', e.target.value)}
                placeholder="Item name"
              />
              {errors.itemName && <span className={styles.errorMessage}>{errors.itemName}</span>}
            </div>

            {/* SKU + Barcode */}
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="item-sku">SKU</label>
                <input
                  type="text"
                  id="item-sku"
                  className={styles.formInput}
                  value={formData.sku}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('sku', e.target.value)}
                  placeholder="SKU code"
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="item-barcode">Barcode</label>
                <input
                  type="text"
                  id="item-barcode"
                  className={styles.formInput}
                  value={formData.barcode}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('barcode', e.target.value)}
                  placeholder="Barcode"
                />
              </div>
            </div>

            {/* Category */}
            <div className={styles.formGroup}>
              <label htmlFor="item-category">Category</label>
              <select
                id="item-category"
                className={styles.formInput}
                value={formData.categoryId}
                onChange={(e: ChangeEvent<HTMLSelectElement>) => handleChange('categoryId', e.target.value)}
              >
                <option value="">Select Category</option>
                {categories.map((cat) => (
                  <option key={cat.CategoryID} value={cat.CategoryID}>
                    {cat.CategoryName}
                  </option>
                ))}
              </select>
            </div>

            {/* Cost + Sell + Profit */}
            <div className={styles.formRowThree}>
              <div className={styles.formGroup}>
                <label htmlFor="item-cost">
                  Cost Price (IQD) <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  id="item-cost"
                  className={`${styles.formInput} ${errors.costPrice ? styles.inputError : ''}`}
                  value={displayCost}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handleAmountChange('costPrice', e.target.value, setDisplayCost)
                  }
                  onBlur={() => setDisplayCost(formData.costPrice ? formatNumber(formData.costPrice) : '')}
                  placeholder="0"
                />
                {errors.costPrice && <span className={styles.errorMessage}>{errors.costPrice}</span>}
              </div>

              <div className={styles.formGroup}>
                <label htmlFor="item-sell">
                  Sell Price (IQD) <span className={styles.required}>*</span>
                </label>
                <input
                  type="text"
                  id="item-sell"
                  className={`${styles.formInput} ${errors.sellPrice ? styles.inputError : ''}`}
                  value={displaySell}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    handleAmountChange('sellPrice', e.target.value, setDisplaySell)
                  }
                  onBlur={() => setDisplaySell(formData.sellPrice ? formatNumber(formData.sellPrice) : '')}
                  placeholder="0"
                />
                {errors.sellPrice && <span className={styles.errorMessage}>{errors.sellPrice}</span>}
              </div>

              <div className={styles.formGroup}>
                <label>Profit</label>
                <div className={styles.profitDisplay}>
                  <span className={styles.profitLabel}>IQD</span>
                  <span className={`${styles.profitValue} ${profit < 0 ? styles.profitNegative : ''}`}>
                    {formatNumber(profit)}
                  </span>
                </div>
              </div>
            </div>

            {/* Initial Stock (add mode only) + Reorder Level */}
            <div className={styles.formRow}>
              {!isEditMode && (
                <div className={styles.formGroup}>
                  <label htmlFor="item-stock">Initial Stock</label>
                  <input
                    type="number"
                    id="item-stock"
                    className={`${styles.formInput} ${errors.currentStock ? styles.inputError : ''}`}
                    value={formData.currentStock}
                    onChange={(e: ChangeEvent<HTMLInputElement>) =>
                      setFormData((prev) => ({ ...prev, currentStock: parseInt(e.target.value, 10) || 0 }))
                    }
                    min="0"
                  />
                  {errors.currentStock && <span className={styles.errorMessage}>{errors.currentStock}</span>}
                </div>
              )}
              <div className={styles.formGroup}>
                <label htmlFor="item-reorder">Reorder Level</label>
                <input
                  type="number"
                  id="item-reorder"
                  className={styles.formInput}
                  value={formData.reorderLevel}
                  onChange={(e: ChangeEvent<HTMLInputElement>) =>
                    setFormData((prev) => ({ ...prev, reorderLevel: parseInt(e.target.value, 10) || 0 }))
                  }
                  min="0"
                />
              </div>
            </div>

            {/* Expiry + Unit */}
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="item-expiry">Expiry Date</label>
                <input
                  type="date"
                  id="item-expiry"
                  className={styles.formInput}
                  value={formData.expiryDate}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => handleChange('expiryDate', e.target.value)}
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="item-unit">Unit</label>
                <select
                  id="item-unit"
                  className={styles.formInput}
                  value={formData.unit}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => handleChange('unit', e.target.value)}
                >
                  <option value="">Select Unit</option>
                  {UNIT_OPTIONS.map((u) => (
                    <option key={u} value={u}>
                      {u.charAt(0).toUpperCase() + u.slice(1)}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Notes */}
            <div className={styles.formGroup}>
              <label htmlFor="item-notes">Notes</label>
              <textarea
                id="item-notes"
                rows={3}
                className={styles.formInput}
                value={formData.notes}
                onChange={(e: ChangeEvent<HTMLTextAreaElement>) => handleChange('notes', e.target.value)}
                placeholder="Additional notes..."
              />
            </div>
          </div>

          <div className={styles.modalFooter}>
            <button type="button" className="btn btn-secondary" onClick={handleClose}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary">
              {isEditMode ? 'Update Item' : 'Add Item'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
