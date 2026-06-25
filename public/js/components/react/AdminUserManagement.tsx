import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { usersListQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import Modal from './Modal';
import styles from './AdminUserManagement.module.css';
import { ASSIGNABLE_ROLES, ROLE_LABELS, type UserRole } from '@shared/auth/roles';

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: styles.roleAdmin,
  front_desk: styles.roleSecretary,
  clinical: styles.roleClinical,
};

interface User {
  userId: number;
  username: string;
  fullName: string | null;
  role: UserRole;
  isActive: boolean;
  lastLogin: string | null;
  createdAt: string;
}

interface FormData {
  username: string;
  password: string;
  fullName: string;
  role: UserRole;
}

interface Message {
  type: 'success' | 'error' | '';
  text: string;
}

/**
 * Admin User Management Component
 * Only accessible to admin users
 */
export default function AdminUserManagement() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const { data, isLoading: loading, isError } = useQuery(usersListQuery());
  const users = (data?.users ?? []) as User[];
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [message, setMessage] = useState<Message>({ type: '', text: '' });

  // Password-reset modal state
  const [resetTarget, setResetTarget] = useState<{ userId: number; username: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetting, setResetting] = useState(false);

  // Form state
  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
    fullName: '',
    role: 'front_desk'
  });

  // Refresh the shared user-list cache after a write.
  const fetchUsers = () => queryClient.invalidateQueries({ queryKey: qk.users.list() });

  // Surface a load failure during render (adjust-state-during-render) rather than
  // in an effect so the React Compiler can optimize it.
  const [prevIsError, setPrevIsError] = useState(isError);
  if (isError !== prevIsError) {
    setPrevIsError(isError);
    if (isError) setMessage({ type: 'error', text: 'Network error loading users' });
  }

  const handleCreateUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    try {
      await postJSON('/api/users', formData);
      setMessage({ type: 'success', text: 'User created successfully!' });
      setFormData({ username: '', password: '', fullName: '', role: 'front_desk' });
      setShowCreateForm(false);
      fetchUsers(); // Reload list
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error creating user') });
    }
  };

  const handleToggleActive = async (userId: number) => {
    if (!await confirm('Toggle user active status?', { title: 'Toggle Status' })) return;

    try {
      await putJSON(`/api/users/${userId}/toggle`, {});
      setMessage({ type: 'success', text: 'User status updated' });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    }
  };

  const handleRoleChange = async (userId: number, role: UserRole) => {
    if (!await confirm(`Change this user's role to "${ROLE_LABELS[role]}"?`, { title: 'Change Role' })) return;

    try {
      await putJSON(`/api/users/${userId}/role`, { role });
      setMessage({ type: 'success', text: 'Role updated' });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    }
  };

  const handleResetPassword = (userId: number, username: string) => {
    setResetTarget({ userId, username });
    setNewPasswordInput('');
  };

  const submitResetPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resetTarget || resetting) return;

    if (newPasswordInput.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    setResetting(true);
    try {
      await putJSON(`/api/users/${resetTarget.userId}/password`, { newPassword: newPasswordInput });
      setMessage({ type: 'success', text: `Password reset for ${resetTarget.username}` });
      setResetTarget(null);
      setNewPasswordInput('');
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    } finally {
      setResetting(false);
    }
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    if (!await confirm(`Are you sure you want to delete user "${username}"? This cannot be undone.`, { title: 'Delete User', danger: true, confirmText: 'Delete' })) return;

    try {
      await deleteJSON(`/api/users/${userId}`);
      setMessage({ type: 'success', text: `User ${username} deleted` });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    }
  };

  return (
    <div className={styles.container}>

      <div className={styles.header}>
        <h2>
          <i className="fas fa-users"></i> User Management
        </h2>
        <button
          className={`${styles.btn} ${styles.btnPrimary}`}
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <i className={`fas fa-${showCreateForm ? 'times' : 'plus'}`}></i>
          {showCreateForm ? 'Cancel' : 'Create User'}
        </button>
      </div>

      {message.text && (
        <div className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`}>
          {message.text}
        </div>
      )}

      {showCreateForm && (
        <div className={styles.createForm}>
          <h3>Create New User</h3>
          <form onSubmit={handleCreateUser}>
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="create-user-username">Username *</label>
                <input
                  id="create-user-username"
                  type="text"
                  value={formData.username}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="create-user-fullname">Full Name</label>
                <input
                  id="create-user-fullname"
                  type="text"
                  value={formData.fullName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>
            </div>

            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="create-user-password">Password * (min 6 characters)</label>
                <input
                  id="create-user-password"
                  type="password"
                  value={formData.password}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="create-user-role">Role *</label>
                <select
                  id="create-user-role"
                  value={formData.role}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({ ...formData, role: e.target.value as UserRole })}
                  required
                >
                  {ASSIGNABLE_ROLES.map((role) => (
                    <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              <i className="fas fa-save"></i> Create User
            </button>
          </form>
        </div>
      )}

      <div className={styles.usersTable}>
        {loading ? (
          <div className={styles.emptyState}>
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className={styles.emptyState}>
            No users found
          </div>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Username</th>
                <th>Full Name</th>
                <th>Role</th>
                <th>Status</th>
                <th>Last Login</th>
                <th>Created</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => (
                <tr key={user.userId}>
                  <td><strong>{user.username}</strong></td>
                  <td>{user.fullName || '-'}</td>
                  <td>
                    <select
                      className={`${styles.roleBadge} ${ROLE_BADGE_CLASS[user.role]}`}
                      value={user.role}
                      onChange={(e: ChangeEvent<HTMLSelectElement>) => handleRoleChange(user.userId, e.target.value as UserRole)}
                      aria-label={`Role for ${user.username}`}
                    >
                      {ASSIGNABLE_ROLES.map((role) => (
                        <option key={role} value={role}>{ROLE_LABELS[role]}</option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <span className={`${styles.statusBadge} ${user.isActive ? styles.statusActive : styles.statusInactive}`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className={styles.actions}>
                      <button
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                        onClick={() => handleResetPassword(user.userId, user.username)}
                        title="Reset Password"
                      >
                        <i className="fas fa-key"></i>
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                        onClick={() => handleToggleActive(user.userId)}
                        title={user.isActive ? 'Deactivate' : 'Activate'}
                      >
                        <i className={`fas fa-${user.isActive ? 'ban' : 'check'}`}></i>
                      </button>
                      <button
                        className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                        onClick={() => handleDeleteUser(user.userId, user.username)}
                        title="Delete User"
                      >
                        <i className="fas fa-trash"></i>
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {resetTarget && (
        <Modal
          isOpen
          onClose={() => { if (!resetting) setResetTarget(null); }}
          closeOnBackdropClick={!resetting}
          closeOnEscape={!resetting}
          contentClassName={styles.createForm}
        >
          <h3>Reset Password — {resetTarget.username}</h3>
          <form onSubmit={submitResetPassword}>
            <div className={styles.formGroup}>
              <label htmlFor="reset-new-password">New Password * (min 6 characters)</label>
              <input
                id="reset-new-password"
                type="password"
                value={newPasswordInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPasswordInput(e.target.value)}
                required
                minLength={6}
                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                autoFocus
              />
            </div>
            <div className={styles.actions}>
              <button
                type="button"
                className={`${styles.btn} ${styles.btnSecondary}`}
                onClick={() => setResetTarget(null)}
                disabled={resetting}
              >
                Cancel
              </button>
              <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={resetting}>
                <i className="fas fa-key"></i> {resetting ? 'Resetting…' : 'Reset Password'}
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
