/**
 * Stand / Mini-Pharmacy Routes
 *
 * Endpoints for inventory management, POS sales, stock operations,
 * and stand-specific reports. Fully isolated from existing financial modules.
 */

import { Router, type Request, type Response } from 'express';
import {
  getStandCategories,
  addStandCategory,
  updateStandCategory,
  deactivateStandCategory,
  getStandItems,
  getStandItemById,
  getStandItemByBarcode,
  addStandItem,
  updateStandItem,
  softDeleteStandItem,
  getLowStockItems,
  getExpiringItems,
  getStandSales,
  getStandSaleById,
  getStockMovements,
  getStandDashboardKPIs,
  getStandSalesSummary,
  getTopSellingItems,
  getStandPurchasesSummary,
} from '../../services/database/queries/stand-queries.js';
import {
  validateAndCreateSale,
  validateAndRestockItem,
  validateAndAdjustStock,
  validateAndVoidSale,
  StandValidationError,
} from '../../services/business/StandService.js';
import { GoogleGenAI, Type } from '@google/genai';
import { authenticate, authorize } from '../../middleware/auth.js';
import { ErrorResponses } from '../../utils/error-response.js';
import { log } from '../../utils/logger.js';

const router = Router();

// ============================================================================
// HELPER: Catch StandValidationError and convert to 400
// ============================================================================

function handleStandError(res: Response, error: unknown, fallbackMessage: string): void {
  if (error instanceof StandValidationError) {
    res.status(400).json({
      success: false,
      error: error.message,
      code: error.code,
      details: error.details,
      timestamp: new Date().toISOString(),
    });
    return;
  }
  log.error(fallbackMessage, error);
  ErrorResponses.internalError(res, fallbackMessage, error as Error);
}

// ============================================================================
// DASHBOARD
// ============================================================================

router.get('/stand/dashboard', async (_req: Request, res: Response): Promise<void> => {
  try {
    const kpis = await getStandDashboardKPIs();
    res.json(kpis);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch stand dashboard KPIs');
  }
});

// ============================================================================
// CATEGORIES
// ============================================================================

router.get('/stand/categories', async (_req: Request, res: Response): Promise<void> => {
  try {
    const categories = await getStandCategories();
    res.json(categories);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch stand categories');
  }
});

router.post(
  '/stand/categories',
  authenticate,
  authorize(['admin']),
  async (req: Request<unknown, unknown, { name: string }>, res: Response): Promise<void> => {
    try {
      const { name } = req.body;
      if (!name || !name.trim()) {
        ErrorResponses.badRequest(res, 'Category name is required');
        return;
      }
      const result = await addStandCategory(name.trim());
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      handleStandError(res, error, 'Failed to create stand category');
    }
  }
);

router.put(
  '/stand/categories/:id',
  authenticate,
  authorize(['admin']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid category ID'); return; }
      await updateStandCategory(id, req.body);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to update stand category');
    }
  }
);

router.delete(
  '/stand/categories/:id',
  authenticate,
  authorize(['admin']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid category ID'); return; }
      await deactivateStandCategory(id);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to delete stand category');
    }
  }
);

// ============================================================================
// ITEMS — specific routes BEFORE parameterized :id
// ============================================================================

router.get('/stand/items/low-stock', async (_req: Request, res: Response): Promise<void> => {
  try {
    const items = await getLowStockItems();
    res.json(items);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch low stock items');
  }
});

router.get('/stand/items/expiring', async (req: Request, res: Response): Promise<void> => {
  try {
    const days = parseInt(req.query.days as string) || 30;
    const items = await getExpiringItems(days);
    res.json(items);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch expiring items');
  }
});

router.post(
  '/stand/items/scan-vision',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req: Request<unknown, unknown, { images: string[] }>, res: Response): Promise<void> => {
    try {
      const { images } = req.body;

      if (!images || !Array.isArray(images) || images.length === 0) {
        ErrorResponses.badRequest(res, 'At least one image is required');
        return;
      }
      if (images.length > 3) {
        ErrorResponses.badRequest(res, 'Maximum 3 images allowed');
        return;
      }
      for (const img of images) {
        if (typeof img !== 'string' || img.length === 0) {
          ErrorResponses.badRequest(res, 'Each image must be a non-empty base64 string');
          return;
        }
        if (img.length > 7_000_000) {
          ErrorResponses.badRequest(res, 'Each image must be under 5MB');
          return;
        }
      }

      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) {
        log.error('GEMINI_API_KEY is not configured');
        ErrorResponses.internalError(res, 'Vision scanning is not configured');
        return;
      }

      const ai = new GoogleGenAI({ apiKey });

      const imageParts = images.map((base64Str) => {
        const match = base64Str.match(/^data:(image\/\w+);base64,(.+)$/);
        const mimeType = match ? match[1] : 'image/jpeg';
        const data = match ? match[2] : base64Str;
        return { inlineData: { mimeType, data } };
      });

      const prompt = `Analyze these product images, which show different angles of the EXACT SAME product packaging.
Extract the product details and return them matching the exact JSON schema.
Look across all images to find missing data like expiry dates or barcodes.
For the barcode, read the numbers printed under any barcode or near a QR code.
For ItemName, combine the brand name and product name as shown on packaging.`;

      const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
          {
            role: 'user',
            parts: [{ text: prompt }, ...imageParts],
          },
        ],
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              ItemName: { type: Type.STRING, description: 'Product name as shown on packaging' },
              Barcode: { type: Type.STRING, description: 'Barcode number if visible, otherwise null', nullable: true },
              ExpiryDate: { type: Type.STRING, description: 'Expiry date in YYYY-MM-DD format if visible, otherwise null', nullable: true },
              CategorySuggestion: { type: Type.STRING, description: 'Product category (e.g. Mouthwash, Toothbrush, Floss, Dental Care, Skin Care, Medicine)' },
              Unit: { type: Type.STRING, description: 'Unit type: one of piece, box, tube, bottle, pack' },
              Notes: { type: Type.STRING, description: 'Brief 1-sentence summary of active ingredients or features' },
            },
            required: ['ItemName', 'CategorySuggestion', 'Unit', 'Notes'],
          },
        },
      });

      const parsed = JSON.parse(result.text ?? '{}');

      log.info('Vision scan completed', { itemName: parsed.ItemName });
      res.json({ success: true, data: parsed });
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('429') || errMsg.includes('quota')) {
        log.warn('Gemini API rate limit hit', { error: errMsg });
        res.status(429).json({
          success: false,
          error: 'AI service is temporarily busy. Please try again in a moment.',
        });
        return;
      }
      handleStandError(res, error, 'Failed to scan product with AI vision');
    }
  }
);

router.get('/stand/items/barcode/:barcode', async (req: Request<{ barcode: string }>, res: Response): Promise<void> => {
  try {
    const item = await getStandItemByBarcode(req.params.barcode);
    if (!item) { ErrorResponses.notFound(res, 'Item'); return; }
    res.json(item);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch item by barcode');
  }
});

router.get(
  '/stand/items',
  async (
    req: Request<unknown, unknown, unknown, { search?: string; categoryId?: string; stockStatus?: string; includeInactive?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const items = await getStandItems({
        search: req.query.search,
        categoryId: req.query.categoryId ? parseInt(req.query.categoryId) : undefined,
        stockStatus: req.query.stockStatus as 'in-stock' | 'low-stock' | 'out-of-stock' | undefined,
        includeInactive: req.query.includeInactive === 'true',
      });
      res.json(items);
    } catch (error) {
      handleStandError(res, error, 'Failed to fetch stand items');
    }
  }
);

router.get('/stand/items/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid item ID'); return; }
    const item = await getStandItemById(id);
    if (!item) { ErrorResponses.notFound(res, 'Item'); return; }
    res.json(item);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch stand item');
  }
});

router.post(
  '/stand/items',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const { itemName, costPrice, sellPrice } = req.body;
      if (!itemName || costPrice === undefined || sellPrice === undefined) {
        ErrorResponses.badRequest(res, 'Missing required fields: itemName, costPrice, sellPrice');
        return;
      }
      const userId = req.session?.userId ?? null;
      const result = await addStandItem({ ...req.body, createdBy: userId });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      handleStandError(res, error, 'Failed to create stand item');
    }
  }
);

router.put(
  '/stand/items/:id',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid item ID'); return; }
      await updateStandItem(id, req.body);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to update stand item');
    }
  }
);

router.delete(
  '/stand/items/:id',
  authenticate,
  authorize(['admin']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid item ID'); return; }
      await softDeleteStandItem(id);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to delete stand item');
    }
  }
);

router.post(
  '/stand/items/:id/restock',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid item ID'); return; }
      const { quantity, unitCost } = req.body;
      if (!quantity || unitCost === undefined) {
        ErrorResponses.badRequest(res, 'Missing required fields: quantity, unitCost');
        return;
      }
      const userId = req.session?.userId ?? null;
      await validateAndRestockItem(id, parseInt(String(quantity)), parseInt(String(unitCost)), userId);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to restock item');
    }
  }
);

router.post(
  '/stand/items/:id/adjust',
  authenticate,
  authorize(['admin']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid item ID'); return; }
      const { delta, reason } = req.body;
      if (delta === undefined || !reason) {
        ErrorResponses.badRequest(res, 'Missing required fields: delta, reason');
        return;
      }
      const userId = req.session?.userId ?? null;
      await validateAndAdjustStock(id, parseInt(String(delta)), reason, userId);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to adjust stock');
    }
  }
);

router.get('/stand/items/:id/movements', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid item ID'); return; }
    const movements = await getStockMovements(id, {
      startDate: req.query.startDate as string | undefined,
      endDate: req.query.endDate as string | undefined,
      movementType: req.query.movementType as string | undefined,
    });
    res.json(movements);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch stock movements');
  }
});

// ============================================================================
// SALES
// ============================================================================

router.post(
  '/stand/sales',
  authenticate,
  authorize(['admin', 'secretary']),
  async (req: Request, res: Response): Promise<void> => {
    try {
      const cashierId = req.session?.userId ?? null;
      const result = await validateAndCreateSale({ ...req.body, cashierId });
      res.status(201).json({ success: true, data: result });
    } catch (error) {
      handleStandError(res, error, 'Failed to create sale');
    }
  }
);

router.get(
  '/stand/sales',
  async (
    req: Request<unknown, unknown, unknown, { startDate?: string; endDate?: string; cashierId?: string; personId?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const sales = await getStandSales({
        startDate: req.query.startDate,
        endDate: req.query.endDate,
        cashierId: req.query.cashierId ? parseInt(req.query.cashierId) : undefined,
        personId: req.query.personId ? parseInt(req.query.personId) : undefined,
      });
      res.json(sales);
    } catch (error) {
      handleStandError(res, error, 'Failed to fetch sales');
    }
  }
);

router.get('/stand/sales/:id', async (req: Request<{ id: string }>, res: Response): Promise<void> => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid sale ID'); return; }
    const sale = await getStandSaleById(id);
    if (!sale) { ErrorResponses.notFound(res, 'Sale'); return; }
    res.json(sale);
  } catch (error) {
    handleStandError(res, error, 'Failed to fetch sale');
  }
});

router.post(
  '/stand/sales/:id/void',
  authenticate,
  authorize(['admin']),
  async (req: Request<{ id: string }>, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) { ErrorResponses.badRequest(res, 'Invalid sale ID'); return; }
      const { reason } = req.body;
      if (!reason) {
        ErrorResponses.badRequest(res, 'Void reason is required');
        return;
      }
      const userId = req.session?.userId ?? null;
      await validateAndVoidSale(id, reason, userId);
      res.json({ success: true });
    } catch (error) {
      handleStandError(res, error, 'Failed to void sale');
    }
  }
);

// ============================================================================
// REPORTS
// ============================================================================

router.get(
  '/stand/reports/summary',
  async (
    req: Request<unknown, unknown, unknown, { startDate?: string; endDate?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        ErrorResponses.badRequest(res, 'Missing required parameters: startDate, endDate');
        return;
      }
      const [salesSummary, purchases] = await Promise.all([
        getStandSalesSummary(startDate, endDate),
        getStandPurchasesSummary(startDate, endDate),
      ]);
      res.json({ salesSummary, purchases });
    } catch (error) {
      handleStandError(res, error, 'Failed to fetch stand report summary');
    }
  }
);

router.get(
  '/stand/reports/top-items',
  async (
    req: Request<unknown, unknown, unknown, { startDate?: string; endDate?: string; limit?: string }>,
    res: Response
  ): Promise<void> => {
    try {
      const { startDate, endDate } = req.query;
      if (!startDate || !endDate) {
        ErrorResponses.badRequest(res, 'Missing required parameters: startDate, endDate');
        return;
      }
      const limit = parseInt(req.query.limit || '10');
      const topItems = await getTopSellingItems(startDate, endDate, limit);
      res.json(topItems);
    } catch (error) {
      handleStandError(res, error, 'Failed to fetch top selling items');
    }
  }
);

export default router;
