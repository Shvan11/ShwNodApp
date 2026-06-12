import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { fetchJSON, postJSON, httpErrorMessage } from '@/core/http';
import { clearLoaderCache } from '@/router/loader-cache';
import * as authContract from '@shared/contracts/auth.contract';
import styles from './UserManagement.module.css';

interface UserInfo {
  username: string;
  fullName: string | null;
  role: string;
}

interface Message {
  type: 'success' | 'error' | '';
  text: string;
}

/**
 * User Management Component
 * - Change password
 * - (Future: Admin can manage users)
 */
export default function UserManagement() {
  const toast = useToast();
  const confirm = useConfirm();
  const [userInfo, setUserInfo] = useState<UserInfo | null>(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState<Message>({ type: '', text: '' });
  const [loading, setLoading] = useState(false);

  // Load current user info on mount
  useEffect(() => {
    async function fetchUserInfo() {
      try {
        const data = await fetchJSON<{ success: boolean; user?: UserInfo }>('/api/auth/me', { schema: authContract.me.response });
        if (data.success && data.user) {
          setUserInfo(data.user);
        }
      } catch (error) {
        console.error('Failed to load user info:', error);
      }
    }
    fetchUserInfo();
  }, []);

  const handleChangePassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    // Validation
    if (!currentPassword || !newPassword || !confirmPassword) {
      setMessage({ type: 'error', text: 'All fields are required' });
      return;
    }

    if (newPassword.length < 6) {
      setMessage({ type: 'error', text: 'New password must be at least 6 characters' });
      return;
    }

    if (newPassword !== confirmPassword) {
      setMessage({ type: 'error', text: 'New passwords do not match' });
      return;
    }

    setLoading(true);

    try {
      await postJSON('/api/auth/change-password', { currentPassword, newPassword });
      setMessage({ type: 'success', text: 'Password changed successfully!' });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error. Please try again.') });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!await confirm('Are you sure you want to logout?', { title: 'Logout' })) {
      return;
    }

    try {
      await postJSON('/api/auth/logout', {});
      // Drop cached loader data so the next user in this tab can't see it.
      clearLoaderCache();
      // Logout successful - redirect to login (security-logout exception to React Router nav)
      window.location.href = '/login.html';
    } catch (err) {
      console.error('Logout failed:', err);
      toast.error('Logout failed: ' + httpErrorMessage(err, 'Please try again.'));
    }
  };

  return (
    <div className={styles.userManagementContainer}>

      {/* User Account Info Section */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>
          <i className="fas fa-user"></i>
          Account Information
        </h2>
        <p className={styles.sectionDescription}>
          Your current account details
        </p>

        {userInfo ? (
          <div className={styles.userAccountInfo}>
            <strong>Username:</strong>
            <span>{userInfo.username}</span>

            <strong>Full Name:</strong>
            <span>{userInfo.fullName || 'Not set'}</span>

            <strong>Role:</strong>
            <span className={`${styles.userRoleBadge} ${userInfo.role === 'admin' ? styles.admin : ''}`}>
              {userInfo.role}
            </span>
          </div>
        ) : (
          <div className={styles.userLoadingText}>Loading user information...</div>
        )}
      </div>

      {/* Change Password Section */}
      <div className={styles.sectionCard}>
        <h2 className={styles.sectionTitle}>
          <i className="fas fa-key"></i>
          Change Password
        </h2>
        <p className={styles.sectionDescription}>
          Update your account password. Make sure to use a strong password for security.
        </p>

        {message.text && (
          <div className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleChangePassword}>
          <div className={styles.formGroup}>
            <label htmlFor="currentPassword">Current Password</label>
            <input
              type="password"
              id="currentPassword"
              value={currentPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setCurrentPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              value={newPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirmPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div className={styles.passwordRequirements}>
            <strong>Password Requirements:</strong>
            <ul>
              <li>Minimum 6 characters</li>
              <li>Use a unique password not used elsewhere</li>
            </ul>
          </div>

          <button
            type="submit"
            className={`${styles.userMgmtBtn} ${styles.primary}`}
            disabled={loading}
          >
            {loading ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>

        {/* Logout Section */}
        <div className={styles.logoutSection}>
          <h3 className={`${styles.sectionTitle} ${styles.sectionTitleSmall}`}>
            <i className="fas fa-sign-out-alt"></i>
            Session Management
          </h3>
          <p className={styles.sectionDescription}>
            Sign out of your account on this device.
          </p>
          <button
            onClick={handleLogout}
            className={`${styles.userMgmtBtn} ${styles.danger}`}
          >
            <i className="fas fa-sign-out-alt"></i>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}
