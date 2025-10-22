// PortalHeader.jsx - Shared header for portal pages
import React from 'react';

const PortalHeader = ({ doctor, showError = false, errorMessage = '' }) => {
    const handleLogout = () => {
        // Redirect to Cloudflare Access logout endpoint
        window.location.href = '/cdn-cgi/access/logout';
    };

    if (showError) {
        return (
            <div className="error-container">
                <i className="fas fa-exclamation-triangle"></i>
                <h2>Authentication Error</h2>
                <p>{errorMessage}</p>
                <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: '#666' }}>
                    Please contact your administrator to ensure your email is authorized for portal access.
                </p>
                <button className="logout-btn" onClick={handleLogout} style={{ marginTop: '1.5rem' }}>
                    <i className="fas fa-sign-out-alt"></i>
                    Logout
                </button>
            </div>
        );
    }

    return (
        <header className="portal-header">
            <div className="portal-header-content">
                <div className="portal-branding">
                    <i className="fas fa-tooth portal-logo"></i>
                    <div className="portal-title">
                        <h1>Shwan Aligner Portal</h1>
                        <div className="portal-subtitle">Doctor Access</div>
                    </div>
                </div>
                <div className="portal-doctor-info">
                    <span className="doctor-name">
                        <i className="fas fa-user-md"></i> Dr. {doctor?.DoctorName}
                    </span>
                    <button className="logout-btn" onClick={handleLogout}>
                        <i className="fas fa-sign-out-alt"></i>
                        Logout
                    </button>
                </div>
            </div>
        </header>
    );
};

export default PortalHeader;
