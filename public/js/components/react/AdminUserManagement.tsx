import { useState, useEffect, FormEvent, ChangeEvent } from 'react';
import { useToast } from '../../contexts/ToastContext';

type UserRole = 'secretary' | 'admin';

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
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [message, setMessage] = useState<Message>({ type: '', text: '' });

  // Form state
  const [formData, setFormData] = useState<FormData>({
    username: '',
    password: '',
    fullName: '',
    role: 'secretary'
  });

  // Load users on mount
  useEffect(() => {
    fetchUsers();
  }, []);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        credentials: 'include'
      });
      const data = await response.json();

      if (data.success) {
        setUsers(data.users);
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to load users' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error loading users' });
    } finally {
      setLoading(false);
    }
  };

  const handleCreateUser = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setMessage({ type: '', text: '' });

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(formData)
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'User created successfully!' });
        setFormData({ username: '', password: '', fullName: '', role: 'secretary' });
        setShowCreateForm(false);
        fetchUsers(); // Reload list
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to create user' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error creating user' });
    }
  };

  const handleToggleActive = async (userId: number) => {
    if (!confirm('Toggle user active status?')) return;

    try {
      const response = await fetch(`/api/users/${userId}/toggle`, {
        method: 'PUT',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'User status updated' });
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to update status' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error' });
    }
  };

  const handleResetPassword = async (userId: number, username: string) => {
    const newPassword = prompt(`Enter new password for ${username}:`);
    if (!newPassword) return;

    if (newPassword.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }

    try {
      const response = await fetch(`/api/users/${userId}/password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ newPassword })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `Password reset for ${username}` });
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to reset password' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error' });
    }
  };

  const handleDeleteUser = async (userId: number, username: string) => {
    if (!confirm(`Are you sure you want to delete user "${username}"? This cannot be undone.`)) return;

    try {
      const response = await fetch(`/api/users/${userId}`, {
        method: 'DELETE',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: `User ${username} deleted` });
        fetchUsers();
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to delete user' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error' });
    }
  };

  return (
    <div className="admin-user-mgmt-container">

      <div className="header">
        <h2>
          <i className="fas fa-users"></i> User Management
        </h2>
        <button
          className="user-mgmt-btn primary"
          onClick={() => setShowCreateForm(!showCreateForm)}
        >
          <i className="fas fa-plus"></i>
          {showCreateForm ? 'Cancel' : 'Create User'}
        </button>
      </div>

      {message.text && (
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}

      {showCreateForm && (
        <div className="create-form">
          <h3>Create New User</h3>
          <form onSubmit={handleCreateUser}>
            <div className="form-row">
              <div className="form-group">
                <label>Username *</label>
                <input
                  type="text"
                  value={formData.username}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Password * (min 6 characters)</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <select
                  value={formData.role}
                  onChange={(e: ChangeEvent<HTMLSelectElement>) => setFormData({ ...formData, role: e.target.value as UserRole })}
                  required
                >
                  <option value="secretary">Secretary - Can edit/delete today's records only</option>
                  <option value="admin">Admin - Full access to all records</option>
                </select>
              </div>
            </div>

            <button type="submit" className="user-mgmt-btn primary">
              <i className="fas fa-save"></i> Create User
            </button>
          </form>
        </div>
      )}

      <div className="users-table">
        {loading ? (
          <div className="empty-state-message">
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div className="empty-state-message">
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
                    <span className={`role-badge ${user.role}`}>
                      {user.role}
                    </span>
                  </td>
                  <td>
                    <span className={`status-badge ${user.isActive ? 'active' : 'inactive'}`}>
                      {user.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td>{user.lastLogin ? new Date(user.lastLogin).toLocaleDateString() : 'Never'}</td>
                  <td>{new Date(user.createdAt).toLocaleDateString()}</td>
                  <td>
                    <div className="actions">
                      <button
                        className="user-mgmt-btn secondary small"
                        onClick={() => handleResetPassword(user.userId, user.username)}
                        title="Reset Password"
                      >
                        <i className="fas fa-key"></i>
                      </button>
                      <button
                        className="user-mgmt-btn secondary small"
                        onClick={() => handleToggleActive(user.userId)}
                        title={user.isActive ? 'Deactivate' : 'Activate'}
                      >
                        <i className={`fas fa-${user.isActive ? 'ban' : 'check'}`}></i>
                      </button>
                      <button
                        className="user-mgmt-btn danger small"
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
    </div>
  );
}
