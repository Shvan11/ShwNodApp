import React, { useState, useEffect } from 'react';

/**
 * Admin User Management Component
 * Only accessible to admin users
 */
export default function AdminUserManagement() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  // Form state
  const [formData, setFormData] = useState({
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

  const handleCreateUser = async (e) => {
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

  const handleToggleActive = async (userId) => {
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

  const handleResetPassword = async (userId, username) => {
    const newPassword = prompt(`Enter new password for ${username}:`);
    if (!newPassword) return;

    if (newPassword.length < 6) {
      alert('Password must be at least 6 characters');
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

  const handleDeleteUser = async (userId, username) => {
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
      <style>{`
        .admin-user-mgmt-container {
          max-width: 1200px;
          margin: 0 auto;
          padding: 20px;
        }

        .admin-user-mgmt-container .header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 20px;
        }

        .admin-user-mgmt-container .header h2 {
          margin: 0;
          font-size: 24px;
          color: #333;
        }

        .admin-user-mgmt-container .message {
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .admin-user-mgmt-container .message.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }

        .admin-user-mgmt-container .message.error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .admin-user-mgmt-container .user-mgmt-btn {
          padding: 10px 20px;
          border: none;
          border-radius: 4px;
          cursor: pointer;
          font-size: 14px;
          font-weight: 500;
          transition: all 0.2s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        }

        .admin-user-mgmt-container .user-mgmt-btn.primary {
          background: #4CAF50;
          color: white;
        }

        .admin-user-mgmt-container .user-mgmt-btn.primary:hover {
          background: #45a049;
        }

        .admin-user-mgmt-container .user-mgmt-btn.secondary {
          background: #6c757d;
          color: white;
        }

        .admin-user-mgmt-container .user-mgmt-btn.secondary:hover {
          background: #5a6268;
        }

        .admin-user-mgmt-container .user-mgmt-btn.danger {
          background: #dc3545;
          color: white;
        }

        .admin-user-mgmt-container .user-mgmt-btn.small {
          padding: 6px 12px;
          font-size: 12px;
        }

        .admin-user-mgmt-container .create-form {
          background: white;
          padding: 24px;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          margin-bottom: 20px;
        }

        .admin-user-mgmt-container .form-row {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 16px;
          margin-bottom: 16px;
        }

        .admin-user-mgmt-container .form-group {
          margin-bottom: 16px;
        }

        .admin-user-mgmt-container .form-group label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: #444;
          font-size: 14px;
        }

        .admin-user-mgmt-container .form-group input,
        .admin-user-mgmt-container .form-group select {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .admin-user-mgmt-container .users-table {
          background: white;
          border-radius: 8px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
          overflow: hidden;
        }

        .admin-user-mgmt-container table {
          width: 100%;
          border-collapse: collapse;
        }

        .admin-user-mgmt-container th {
          background: #f8f9fa;
          padding: 12px;
          text-align: left;
          font-weight: 600;
          color: #333;
          border-bottom: 2px solid #dee2e6;
        }

        .admin-user-mgmt-container td {
          padding: 12px;
          border-bottom: 1px solid #dee2e6;
        }

        .admin-user-mgmt-container tr:hover {
          background: #f8f9fa;
        }

        .admin-user-mgmt-container .role-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
          text-transform: capitalize;
        }

        .admin-user-mgmt-container .role-badge.admin {
          background: #4CAF50;
          color: white;
        }

        .admin-user-mgmt-container .role-badge.doctor {
          background: #2196F3;
          color: white;
        }

        .admin-user-mgmt-container .role-badge.receptionist {
          background: #FF9800;
          color: white;
        }

        .admin-user-mgmt-container .role-badge.user {
          background: #9E9E9E;
          color: white;
        }

        .admin-user-mgmt-container .status-badge {
          display: inline-block;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 600;
        }

        .admin-user-mgmt-container .status-badge.active {
          background: #d4edda;
          color: #155724;
        }

        .admin-user-mgmt-container .status-badge.inactive {
          background: #f8d7da;
          color: #721c24;
        }

        .admin-user-mgmt-container .actions {
          display: flex;
          gap: 8px;
        }
      `}</style>

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
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  required
                />
              </div>
              <div className="form-group">
                <label>Full Name</label>
                <input
                  type="text"
                  value={formData.fullName}
                  onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                />
              </div>
            </div>

            <div className="form-row">
              <div className="form-group">
                <label>Password * (min 6 characters)</label>
                <input
                  type="password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  required
                  minLength={6}
                />
              </div>
              <div className="form-group">
                <label>Role *</label>
                <select
                  value={formData.role}
                  onChange={(e) => setFormData({ ...formData, role: e.target.value })}
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
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
            Loading users...
          </div>
        ) : users.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#666' }}>
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
