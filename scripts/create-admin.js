/**
 * Create Admin User Script
 * Simple non-interactive script to create admin user
 */
import bcrypt from 'bcryptjs';
import { executeQuery, TYPES } from '../services/database/index.js';

async function createAdminUser() {
  console.log('\n=== Creating Admin User ===\n');

  try {
    // Step 1: Create tblUsers table if it doesn't exist
    console.log('📋 Creating tblUsers table...');

    const createTableSQL = `
      IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'tblUsers')
      BEGIN
        CREATE TABLE dbo.tblUsers (
          UserID INT IDENTITY(1,1) PRIMARY KEY,
          Username NVARCHAR(50) NOT NULL UNIQUE,
          PasswordHash NVARCHAR(255) NOT NULL,
          FullName NVARCHAR(100),
          Role NVARCHAR(50) DEFAULT 'secretary',
          IsActive BIT DEFAULT 1,
          LastLogin DATETIME,
          CreatedAt DATETIME DEFAULT GETDATE(),
          CreatedBy NVARCHAR(50)
        );

        CREATE INDEX IDX_Users_Username ON dbo.tblUsers(Username);
        CREATE INDEX IDX_Users_IsActive ON dbo.tblUsers(IsActive);
      END
    `;

    await executeQuery(createTableSQL, []);
    console.log('✅ Table created/verified');

    // Step 2: Check if admin exists
    console.log('\n📋 Checking for existing admin user...');
    const existingAdmin = await executeQuery(
      'SELECT UserID FROM dbo.tblUsers WHERE Username = @username',
      [['username', TYPES.NVarChar, 'admin']],
      (columns) => ({ userId: columns[0].value })
    );

    if (existingAdmin && existingAdmin.length > 0) {
      console.log('⚠️  Admin user already exists - deleting and recreating...');
      await executeQuery(
        'DELETE FROM dbo.tblUsers WHERE Username = @username',
        [['username', TYPES.NVarChar, 'admin']]
      );
    }

    // Step 3: Create admin with default password
    console.log('📋 Creating admin user...');
    const defaultPassword = 'admin123';
    const passwordHash = await bcrypt.hash(defaultPassword, 10);

    await executeQuery(
      `INSERT INTO dbo.tblUsers (Username, PasswordHash, FullName, Role, CreatedBy)
       VALUES (@username, @hash, @fullName, @role, @createdBy)`,
      [
        ['username', TYPES.NVarChar, 'admin'],
        ['hash', TYPES.NVarChar, passwordHash],
        ['fullName', TYPES.NVarChar, 'Administrator'],
        ['role', TYPES.NVarChar, 'admin'],
        ['createdBy', TYPES.NVarChar, 'setup-script']
      ]
    );

    console.log('\n✅ SUCCESS! Admin user created\n');
    console.log('═══════════════════════════════════');
    console.log('  Username: admin');
    console.log('  Password: admin123');
    console.log('═══════════════════════════════════');
    console.log('\n⚠️  IMPORTANT: Change this password after first login!\n');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

createAdminUser();
