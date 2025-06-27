// PatientApp.js - Main application component
const PatientApp = () => {
    const [patientCode, setPatientCode] = React.useState('');
    const [patientData, setPatientData] = React.useState(null);
    const [images, setImages] = React.useState({ img1: null, img2: null });
    const [loading, setLoading] = React.useState(true);
    const [showWhatsAppModal, setShowWhatsAppModal] = React.useState(false);
    
    // Get patient code from URL
    React.useEffect(() => {
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
        return React.createElement('div', {
            className: 'loading-container',
            style: {
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                height: '100vh',
                fontSize: '18px'
            }
        }, 'Loading...');
    }

    return React.createElement('div', {
        className: 'patient-app',
        style: { height: '100vh', display: 'flex', flexDirection: 'column' }
    }, [
        // Header
        React.createElement(window.PatientHeader, {
            key: 'header',
            patientData: patientData,
            patientCode: patientCode
        }),

        // Main Content
        React.createElement('main', {
            key: 'main',
            style: { flex: 1, padding: '20px' }
        }, [
            // Image Upload Section
            React.createElement(window.ImageUploadSection, {
                key: 'upload',
                images: images,
                onImageUpload: handleImageUpload
            }),

            // Comparison Viewer
            React.createElement(window.ComparisonViewer, {
                key: 'viewer',
                patientCode: patientCode,
                patientName: patientData?.name,
                images: images,
                showWhatsAppModal: showWhatsAppModal,
                setShowWhatsAppModal: setShowWhatsAppModal
            })
        ])
    ]);
};

window.PatientApp = PatientApp;