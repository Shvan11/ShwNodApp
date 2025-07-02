/**
 * PatientHeader - Header component for patient information
 * 
 * Displays patient information and navigation controls
 */

import React from 'react'

const PatientHeader = ({ patientData, patientCode }) => {
    return (
        <header 
            className="patient-header"
            style={{
                backgroundColor: '#007bff',
                color: 'white',
                padding: '15px 20px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                <h1 style={{ margin: 0, fontSize: '24px', fontWeight: '500' }}>
                    Patient: {patientData?.name || patientCode}
                </h1>
                
                {patientData?.phone && (
                    <span style={{ 
                        fontSize: '16px', 
                        opacity: 0.9,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                    }}>
                        <i className="fas fa-phone" />
                        {patientData.phone}
                    </span>
                )}
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
                <button
                    onClick={() => window.history.back()}
                    style={{
                        backgroundColor: 'rgba(255,255,255,0.2)',
                        color: 'white',
                        border: '1px solid rgba(255,255,255,0.3)',
                        padding: '8px 16px',
                        borderRadius: '4px',
                        cursor: 'pointer',
                        fontSize: '14px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '5px'
                    }}
                    onMouseOver={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.3)'}
                    onMouseOut={(e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'}
                >
                    <i className="fas fa-arrow-left" />
                    Back
                </button>
            </div>
        </header>
    );
};

export default PatientHeader;