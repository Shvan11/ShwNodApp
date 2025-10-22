// PortalDashboard.jsx - Dashboard view with cases list
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import PortalHeader from '../../components/react/portal/PortalHeader.jsx';

const PortalDashboard = () => {
    const navigate = useNavigate();
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [doctor, setDoctor] = useState(null);
    const [cases, setCases] = useState([]);
    const [searchQuery, setSearchQuery] = useState('');

    // Get email from URL query parameter
    const getEmailParam = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get('email');
    };

    // Build URL with email parameter
    const buildUrl = (path) => {
        const email = getEmailParam();
        if (email) {
            const separator = path.includes('?') ? '&' : '?';
            return `${path}${separator}email=${encodeURIComponent(email)}`;
        }
        return path;
    };

    // Load doctor info on mount
    useEffect(() => {
        loadDoctorAuth();
    }, []);

    // Load doctor authentication
    const loadDoctorAuth = async () => {
        try {
            const response = await fetch(buildUrl('/api/portal/auth'));

            if (!response.ok) {
                try {
                    const data = await response.json();
                    setError(data.error || 'Authentication failed. Please check your access.');
                } catch (parseError) {
                    console.error('Failed to parse error response:', parseError);
                    setError('Authentication failed. Please check your access.');
                }
                return;
            }

            const data = await response.json();

            if (data.success) {
                setDoctor(data.doctor);
                await loadCases();
            } else {
                setError(data.error || 'Authentication failed. Please check your access.');
            }
        } catch (error) {
            console.error('Error loading doctor auth:', error);
            setError('Failed to authenticate. Please try again.');
        } finally {
            setLoading(false);
        }
    };

    // Load all cases for this doctor
    const loadCases = async () => {
        try {
            const response = await fetch(buildUrl('/api/portal/cases'));
            const data = await response.json();

            if (data.success) {
                setCases(data.cases || []);
            } else {
                throw new Error(data.error || 'Failed to load cases');
            }
        } catch (error) {
            console.error('Error loading cases:', error);
            setError('Failed to load cases');
        }
    };

    // Navigate to case detail
    const selectCase = (caseData) => {
        navigate(`/portal/patient/${caseData.workid}${window.location.search}`);
    };

    // Format patient name
    const formatPatientName = (caseData) => {
        return caseData.PatientName || `${caseData.FirstName} ${caseData.LastName}`;
    };

    // Filter cases by search query
    const getFilteredCases = () => {
        if (!searchQuery.trim()) {
            return cases;
        }

        const query = searchQuery.toLowerCase();
        return cases.filter(c => {
            const patientName = formatPatientName(c).toLowerCase();
            const patientID = (c.patientID || '').toLowerCase();
            const phone = (c.Phone || '').toLowerCase();

            return patientName.includes(query) ||
                   patientID.includes(query) ||
                   phone.includes(query);
        });
    };

    // Get active and total cases count
    const getActiveCasesCount = () => cases.filter(c => c.ActiveSets > 0).length;

    // Format date
    const formatDate = (dateString) => {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'short',
            day: 'numeric'
        });
    };

    // Render loading state
    if (loading) {
        return (
            <div className="portal-container">
                <div className="loading-container">
                    <div className="spinner"></div>
                    <p>Loading portal...</p>
                </div>
            </div>
        );
    }

    // Render error state
    if (error) {
        return (
            <div className="portal-container">
                <PortalHeader doctor={null} showError={true} errorMessage={error} />
            </div>
        );
    }

    return (
        <div className="portal-container">
            <PortalHeader doctor={doctor} />

            <main className="portal-main">
                <div className="dashboard-header">
                    <h2 className="dashboard-title">My Cases</h2>
                </div>

                {/* Stats */}
                <div className="dashboard-stats">
                    <div className="stat-card">
                        <div className="stat-value">{cases.length}</div>
                        <div className="stat-label">Total Cases</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value" style={{ color: 'var(--portal-success)' }}>
                            {getActiveCasesCount()}
                        </div>
                        <div className="stat-label">Active Cases</div>
                    </div>
                    <div className="stat-card">
                        <div className="stat-value" style={{ color: 'var(--portal-grey)' }}>
                            {cases.length - getActiveCasesCount()}
                        </div>
                        <div className="stat-label">Completed</div>
                    </div>
                </div>

                {/* Search */}
                <div className="search-container">
                    <i className="fas fa-search search-icon"></i>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search by patient name, ID, or phone..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                    />
                </div>

                {/* Cases Grid */}
                {getFilteredCases().length === 0 ? (
                    <div className="empty-state">
                        <i className="fas fa-inbox"></i>
                        <h3>No cases found</h3>
                        <p>
                            {searchQuery ? 'Try a different search term' : 'No aligner cases assigned yet'}
                        </p>
                    </div>
                ) : (
                    <div className="cases-grid">
                        {getFilteredCases().map((caseData) => (
                            <div
                                key={caseData.workid}
                                className="case-card"
                                onClick={() => selectCase(caseData)}
                            >
                                <div className="case-header">
                                    <div className="case-patient-info">
                                        <h3>{formatPatientName(caseData)}</h3>
                                        <div className="case-patient-id">#{caseData.patientID}</div>
                                    </div>
                                    {caseData.ActiveSets > 0 ? (
                                        <span className="case-active-badge">Active</span>
                                    ) : (
                                        <span className="case-inactive-badge">Completed</span>
                                    )}
                                </div>

                                {/* Active Set Info */}
                                {caseData.ActiveSets > 0 ? (
                                    <div className="case-active-set-info">
                                        <div className="active-set-header">
                                            <i className="fas fa-layer-group"></i>
                                            <strong>Active Set Info</strong>
                                        </div>
                                        <div className="active-set-details">
                                            <span><i className="fas fa-hashtag"></i> Set #{caseData.ActiveSetSequence || '?'}</span>
                                            <span><i className="fas fa-teeth"></i> {caseData.ActiveUpperCount || 0}U / {caseData.ActiveLowerCount || 0}L</span>
                                            <span><i className="fas fa-box-open"></i> Remaining: {caseData.ActiveRemainingUpper || 0}U / {caseData.ActiveRemainingLower || 0}L</span>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="case-no-active-set">
                                        <i className="fas fa-check-circle"></i> No active sets
                                    </div>
                                )}

                                {/* Payment Summary */}
                                <div className="case-payment-summary">
                                    <div className="case-payment-item">
                                        <div className="case-payment-label">Total Required</div>
                                        <div className="case-payment-value">{caseData.SetCost || 0} {caseData.Currency || 'USD'}</div>
                                    </div>
                                    <div className="case-payment-divider"></div>
                                    <div className="case-payment-item">
                                        <div className="case-payment-label">Total Paid</div>
                                        <div className="case-payment-value paid">{caseData.TotalPaid || 0} {caseData.Currency || 'USD'}</div>
                                    </div>
                                    <div className="case-payment-divider"></div>
                                    <div className="case-payment-item">
                                        <div className="case-payment-label">Balance</div>
                                        <div className="case-payment-value balance">{caseData.Balance !== null && caseData.Balance !== undefined ? caseData.Balance : (caseData.SetCost || 0)} {caseData.Currency || 'USD'}</div>
                                    </div>
                                </div>

                                {/* URLs for Active Set */}
                                {(caseData.SetUrl || caseData.SetPdfUrl) && (
                                    <div className="case-urls">
                                        {caseData.SetUrl && (
                                            <a
                                                href={caseData.SetUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="case-url-btn"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <i className="fas fa-link"></i>
                                                Setup URL
                                            </a>
                                        )}
                                        {caseData.SetPdfUrl && (
                                            <a
                                                href={caseData.SetPdfUrl}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="case-url-btn pdf"
                                                onClick={(e) => e.stopPropagation()}
                                            >
                                                <i className="fas fa-file-pdf"></i>
                                                View PDF
                                            </a>
                                        )}
                                    </div>
                                )}

                                <div className="case-stats">
                                    <div className="case-stat">
                                        <div className="case-stat-value">{caseData.TotalSets}</div>
                                        <div className="case-stat-label">Sets</div>
                                    </div>
                                    <div className="case-stat">
                                        <div className="case-stat-value" style={{ color: 'var(--portal-success)' }}>
                                            {caseData.ActiveSets}
                                        </div>
                                        <div className="case-stat-label">Active</div>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </main>
        </div>
    );
};

export default PortalDashboard;
