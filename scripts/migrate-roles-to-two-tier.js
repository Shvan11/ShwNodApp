/**
 * Migrate User Roles to Two-Tier System
 *
 * Updates existing user roles to the new simplified system:
 * - admin → admin (unchanged)
 * - doctor, receptionist, user → secretary
 *
 * Usage: node scripts/migrate-roles-to-two-tier.js
 */
import { executeQuery, TYPES } from '../services/database/index.js';

async function migrateRoles() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   Role Migration to Two-Tier System   ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Step 1: Check current role distribution
    console.log('📊 Step 1: Checking current role distribution...\n');

    const currentRoles = await executeQuery(
      `SELECT Role, COUNT(*) as Count
       FROM dbo.tblUsers
       GROUP BY Role
       ORDER BY Count DESC`,
      [],
      (columns) => ({
        role: columns[0].value,
        count: columns[1].value
      })
    );

    console.log('Current roles:');
    if (currentRoles && currentRoles.length > 0) {
      currentRoles.forEach(r => {
        console.log(`  - ${r.role}: ${r.count} user(s)`);
      });
    } else {
      console.log('  No users found');
    }

    // Step 2: Preview changes
    console.log('\n📋 Step 2: Preview of changes:\n');

    const usersToMigrate = await executeQuery(
      `SELECT UserID, Username, FullName, Role
       FROM dbo.tblUsers
       WHERE Role NOT IN ('admin', 'secretary')
       ORDER BY Role, Username`,
      [],
      (columns) => ({
        userId: columns[0].value,
        username: columns[1].value,
        fullName: columns[2].value,
        role: columns[3].value
      })
    );

    if (!usersToMigrate || usersToMigrate.length === 0) {
      console.log('✅ No users need migration - all users already have admin or secretary roles\n');
      process.exit(0);
    }

    console.log(`Found ${usersToMigrate.length} user(s) to migrate:\n`);
    usersToMigrate.forEach(u => {
      console.log(`  ${u.username} (${u.fullName || 'No name'})`);
      console.log(`    Current: ${u.role} → New: secretary`);
    });

    // Step 3: Perform migration
    console.log('\n🔄 Step 3: Migrating roles...\n');

    const result = await executeQuery(
      `UPDATE dbo.tblUsers
       SET Role = 'secretary'
       WHERE Role NOT IN ('admin', 'secretary')`,
      []
    );

    console.log(`✅ Migration complete! Updated ${result.rowCount || usersToMigrate.length} user(s)\n`);

    // Step 4: Verify migration
    console.log('✓ Step 4: Verifying migration...\n');

    const finalRoles = await executeQuery(
      `SELECT Role, COUNT(*) as Count
       FROM dbo.tblUsers
       GROUP BY Role
       ORDER BY Count DESC`,
      [],
      (columns) => ({
        role: columns[0].value,
        count: columns[1].value
      })
    );

    console.log('Final role distribution:');
    if (finalRoles && finalRoles.length > 0) {
      finalRoles.forEach(r => {
        console.log(`  - ${r.role}: ${r.count} user(s)`);
      });
    }

    // Verify only admin and secretary roles exist
    const hasOldRoles = finalRoles.some(r => !['admin', 'secretary'].includes(r.role));
    if (hasOldRoles) {
      console.log('\n⚠️  WARNING: Some users still have old roles!');
      console.log('   Please check the database manually.\n');
      process.exit(1);
    }

    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ MIGRATION SUCCESSFUL!            ║');
    console.log('╚════════════════════════════════════════╝\n');

    console.log('Role System Updated:');
    console.log('  - admin: Full access to all records');
    console.log('  - secretary: Can edit/delete only today\'s records\n');

    console.log('💡 Next Steps:');
    console.log('   1. Inform users about the new role system');
    console.log('   2. Review permissions with your team');
    console.log('   3. Test the system with different roles\n');

  } catch (error) {
    console.error('\n❌ Error during migration:', error.message);
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

migrateRoles();
