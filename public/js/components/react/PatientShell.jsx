import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams, Link } from 'react-router-dom';
import Navigation from './Navigation.jsx';
import ContentRenderer from './ContentRenderer.jsx';

const PatientShell = () => {
    // React Router hooks
    const { patientId, page } = useParams();
    const [searchParams] = useSearchParams();

    const [patientData, setPatientData] = useState({ name: '', loading: true, error: null });
    const [workData, setWorkData] = useState({ typeName: '', loading: false, error: null });

    // Fetch patient data when patient ID changes
    const fetchPatientData = useCallback(async (id) => {
        if (!id) {
            setPatientData({ name: '', loading: false, error: 'No patient ID provided' });
            return;
        }

        try {
            setPatientData(prev => ({ ...prev, loading: true, error: null }));
            const response = await fetch(`/api/getinfos?code=${id}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch patient data: ${response.status}`);
            }

            const data = await response.json();
            const patientName = data.name || `Patient ${id}`;

            setPatientData({ name: patientName, loading: false, error: null });
        } catch (error) {
            console.error('Error fetching patient data:', error);
            setPatientData({
                name: `Patient ${id}`,
                loading: false,
                error: error.message
            });
        }
    }, []);

    // Fetch work data when workId is in query params
    const fetchWorkData = useCallback(async (workId) => {
        if (!workId) {
            setWorkData({ typeName: '', loading: false, error: null });
            return;
        }

        try {
            setWorkData(prev => ({ ...prev, loading: true, error: null }));
            const response = await fetch(`/api/getworkdetails?workId=${workId}`);

            if (!response.ok) {
                throw new Error(`Failed to fetch work data: ${response.status}`);
            }

            const data = await response.json();
            const workTypeName = data.TypeName || `Work ${workId}`;

            setWorkData({ typeName: workTypeName, workId: parseInt(workId), loading: false, error: null });
        } catch (error) {
            console.error('Error fetching work data:', error);
            setWorkData({
                typeName: `Work ${workId}`,
                workId: parseInt(workId),
                loading: false,
                error: error.message
            });
        }
    }, []);

    // Fetch patient data when patient ID changes
    useEffect(() => {
        if (patientId) {
            fetchPatientData(patientId);
        }
    }, [patientId, fetchPatientData]);

    // Fetch work data when workId query param changes
    const workId = searchParams.get('workId');
    useEffect(() => {
        fetchWorkData(workId);
    }, [workId, fetchWorkData]);

    // Extract additional params from URL
    const params = {
        tp: searchParams.get('tp'),
        view: searchParams.get('view'),
        filter: searchParams.get('filter'),
    };

    return (
        <div id="patient-shell" className="patient-shell-container">
            {/* Navigation Sidebar - Always Visible */}
            <div className="navigation-sidebar">
                <Navigation
                    patientId={patientId}
                    currentPage={page}
                />
            </div>

            {/* Main Content Area */}
            <div className="main-content-area">
                {/* Enhanced Breadcrumb */}
                <div className="breadcrumb-container">
                    <nav className="breadcrumb">
                        {/* Home Link - Use regular anchor for external navigation */}
                        <a href="/patient-management" className="breadcrumb-item breadcrumb-link">
                            <i className="fas fa-home"></i> Home
                        </a>

                        <span className="breadcrumb-separator">/</span>

                        {/* Patient Link */}
                        <Link to={`/patient/${patientId}/works`} className="breadcrumb-item breadcrumb-link">
                            <i className="fas fa-user"></i>
                            {' '}
                            {patientData.loading ? `Patient ${patientId}` : patientData.name}
                        </Link>

                        {/* Work Level (if workId is present) */}
                        {workId && workData.typeName && (
                            <>
                                <span className="breadcrumb-separator">/</span>
                                <Link to={`/patient/${patientId}/works`} className="breadcrumb-item breadcrumb-link">
                                    <i className="fas fa-briefcase-medical"></i> {workData.typeName}
                                </Link>
                            </>
                        )}

                        {/* Current Page */}
                        {page && page !== 'grid' && page !== 'works' && (
                            <>
                                <span className="breadcrumb-separator">/</span>
                                <span className="breadcrumb-item active">
                                    <i className={`fas fa-${page === 'visits' ? 'calendar-check' : page === 'appointments' ? 'calendar-alt' : page === 'xrays' ? 'x-ray' : 'file'}`}></i>
                                    {' '}
                                    {page.charAt(0).toUpperCase() + page.slice(1).replace(/-/g, ' ')}
                                </span>
                            </>
                        )}
                    </nav>
                </div>

                {/* Page Content */}
                <div className="page-content">
                    <ContentRenderer
                        patientId={patientId}
                        page={page}
                        params={params}
                    />
                </div>
            </div>
        </div>
    );
};

export default PatientShell;
