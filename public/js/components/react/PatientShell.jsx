import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import Navigation from './Navigation.jsx';
import ContentRenderer from './ContentRenderer.jsx';

const PatientShell = () => {
    // React Router hooks
    const { patientId, page } = useParams();
    const [searchParams] = useSearchParams();

    const [patientData, setPatientData] = useState({ name: '', loading: true, error: null });

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

    // Fetch patient data when patient ID changes
    useEffect(() => {
        if (patientId) {
            fetchPatientData(patientId);
        }
    }, [patientId, fetchPatientData]);

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
                {/* Breadcrumb */}
                <div className="breadcrumb-container">
                    <nav className="breadcrumb">
                        <span className="breadcrumb-item">
                            <i className="fas fa-user"></i>
                            {' '}
                            {patientData.loading ? `Patient ${patientId}` : patientData.name}
                        </span>
                        {page && page !== 'grid' && (
                            <>
                                <span className="breadcrumb-separator">/</span>
                                <span className="breadcrumb-item active">
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
