-- ============================================================
-- Seed: Stand Categories (initial 3)
-- Idempotent — safe to run multiple times.
-- ============================================================

IF NOT EXISTS (SELECT 1 FROM dbo.tblStandCategories WHERE CategoryName = N'Mouthwash')
  INSERT INTO dbo.tblStandCategories (CategoryName) VALUES (N'Mouthwash');

IF NOT EXISTS (SELECT 1 FROM dbo.tblStandCategories WHERE CategoryName = N'Toothbrush')
  INSERT INTO dbo.tblStandCategories (CategoryName) VALUES (N'Toothbrush');

IF NOT EXISTS (SELECT 1 FROM dbo.tblStandCategories WHERE CategoryName = N'Therapeutic Gels')
  INSERT INTO dbo.tblStandCategories (CategoryName) VALUES (N'Therapeutic Gels');
