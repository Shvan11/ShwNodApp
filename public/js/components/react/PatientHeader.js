// PatientHeader.js - Header component for patient information
const PatientHeader = ({ patientData, patientCode }) => {
    return React.createElement('header', {
        className: 'patient-header',
        style: {
            backgroundColor: '#007bff',
            color: 'white',
            padding: '15px 20px',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            boxShadow: '0 2px 4px rgba(0,0,0,0.1)'
        }
    }, [
        React.createElement('div', {
            key: 'info',
            style: { display: 'flex', alignItems: 'center', gap: '20px' }
        }, [
            React.createElement('h1', {
                key: 'title',
                style: { margin: 0, fontSize: '24px', fontWeight: '500' }
            }, `Patient: ${patientData?.name || patientCode}`),
            
            patientData?.phone && React.createElement('span', {
                key: 'phone',
                style: { 
                    fontSize: '16px', 
                    opacity: 0.9,
                    display: 'flex',
                    alignItems: 'center',
                    gap: '5px'
                }
            }, [
                React.createElement('i', { key: 'icon', className: 'fas fa-phone' }),
                patientData.phone
            ])
        ]),

        React.createElement('div', {
            key: 'actions',
            style: { display: 'flex', gap: '10px' }
        }, [
            React.createElement('button', {
                key: 'back',
                onClick: () => window.history.back(),
                style: {
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
                },
                onMouseOver: (e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.3)',
                onMouseOut: (e) => e.target.style.backgroundColor = 'rgba(255,255,255,0.2)'
            }, [
                React.createElement('i', { key: 'icon', className: 'fas fa-arrow-left' }),
                'Back'
            ])
        ])
    ]);
};

window.PatientHeader = PatientHeader;