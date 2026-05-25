/**
 * Authentication Setup Script
 * Creates tblUsers table and initial admin user
 */
import bcrypt from 'bcryptjs';
import { executeQuery, TYPES } from '../services/database/index.js';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

async function setupAuthentication() {
  console.log('\n=== Authentication Setup ===\n');

  try {
    // Step 1: Create tblUsers table
    console.log('📋 Step 1: Creating tblUsers table...');

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

        PRINT 'tblUsers table created successfully';
      END
      ELSE
      BEGIN
        PRINT 'tblUsers table already exists';
      END
    `;

    await executeQuery(createTableSQL, []);
    console.log('✅ Table created/verified\n');

    // Step 2: Check if admin user exists
    console.log('📋 Step 2: Checking for admin user...');
    const existingAdmin = await executeQuery(
      'SELECT UserID FROM dbo.tblUsers WHERE Username = @username',
      [['username', TYPES.NVarChar, 'admin']],
      (columns) => ({ userId: columns[0].value })
    );

    if (existingAdmin && existingAdmin.length > 0) {
      console.log('⚠️  Admin user already exists');
      const recreate = await question('Do you want to recreate the admin user? (yes/no): ');

      if (recreate.toLowerCase() !== 'yes') {
        console.log('❌ Skipping admin user creation\n');
        rl.close();
        process.exit(0);
      }

      // Delete existing admin
      await executeQuery(
        'DELETE FROM dbo.tblUsers WHERE Username = @username',
        [['username', TYPES.NVarChar, 'admin']]
      );
      console.log('🗑️  Deleted existing admin user\n');
    }

    // Step 3: Create admin user
    console.log('📋 Step 3: Creating admin user...');
    console.log('Please set a password for the admin account:');

    const password = await question('Password (or press Enter for default "admin123"): ');
    const finalPassword = password.trim() || 'admin123';

    if (!password.trim()) {
      console.log('⚠️  Using default password: admin123');
      console.log('⚠️  PLEASE CHANGE THIS PASSWORD AFTER FIRST LOGIN!\n');
    }

    // Hash the password
    console.log('🔐 Hashing password...');
    const passwordHash = await bcrypt.hash(finalPassword, 10);

    // Insert admin user
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

    console.log('\n✅ Admin user created successfully!');
    console.log('\n=== Setup Complete ===');
    console.log('\nYou can now login with:');
    console.log('  Username: admin');
    console.log(`  Password: ${finalPassword}`);
    console.log('\n');

  } catch (error) {
    console.error('\n❌ Error during setup:', error.message);
    console.error(error);
  }

  rl.close();
  process.exit(0);
}

setupAuthentication();
