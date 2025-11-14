-- Users Table for Authentication
-- Run this in SQL Server Management Studio or via your database tool

CREATE TABLE dbo.tblUsers (
  UserID INT IDENTITY(1,1) PRIMARY KEY,
  Username NVARCHAR(50) NOT NULL UNIQUE,
  PasswordHash NVARCHAR(255) NOT NULL,
  FullName NVARCHAR(100),
  Role NVARCHAR(50) DEFAULT 'user', -- 'admin', 'doctor', 'receptionist', 'user'
  IsActive BIT DEFAULT 1,
  LastLogin DATETIME,
  CreatedAt DATETIME DEFAULT GETDATE(),
  CreatedBy NVARCHAR(50)
);

-- Create index for faster username lookups
CREATE INDEX IDX_Users_Username ON dbo.tblUsers(Username);
CREATE INDEX IDX_Users_IsActive ON dbo.tblUsers(IsActive);

-- Insert initial admin user
-- Default password: admin123
-- IMPORTANT: Change this password immediately after first login!
INSERT INTO dbo.tblUsers (Username, PasswordHash, FullName, Role, CreatedBy)
VALUES (
  'admin',
  '$2a$10$rQZ9YZ7Z7Z7Z7Z7Z7Z7Z7uK7GvV6yV6yV6yV6yV6yV6yV6yV6yV6y', -- Placeholder - will create proper hash in next step
  'Administrator',
  'admin',
  'system'
);

-- Note: We'll generate the actual password hash using a script in the next step
