-- =====================================================
-- Create Estimated Cost Presets Table
-- =====================================================
-- This table stores preset values for estimated treatment costs
-- to make data entry faster and more consistent

-- Drop table if exists (for clean reinstall)
IF OBJECT_ID('dbo.tblEstimatedCostPresets', 'U') IS NOT NULL
    DROP TABLE dbo.tblEstimatedCostPresets;
GO

-- Create table
CREATE TABLE dbo.tblEstimatedCostPresets (
    PresetID INT IDENTITY(1,1) PRIMARY KEY,
    Amount DECIMAL(18,2) NOT NULL,
    Currency NVARCHAR(10) NOT NULL,
    DisplayOrder INT DEFAULT 0
);
GO

-- Create index for fast currency-based queries
CREATE INDEX IX_EstimatedCostPresets_Currency
ON dbo.tblEstimatedCostPresets(Currency, DisplayOrder);
GO

-- =====================================================
-- Seed Default Data
-- =====================================================

-- IQD Presets: 2,000,000 to 3,500,000 (100,000 increments)
INSERT INTO dbo.tblEstimatedCostPresets (Amount, Currency, DisplayOrder) VALUES
(2000000, 'IQD', 1),
(2100000, 'IQD', 2),
(2200000, 'IQD', 3),
(2300000, 'IQD', 4),
(2400000, 'IQD', 5),
(2500000, 'IQD', 6),
(2600000, 'IQD', 7),
(2700000, 'IQD', 8),
(2800000, 'IQD', 9),
(2900000, 'IQD', 10),
(3000000, 'IQD', 11),
(3100000, 'IQD', 12),
(3200000, 'IQD', 13),
(3300000, 'IQD', 14),
(3400000, 'IQD', 15),
(3500000, 'IQD', 16);

-- USD Presets: 1,500 to 2,500 (100 increments)
INSERT INTO dbo.tblEstimatedCostPresets (Amount, Currency, DisplayOrder) VALUES
(1500, 'USD', 1),
(1600, 'USD', 2),
(1700, 'USD', 3),
(1800, 'USD', 4),
(1900, 'USD', 5),
(2000, 'USD', 6),
(2100, 'USD', 7),
(2200, 'USD', 8),
(2300, 'USD', 9),
(2400, 'USD', 10),
(2500, 'USD', 11);

GO

-- Verify data
SELECT Currency, COUNT(*) as PresetCount, MIN(Amount) as MinAmount, MAX(Amount) as MaxAmount
FROM dbo.tblEstimatedCostPresets
GROUP BY Currency
ORDER BY Currency;
GO

PRINT 'Estimated Cost Presets table created and seeded successfully!';
GO
