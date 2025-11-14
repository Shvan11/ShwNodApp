import React, { useState } from 'react';

/**
 * User Management Component
 * - Change password
 * - (Future: Admin can manage users)
 */
export default function UserManagement() {
  const [userInfo, setUserInfo] = useState(null);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [message, setMessage] = useState({ type: '', text: '' });
  const [loading, setLoading] = useState(false);

  // Load current user info on mount
  React.useEffect(() => {
    async function fetchUserInfo() {
      try {
        const response = await fetch('/api/auth/me', {
          credentials: 'include'
        });
        const data = await response.json();
        if (data.success) {
          setUserInfo(data.user);
        }
      } catch (error) {
        console.error('Failed to load user info:', error);
      }
    }
    fetchUserInfo();
  }, []);

  const handleChangePassword = async (e) => {
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
      const response = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword })
      });

      const data = await response.json();

      if (data.success) {
        setMessage({ type: 'success', text: 'Password changed successfully!' });
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
      } else {
        setMessage({ type: 'error', text: data.error || 'Failed to change password' });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Network error. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    if (!confirm('Are you sure you want to logout?')) {
      return;
    }

    try {
      const response = await fetch('/api/auth/logout', {
        method: 'POST',
        credentials: 'include'
      });

      const data = await response.json();

      if (data.success) {
        // Logout successful - redirect to login
        window.location.href = '/login.html';
      } else {
        alert('Logout failed: ' + (data.error || 'Unknown error'));
      }
    } catch (error) {
      console.error('Logout failed:', error);
      alert('Logout failed. Please try again.');
    }
  };

  return (
    <div className="user-management-container">
      <style>{`
        .user-management-container {
          max-width: 800px;
          margin: 0 auto;
          padding: 20px;
        }

        .user-management-container .section-card {
          background: white;
          border-radius: 8px;
          padding: 24px;
          margin-bottom: 20px;
          box-shadow: 0 2px 4px rgba(0,0,0,0.1);
        }

        .user-management-container .section-title {
          font-size: 18px;
          font-weight: 600;
          margin-bottom: 16px;
          color: #333;
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .user-management-container .section-description {
          color: #666;
          font-size: 14px;
          margin-bottom: 20px;
        }

        .user-management-container .form-group {
          margin-bottom: 16px;
        }

        .user-management-container .form-group label {
          display: block;
          margin-bottom: 6px;
          font-weight: 500;
          color: #444;
          font-size: 14px;
        }

        .user-management-container .form-group input {
          width: 100%;
          padding: 10px 12px;
          border: 1px solid #ddd;
          border-radius: 4px;
          font-size: 14px;
        }

        .user-management-container .form-group input:focus {
          outline: none;
          border-color: #4CAF50;
        }

        .user-management-container .message {
          padding: 12px;
          border-radius: 4px;
          margin-bottom: 16px;
          font-size: 14px;
        }

        .user-management-container .message.success {
          background: #d4edda;
          color: #155724;
          border: 1px solid #c3e6cb;
        }

        .user-management-container .message.error {
          background: #f8d7da;
          color: #721c24;
          border: 1px solid #f5c6cb;
        }

        .user-management-container .user-mgmt-btn {
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

        .user-management-container .user-mgmt-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }

        .user-management-container .user-mgmt-btn.primary {
          background: #4CAF50;
          color: white;
        }

        .user-management-container .user-mgmt-btn.primary:hover:not(:disabled) {
          background: #45a049;
        }

        .user-management-container .user-mgmt-btn.danger {
          background: #dc3545;
          color: white;
        }

        .user-management-container .user-mgmt-btn.danger:hover:not(:disabled) {
          background: #c82333;
        }

        .user-management-container .password-requirements {
          background: #f8f9fa;
          padding: 12px;
          border-radius: 4px;
          margin-top: 8px;
          font-size: 13px;
          color: #666;
        }

        .user-management-container .password-requirements ul {
          margin: 8px 0 0 0;
          padding-left: 20px;
        }

        .user-management-container .password-requirements li {
          margin-bottom: 4px;
        }

        .user-management-container .logout-section {
          border-top: 1px solid #e0e0e0;
          padding-top: 20px;
          margin-top: 20px;
        }
      `}</style>

      {/* User Account Info Section */}
      <div className="section-card">
        <h2 className="section-title">
          <i className="fas fa-user"></i>
          Account Information
        </h2>
        <p className="section-description">
          Your current account details
        </p>

        {userInfo ? (
          <div style={{
            background: '#f8f9fa',
            padding: '16px',
            borderRadius: '6px',
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            gap: '12px 16px',
            fontSize: '14px'
          }}>
            <strong>Username:</strong>
            <span>{userInfo.username}</span>

            <strong>Full Name:</strong>
            <span>{userInfo.fullName || 'Not set'}</span>

            <strong>Role:</strong>
            <span style={{
              display: 'inline-block',
              padding: '4px 8px',
              background: userInfo.role === 'admin' ? '#4CAF50' : '#2196F3',
              color: 'white',
              borderRadius: '4px',
              fontSize: '12px',
              fontWeight: '600',
              textTransform: 'capitalize'
            }}>
              {userInfo.role}
            </span>
          </div>
        ) : (
          <div style={{ color: '#666', fontSize: '14px' }}>Loading user information...</div>
        )}
      </div>

      {/* Change Password Section */}
      <div className="section-card">
        <h2 className="section-title">
          <i className="fas fa-key"></i>
          Change Password
        </h2>
        <p className="section-description">
          Update your account password. Make sure to use a strong password for security.
        </p>

        {message.text && (
          <div className={`message ${message.type}`}>
            {message.text}
          </div>
        )}

        <form onSubmit={handleChangePassword}>
          <div className="form-group">
            <label htmlFor="currentPassword">Current Password</label>
            <input
              type="password"
              id="currentPassword"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              disabled={loading}
              autoComplete="current-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="newPassword">New Password</label>
            <input
              type="password"
              id="newPassword"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div className="form-group">
            <label htmlFor="confirmPassword">Confirm New Password</label>
            <input
              type="password"
              id="confirmPassword"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              disabled={loading}
              autoComplete="new-password"
            />
          </div>

          <div className="password-requirements">
            <strong>Password Requirements:</strong>
            <ul>
              <li>Minimum 6 characters</li>
              <li>Use a unique password not used elsewhere</li>
            </ul>
          </div>

          <button
            type="submit"
            className="user-mgmt-btn primary"
            disabled={loading}
          >
            {loading ? 'Changing Password...' : 'Change Password'}
          </button>
        </form>

        {/* Logout Section */}
        <div className="logout-section">
          <h3 className="section-title" style={{ fontSize: '16px' }}>
            <i className="fas fa-sign-out-alt"></i>
            Session Management
          </h3>
          <p className="section-description">
            Sign out of your account on this device.
          </p>
          <button
            onClick={handleLogout}
            className="user-mgmt-btn danger"
          >
            <i className="fas fa-sign-out-alt"></i>
            <span>Logout</span>
          </button>
        </div>
      </div>
    </div>
  );
}
