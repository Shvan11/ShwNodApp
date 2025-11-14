/**
 * Emergency Admin Password Reset Script
 *
 * SECURITY NOTICE:
 * - This script can only be run directly on the server (requires filesystem access)
 * - It cannot be accessed via the web interface
 * - Use only when admin password is forgotten
 *
 * Usage:
 *   node scripts/reset-admin-password.js
 *   node scripts/reset-admin-password.js --username=admin --password=newpass123
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

// Parse command line arguments
const args = process.argv.slice(2);
const argsMap = {};
args.forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    argsMap[key] = value;
  }
});

async function resetAdminPassword() {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   🚨 EMERGENCY PASSWORD RESET 🚨      ║');
  console.log('║   Admin Access Recovery Tool          ║');
  console.log('╚════════════════════════════════════════╝\n');

  try {
    // Step 1: Get username (default to 'admin')
    let username = argsMap.username;
    if (!username) {
      username = await question('Enter username to reset (default: admin): ');
      username = username.trim() || 'admin';
    }

    // Step 2: Check if user exists
    console.log(`\n🔍 Searching for user: ${username}...`);
    const existingUser = await executeQuery(
      `SELECT UserID, Username, FullName, Role, IsActive
       FROM dbo.tblUsers
       WHERE Username = @username`,
      [['username', TYPES.NVarChar, username]],
      (columns) => ({
        userId: columns[0].value,
        username: columns[1].value,
        fullName: columns[2].value,
        role: columns[3].value,
        isActive: columns[4].value
      })
    );

    if (!existingUser || existingUser.length === 0) {
      console.log(`\n❌ ERROR: User '${username}' not found in database`);
      console.log('\n💡 Available options:');
      console.log('   1. Run: node scripts/create-admin.js (to create new admin)');
      console.log('   2. Check username spelling and try again\n');
      rl.close();
      process.exit(1);
    }

    const user = existingUser[0];
    console.log('\n✅ User found:');
    console.log(`   UserID: ${user.userId}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Full Name: ${user.fullName}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Active: ${user.isActive ? 'Yes' : 'No'}`);

    // Security warning for non-admin users
    if (user.role !== 'admin') {
      console.log('\n⚠️  WARNING: This user does not have admin role!');
      const confirm = await question('Continue with password reset anyway? (yes/no): ');
      if (confirm.toLowerCase() !== 'yes') {
        console.log('\n❌ Password reset cancelled\n');
        rl.close();
        process.exit(0);
      }
    }

    // Step 3: Get new password
    let newPassword = argsMap.password;
    if (!newPassword) {
      console.log('\n🔐 Enter new password for this user:');
      newPassword = await question('New Password (min 6 characters): ');

      if (newPassword.length < 6) {
        console.log('\n❌ ERROR: Password must be at least 6 characters\n');
        rl.close();
        process.exit(1);
      }

      const confirmPassword = await question('Confirm Password: ');

      if (newPassword !== confirmPassword) {
        console.log('\n❌ ERROR: Passwords do not match\n');
        rl.close();
        process.exit(1);
      }
    } else {
      // Validate command-line password
      if (newPassword.length < 6) {
        console.log('\n❌ ERROR: Password must be at least 6 characters\n');
        process.exit(1);
      }
    }

    // Step 4: Final confirmation
    if (!argsMap.password) {
      console.log('\n⚠️  You are about to reset the password for:');
      console.log(`   User: ${user.username} (${user.fullName})`);
      const finalConfirm = await question('\nProceed with password reset? (yes/no): ');

      if (finalConfirm.toLowerCase() !== 'yes') {
        console.log('\n❌ Password reset cancelled\n');
        rl.close();
        process.exit(0);
      }
    }

    // Step 5: Hash new password
    console.log('\n🔒 Hashing new password...');
    const passwordHash = await bcrypt.hash(newPassword, 10);

    // Step 6: Update password in database
    console.log('💾 Updating database...');
    await executeQuery(
      `UPDATE dbo.tblUsers
       SET PasswordHash = @hash,
           IsActive = 1
       WHERE Username = @username`,
      [
        ['hash', TYPES.NVarChar, passwordHash],
        ['username', TYPES.NVarChar, username]
      ]
    );

    // Step 7: Success message
    console.log('\n╔════════════════════════════════════════╗');
    console.log('║   ✅ PASSWORD RESET SUCCESSFUL!       ║');
    console.log('╚════════════════════════════════════════╝\n');
    console.log('New login credentials:');
    console.log('┌────────────────────────────────────────┐');
    console.log(`│ Username: ${username.padEnd(29)}│`);
    console.log(`│ Password: ${newPassword.padEnd(29)}│`);
    console.log('└────────────────────────────────────────┘');
    console.log('\n✅ User has been reactivated (if was inactive)');
    console.log('⚠️  IMPORTANT: Change this password after login!\n');

    // Step 8: Security reminder
    console.log('🔒 SECURITY REMINDER:');
    console.log('   • Delete this terminal history');
    console.log('   • Use a strong password after login');
    console.log('   • Keep this script secure (server access only)\n');

  } catch (error) {
    console.error('\n❌ ERROR during password reset:', error.message);
    console.error(error);
    process.exit(1);
  }

  rl.close();
  process.exit(0);
}

// Handle script interruption
rl.on('SIGINT', () => {
  console.log('\n\n❌ Password reset cancelled by user\n');
  rl.close();
  process.exit(0);
});

resetAdminPassword();
