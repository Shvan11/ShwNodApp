/**
 * Emergency Admin Password Reset Script
 *
 * SECURITY NOTICE:
 * - This script can only be run directly on the server (requires filesystem access)
 * - It cannot be accessed via the web interface
 * - Use only when the admin password is forgotten
 *
 * Usage:
 *   npm run auth:emergency-reset                 (interactive; the root EMERGENCY-RESET-PASSWORD.bat wraps this)
 *   tsx scripts/reset-admin-password.js --username=admin --password=newpass123
 *   tsx scripts/reset-admin-password.js --username=admin --password=newpass123 --create
 *
 * If the user doesn't exist it can create it as a new active admin
 * (interactive prompt, or non-interactive with --create).
 */
import readline from 'readline';
import { getKysely } from '../services/database/kysely.js';
import { hashPassword } from '../middleware/auth.js';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(query) {
  return new Promise(resolve => rl.question(query, resolve));
}

// Parse command line arguments (--key=value, plus bare --create)
const argsMap = {};
process.argv.slice(2).forEach(arg => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    argsMap[key] = value ?? true;
  }
});
const interactive = !argsMap.password;

async function promptPassword() {
  console.log('\n🔐 Enter new password for this user:');
  const newPassword = await question('New Password (min 6 characters): ');

  if (newPassword.length < 6) {
    console.log('\n❌ ERROR: Password must be at least 6 characters\n');
    process.exit(1);
  }

  const confirmPassword = await question('Confirm Password: ');
  if (newPassword !== confirmPassword) {
    console.log('\n❌ ERROR: Passwords do not match\n');
    process.exit(1);
  }
  return newPassword;
}

async function resetAdminPassword() {
  const db = getKysely();

  console.log('\n╔════════════════════════════════════════╗');
  console.log('║   🚨 EMERGENCY PASSWORD RESET 🚨      ║');
  console.log('║   Admin Access Recovery Tool          ║');
  console.log('╚════════════════════════════════════════╝\n');

  // Step 1: Get username (default to 'admin')
  let username = argsMap.username;
  if (!username) {
    username = await question("Enter username to reset (default: admin): ");
    username = username.trim() || 'admin';
  }

  // Step 2: Look up the user (username is citext, so the match is case-insensitive)
  console.log(`\n🔍 Searching for user: ${username}...`);
  const user = await db
    .selectFrom('users')
    .select(['user_id', 'username', 'full_name', 'role', 'is_active'])
    .where('username', '=', username)
    .executeTakeFirst();

  let createAsNewAdmin = false;
  if (!user) {
    console.log(`\n❌ User '${username}' not found in database`);
    if (argsMap.create) {
      createAsNewAdmin = true;
    } else if (interactive) {
      const create = await question('Create it as a NEW ACTIVE ADMIN user? (yes/no): ');
      createAsNewAdmin = create.toLowerCase() === 'yes';
    }
    if (!createAsNewAdmin) {
      console.log('\n💡 Check the username spelling, or re-run with --create to add it as a new admin\n');
      process.exit(1);
    }
  } else {
    console.log('\n✅ User found:');
    console.log(`   UserID: ${user.user_id}`);
    console.log(`   Username: ${user.username}`);
    console.log(`   Full Name: ${user.full_name ?? '(none)'}`);
    console.log(`   Role: ${user.role ?? '(none)'}`);
    console.log(`   Active: ${user.is_active ? 'Yes' : 'No'}`);

    // Security warning for non-admin users
    if (user.role !== 'admin' && interactive) {
      console.log('\n⚠️  WARNING: This user does not have admin role!');
      const confirm = await question('Continue with password reset anyway? (yes/no): ');
      if (confirm.toLowerCase() !== 'yes') {
        console.log('\n❌ Password reset cancelled\n');
        process.exit(0);
      }
    }
  }

  // Step 3: Get new password
  let newPassword = argsMap.password;
  if (!newPassword) {
    newPassword = await promptPassword();
  } else if (newPassword.length < 6) {
    console.log('\n❌ ERROR: Password must be at least 6 characters\n');
    process.exit(1);
  }

  // Step 4: Final confirmation
  if (interactive && !createAsNewAdmin) {
    console.log('\n⚠️  You are about to reset the password for:');
    console.log(`   User: ${user.username} (${user.full_name ?? 'no full name'})`);
    const finalConfirm = await question('\nProceed with password reset? (yes/no): ');
    if (finalConfirm.toLowerCase() !== 'yes') {
      console.log('\n❌ Password reset cancelled\n');
      process.exit(0);
    }
  }

  // Step 5: Hash with the app's own policy (bcrypt, same rounds as login/change-password)
  console.log('\n🔒 Hashing new password...');
  const passwordHash = await hashPassword(newPassword);

  // Step 6: Write to database
  console.log('💾 Updating database...');
  if (createAsNewAdmin) {
    await db
      .insertInto('users')
      .values({
        username,
        password_hash: passwordHash,
        full_name: 'System Administrator',
        role: 'admin',
        is_active: true,
        created_by: 'emergency-reset'
      })
      .execute();
  } else {
    await db
      .updateTable('users')
      .set({ password_hash: passwordHash, is_active: true })
      .where('user_id', '=', user.user_id)
      .execute();
  }

  // Step 7: Success message
  console.log('\n╔════════════════════════════════════════╗');
  console.log(createAsNewAdmin
    ? '║   ✅ ADMIN USER CREATED!              ║'
    : '║   ✅ PASSWORD RESET SUCCESSFUL!       ║');
  console.log('╚════════════════════════════════════════╝\n');
  console.log('New login credentials:');
  console.log('┌────────────────────────────────────────┐');
  console.log(`│ Username: ${username.padEnd(29)}│`);
  console.log(`│ Password: ${newPassword.padEnd(29)}│`);
  console.log('└────────────────────────────────────────┘');
  if (!createAsNewAdmin) {
    console.log('\n✅ User has been reactivated (if was inactive)');
  }
  console.log('⚠️  IMPORTANT: Change this password after login!\n');
  console.log('🔒 SECURITY REMINDER:');
  console.log('   • Delete this terminal history');
  console.log('   • Use a strong password after login');
  console.log('   • Keep this script secure (server access only)\n');
}

// Handle script interruption
rl.on('SIGINT', () => {
  console.log('\n\n❌ Password reset cancelled by user\n');
  process.exit(0);
});

try {
  await resetAdminPassword();
} catch (error) {
  console.error('\n❌ ERROR during password reset:', error.message);
  console.error(error);
  process.exit(1);
}
rl.close();
await getKysely().destroy();
process.exit(0);
