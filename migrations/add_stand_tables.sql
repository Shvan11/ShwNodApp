-- ============================================================
-- Stand / Mini-Pharmacy Inventory System
-- Migration: Create stand tables for inventory, sales, and stock tracking
-- ============================================================

-- 1. Categories
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblStandCategories')
BEGIN
  CREATE TABLE dbo.tblStandCategories (
    CategoryID   INT IDENTITY(1,1) PRIMARY KEY,
    CategoryName NVARCHAR(100) NOT NULL UNIQUE,
    IsActive     BIT NOT NULL DEFAULT 1
  );
END;

-- 2. Items
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblStandItems')
BEGIN
  CREATE TABLE dbo.tblStandItems (
    ItemID       INT IDENTITY(1,1) PRIMARY KEY,
    ItemName     NVARCHAR(255) NOT NULL,
    SKU          NVARCHAR(50)  NULL UNIQUE,
    Barcode      NVARCHAR(100) NULL UNIQUE,
    CategoryID   INT           NULL REFERENCES dbo.tblStandCategories(CategoryID),
    CostPrice    INT           NOT NULL,
    SellPrice    INT           NOT NULL,
    CurrentStock INT           NOT NULL DEFAULT 0,
    ReorderLevel INT           NOT NULL DEFAULT 5,
    ExpiryDate   DATE          NULL,
    Unit         NVARCHAR(20)  NULL,
    Notes        NVARCHAR(500) NULL,
    IsActive     BIT           NOT NULL DEFAULT 1,
    DateAdded    DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    ModifiedDate DATETIME2     NULL,
    CreatedBy    INT           NULL,
    CONSTRAINT CK_StandItems_CostPrice    CHECK (CostPrice >= 0),
    CONSTRAINT CK_StandItems_SellPrice    CHECK (SellPrice >= 0),
    CONSTRAINT CK_StandItems_CurrentStock CHECK (CurrentStock >= 0),
    CONSTRAINT CK_StandItems_ReorderLevel CHECK (ReorderLevel >= 0)
  );

  CREATE NONCLUSTERED INDEX IX_StandItems_Barcode    ON dbo.tblStandItems(Barcode)    WHERE Barcode IS NOT NULL;
  CREATE NONCLUSTERED INDEX IX_StandItems_SKU        ON dbo.tblStandItems(SKU)        WHERE SKU IS NOT NULL;
  CREATE NONCLUSTERED INDEX IX_StandItems_CategoryID ON dbo.tblStandItems(CategoryID);
  CREATE NONCLUSTERED INDEX IX_StandItems_Active_Expiry ON dbo.tblStandItems(IsActive, ExpiryDate);
END;

-- 3. Sales
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblStandSales')
BEGIN
  CREATE TABLE dbo.tblStandSales (
    SaleID        INT IDENTITY(1,1) PRIMARY KEY,
    SaleDate      DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    TotalAmount   INT           NOT NULL,
    TotalCost     INT           NOT NULL,
    TotalProfit   INT           NOT NULL,
    AmountPaid    INT           NOT NULL,
    Change        INT           NOT NULL DEFAULT 0,
    PaymentMethod NVARCHAR(20)  NOT NULL DEFAULT 'cash',
    CustomerNote  NVARCHAR(255) NULL,
    PersonID      INT           NULL REFERENCES dbo.tblpatients(PersonID),
    CashierID     INT           NULL REFERENCES dbo.tblUsers(UserID),
    VoidedDate    DATETIME2     NULL,
    VoidedBy      INT           NULL REFERENCES dbo.tblUsers(UserID),
    VoidReason    NVARCHAR(255) NULL
  );

  CREATE NONCLUSTERED INDEX IX_StandSales_SaleDate  ON dbo.tblStandSales(SaleDate);
  CREATE NONCLUSTERED INDEX IX_StandSales_PersonID  ON dbo.tblStandSales(PersonID)  WHERE PersonID IS NOT NULL;
  CREATE NONCLUSTERED INDEX IX_StandSales_CashierID ON dbo.tblStandSales(CashierID) WHERE CashierID IS NOT NULL;
END;

-- 4. Sale Line Items
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblStandSaleItems')
BEGIN
  CREATE TABLE dbo.tblStandSaleItems (
    SaleItemID INT IDENTITY(1,1) PRIMARY KEY,
    SaleID     INT NOT NULL REFERENCES dbo.tblStandSales(SaleID) ON DELETE CASCADE,
    ItemID     INT NOT NULL REFERENCES dbo.tblStandItems(ItemID),
    Quantity   INT NOT NULL,
    UnitPrice  INT NOT NULL,
    UnitCost   INT NOT NULL,
    LineTotal  INT NOT NULL,
    CONSTRAINT CK_StandSaleItems_Quantity CHECK (Quantity > 0)
  );

  CREATE NONCLUSTERED INDEX IX_StandSaleItems_SaleID ON dbo.tblStandSaleItems(SaleID);
  CREATE NONCLUSTERED INDEX IX_StandSaleItems_ItemID ON dbo.tblStandSaleItems(ItemID);
END;

-- 5. Stock Movements
IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblStandStockMovements')
BEGIN
  CREATE TABLE dbo.tblStandStockMovements (
    MovementID    INT IDENTITY(1,1) PRIMARY KEY,
    ItemID        INT           NOT NULL REFERENCES dbo.tblStandItems(ItemID),
    MovementType  NVARCHAR(20)  NOT NULL,
    Quantity      INT           NOT NULL,
    UnitCost      INT           NULL,
    TotalCost     INT           NULL,
    RelatedSaleID INT           NULL REFERENCES dbo.tblStandSales(SaleID),
    Reason        NVARCHAR(255) NULL,
    MovementDate  DATETIME2     NOT NULL DEFAULT SYSDATETIME(),
    PerformedBy   INT           NULL REFERENCES dbo.tblUsers(UserID)
  );

  CREATE NONCLUSTERED INDEX IX_StandStockMovements_ItemID       ON dbo.tblStandStockMovements(ItemID);
  CREATE NONCLUSTERED INDEX IX_StandStockMovements_MovementDate ON dbo.tblStandStockMovements(MovementDate);
  CREATE NONCLUSTERED INDEX IX_StandStockMovements_MovementType ON dbo.tblStandStockMovements(MovementType);
END;
