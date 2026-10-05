import { useState, type FormEvent, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { useAuthUser } from '../../contexts/GlobalStateContext';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { usersListQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import Modal from './Modal';
import styles from './AdminUserManagement.module.css';
import { ASSIGNABLE_ROLES, ROLE_LABELS, normalizeRole, type UserRole } from '@shared/auth/roles';
import { MIN_PASSWORD_LENGTH } from '@shared/validation';
import type { UserRow } from '@shared/contracts/user-management.contract';
import { formatLocaleDate } from '@/utils/formatters';

const ROLE_BADGE_CLASS: Record<UserRole, string> = {
  admin: styles.roleAdmin,
  front_desk: styles.roleSecretary,
  clinical: styles.roleClinical,
};

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

// The server's rule (`shared/validation.ts#passwordString`), stated once for both forms.
// The labels used to say "min 6" while the server required 8 (audit FE-F22-3).
const PASSWORD_RULE = `min ${MIN_PASSWORD_LENGTH} characters`;
const EMPTY_FORM: FormData = { username: '', password: '', fullName: '', role: 'front_desk' };

/**
 * Admin User Management Component
 * Only accessible to admin users
 */
export default function AdminUserManagement() {
  const toast = useToast();
  const confirm = useConfirm();
  const queryClient = useQueryClient();
  const me = useAuthUser();
  const { data, isLoading: loading, isError } = useQuery(usersListQuery());
  const users: UserRow[] = data?.users ?? [];
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [message, setMessage] = useState<Message>({ type: '', text: '' });
  const [creating, setCreating] = useState(false);
  // One row-level write at a time (role / toggle / delete): a second click while the
  // first is in flight used to send it twice.
  const [busyUserId, setBusyUserId] = useState<number | null>(null);

  // Password-reset modal state
  const [resetTarget, setResetTarget] = useState<{ userId: number; username: string } | null>(null);
  const [newPasswordInput, setNewPasswordInput] = useState('');
  const [resetting, setResetting] = useState(false);

  const [formData, setFormData] = useState<FormData>(EMPTY_FORM);

  // Refresh the shared user-list cache after a write.
  const fetchUsers = () => queryClient.invalidateQueries({ queryKey: qk.users.list() });

  // Surface a load failure during render (adjust-state-during-render) rather than
  // in an effect so the React Compiler can optimize it.
  const [prevIsError, setPrevIsError] = useState(isError);
  if (isError !== prevIsError) {
    setPrevIsError(isError);
    if (isError) setMessage({ type: 'error', text: 'Network error loading users' });
  }

  const isSelf = (user: UserRow) => !!me?.username && user.username.toLowerCase() === me.username.toLowerCase();

  const handleCreateUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (creating) return;
    if (formData.password.length < MIN_PASSWORD_LENGTH) {
      setMessage({ type: 'error', text: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
      return;
    }
    setMessage({ type: '', text: '' });
    setCreating(true);
    try {
      await postJSON('/api/users', formData);
      setMessage({ type: 'success', text: `User ${formData.username} created` });
      setFormData(EMPTY_FORM);
      setShowCreateForm(false);
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error creating user') });
    } finally {
      setCreating(false);
    }
  };

  const handleToggleActive = async (user: UserRow) => {
    if (busyUserId !== null) return;
    const ok = user.isActive
      ? await confirm(
          `Deactivate "${user.username}"? They are signed out at once and can't sign in until reactivated.`,
          { title: 'Deactivate User', danger: true, confirmText: 'Deactivate' }
        )
      : await confirm(`Reactivate "${user.username}"? They will be able to sign in again.`, {
          title: 'Reactivate User',
          confirmText: 'Reactivate',
        });
    if (!ok) return;

    setBusyUserId(user.userId);
    try {
      await putJSON(`/api/users/${user.userId}/toggle`, {});
      setMessage({ type: 'success', text: `${user.username} ${user.isActive ? 'deactivated' : 'reactivated'}` });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleRoleChange = async (user: UserRow, role: UserRole) => {
    if (busyUserId !== null) return;
    const self = isSelf(user);
    const consequence = self
      ? ' This changes what you can do in this app straight away.'
      : ' They are signed out and sign in again with the new role.';
    if (!await confirm(`Change ${user.username}'s role to "${ROLE_LABELS[role]}"?${consequence}`, { title: 'Change Role' })) return;

    setBusyUserId(user.userId);
    try {
      await putJSON(`/api/users/${user.userId}/role`, { role });
      setMessage({ type: 'success', text: `${user.username} is now ${ROLE_LABELS[role]}` });
      fetchUsers();
      // Your own change applies to this session server-side; refresh what the shell
      // shows (tabs, menus) to match instead of waiting for a reload.
      if (self) void queryClient.invalidateQueries({ queryKey: qk.auth.me() });
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    } finally {
      setBusyUserId(null);
    }
  };

  const handleResetPassword = (userId: number, username: string) => {
    setResetTarget({ userId, username });
    setNewPasswordInput('');
  };

  const submitResetPassword = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!resetTarget || resetting) return;

    if (newPasswordInput.length < MIN_PASSWORD_LENGTH) {
      toast.error(`Password must be at least ${MIN_PASSWORD_LENGTH} characters`);
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

  const handleDeleteUser = async (user: UserRow) => {
    if (busyUserId !== null) return;
    if (!await confirm(`Are you sure you want to delete user "${user.username}"? This cannot be undone.`, { title: 'Delete User', danger: true, confirmText: 'Delete' })) return;

    setBusyUserId(user.userId);
    try {
      await deleteJSON(`/api/users/${user.userId}`);
      setMessage({ type: 'success', text: `User ${user.username} deleted` });
      fetchUsers();
    } catch (err) {
      setMessage({ type: 'error', text: httpErrorMessage(err, 'Network error') });
    } finally {
      setBusyUserId(null);
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
        <div className={`${styles.message} ${message.type === 'success' ? styles.success : styles.error}`} role="status">
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
                <label htmlFor="create-user-password">Password * ({PASSWORD_RULE})</label>
                <input
                  id="create-user-password"
                  type="password"
                  value={formData.password}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={MIN_PASSWORD_LENGTH}
                  autoComplete="new-password"
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

            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`} disabled={creating}>
              <i className="fas fa-save"></i> {creating ? 'Creating…' : 'Create User'}
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
              {users.map((user) => {
                const role = normalizeRole(user.role);
                const self = isSelf(user);
                const busy = busyUserId === user.userId;
                return (
                  <tr key={user.userId}>
                    <td><strong>{user.username}</strong>{self && ' (you)'}</td>
                    <td>{user.fullName || '-'}</td>
                    <td>
                      <select
                        className={`${styles.roleBadge} ${role ? ROLE_BADGE_CLASS[role] : ''}`}
                        value={role ?? ''}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => handleRoleChange(user, e.target.value as UserRole)}
                        disabled={busy}
                        aria-label={`Role for ${user.username}`}
                      >
                        {!role && <option value="" disabled>{user.role}</option>}
                        {ASSIGNABLE_ROLES.map((r) => (
                          <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <span className={`${styles.statusBadge} ${user.isActive ? styles.statusActive : styles.statusInactive}`}>
                        {user.isActive ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td>{formatLocaleDate(user.lastLogin) || 'Never'}</td>
                    <td>{formatLocaleDate(user.createdAt)}</td>
                    <td>
                      <div className={styles.actions}>
                        <button
                          className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                          onClick={() => handleResetPassword(user.userId, user.username)}
                          title="Reset Password"
                          aria-label={`Reset password for ${user.username}`}
                        >
                          <i className="fas fa-key"></i>
                        </button>
                        {/* The server refuses both on your own account; don't offer them. */}
                        {!self && (
                          <>
                            <button
                              className={`${styles.btn} ${styles.btnSecondary} ${styles.btnSmall}`}
                              onClick={() => handleToggleActive(user)}
                              disabled={busy}
                              title={user.isActive ? 'Deactivate' : 'Activate'}
                              aria-label={`${user.isActive ? 'Deactivate' : 'Activate'} ${user.username}`}
                            >
                              <i className={`fas fa-${user.isActive ? 'ban' : 'check'}`}></i>
                            </button>
                            <button
                              className={`${styles.btn} ${styles.btnDanger} ${styles.btnSmall}`}
                              onClick={() => handleDeleteUser(user)}
                              disabled={busy}
                              title="Delete User"
                              aria-label={`Delete ${user.username}`}
                            >
                              <i className="fas fa-trash"></i>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
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
          ariaLabelledBy="reset-password-modal-title"
        >
          <h3 id="reset-password-modal-title">Reset Password — {resetTarget.username}</h3>
          <form onSubmit={submitResetPassword}>
            <div className={styles.formGroup}>
              <label htmlFor="reset-new-password">New Password * ({PASSWORD_RULE})</label>
              <input
                id="reset-new-password"
                type="password"
                value={newPasswordInput}
                onChange={(e: ChangeEvent<HTMLInputElement>) => setNewPasswordInput(e.target.value)}
                required
                minLength={MIN_PASSWORD_LENGTH}
                autoComplete="new-password"
                // eslint-disable-next-line jsx-a11y/no-autofocus -- intentional focus on open
                autoFocus
              />
              <small>Signs {resetTarget.username} out everywhere they are signed in.</small>
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
