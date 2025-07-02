/**
 * PatientApp - Main patient application component
 * 
 * Orchestrates the patient interface with header, data loading, and comparison viewer
 */

import React, { useState, useEffect } from 'react'
import PatientHeader from './PatientHeader.jsx'
import ComparisonViewer from './ComparisonViewer.jsx'

const PatientApp = () => {
    const [patientCode, setPatientCode] = useState('');
    const [patientData, setPatientData] = useState(null);
    const [images, setImages] = useState({ img1: null, img2: null });
    const [loading, setLoading] = useState(true);
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    
    // Get patient code from URL
    useEffect(() => {
        const urlParams = new URLSearchParams(window.location.search);
        const code = urlParams.get('code') || 'default';
        setPatientCode(code);
        loadPatientData(code);
    }, []);

    const loadPatientData = async (code) => {
        try {
            const response = await fetch(`/api/getinfos?code=${code}`);
            if (response.ok) {
                const data = await response.json();
                setPatientData(data);
            }
        } catch (error) {
            console.error('Error loading patient data:', error);
        } finally {
            setLoading(false);
        }
    };

    const handleImageUpload = (file, type) => {
        if (file) {
            const reader = new FileReader();
            reader.onload = (e) => {
                setImages(prev => ({
                    ...prev,
                    [type]: e.target.result
                }));
            };
            reader.readAsDataURL(file);
        }
    };

    if (loading) {
        return (
            <div 
                className="loading-container"
                style={{
                    display: 'flex',
                    justifyContent: 'center',
                    alignItems: 'center',
                    height: '100vh',
                    fontSize: '18px'
                }}
            >
                Loading...
            </div>
        );
    }

    return (
        <div 
            className="patient-app"
            style={{ height: '100vh', display: 'flex', flexDirection: 'column' }}
        >
            {/* Header */}
            <PatientHeader
                patientData={patientData}
                patientCode={patientCode}
            />

            {/* Main Content */}
            <main style={{ flex: 1, padding: '20px' }}>
                {/* Image Upload Section */}
                {window.ImageUploadSection && (
                    <window.ImageUploadSection
                        images={images}
                        onImageUpload={handleImageUpload}
                    />
                )}

                {/* Comparison Viewer */}
                <ComparisonViewer
                    patientCode={patientCode}
                    patientName={patientData?.name}
                    images={images}
                    showWhatsAppModal={showWhatsAppModal}
                    setShowWhatsAppModal={setShowWhatsAppModal}
                />
            </main>
        </div>
    );
};

export default PatientApp;