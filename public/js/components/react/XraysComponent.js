// XraysComponent.js - X-rays component for patient portal
const XraysComponent = ({ patientId }) => {
    const { useState, useEffect } = React;
    
    const [patientInfo, setPatientInfo] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    useEffect(() => {
        loadXrays();
    }, [patientId]);
    
    const loadXrays = async () => {
        try {
            setLoading(true);
            console.log('Loading X-rays for patient:', patientId);
            
            const response = await fetch(`/api/getinfos?code=${patientId}`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const patientData = await response.json();
            console.log('Patient info received:', patientData);
            setPatientInfo(patientData);
        } catch (err) {
            console.error('Error loading X-rays:', err);
            setError(err.message);
        } finally {
            setLoading(false);
        }
    };
    
    const handleXrayClick = (xray) => {
        const xrayUrl = `/api/getxray/?code=${patientId}&file=${xray.name}&detailsDir=${xray.detailsDirName}`;
        window.open(xrayUrl, '_blank');
    };
    
    const handleSendClick = (xray) => {
        const xrayUrl = `/api/getxray/?code=${patientId}&file=${xray.name}&detailsDir=${xray.detailsDirName}`;
        const sendMessageUrl = `/views/messaging/send-message.html?file=${encodeURIComponent(xrayUrl)}`;
        window.open(sendMessageUrl, '_blank');
    };
    
    if (loading) {
        return React.createElement('div', { 
            className: 'loading-spinner' 
        }, 'Loading X-rays...');
    }
    
    if (error) {
        return React.createElement('div', { 
            className: 'error-message' 
        }, `Error: ${error}`);
    }
    
    const xrays = patientInfo?.xrays?.filter(xray => xray.name !== 'PatientInfo.xml') || [];
    
    if (xrays.length === 0) {
        return React.createElement('div', {
            style: { padding: '20px', textAlign: 'center' }
        }, 'No X-ray records found for this patient.');
    }
    
    console.log('🎯 X-rays Component Rendering:', { patientId, xraysCount: xrays.length });
    
    return React.createElement('div', { 
        style: { padding: '20px' }
    }, [
        React.createElement('div', { 
            key: 'container',
            className: 'xrays-container' 
        }, [
            React.createElement('h3', { key: 'title' }, 'X-Rays'),
            React.createElement('ul', { 
                key: 'list',
                className: 'xrays' 
            }, 
                xrays.map((xray, index) => 
                    React.createElement('li', { 
                        key: index,
                        className: 'x_item' 
                    }, [
                        React.createElement('a', {
                            key: 'link',
                            href: '#',
                            onClick: (e) => {
                                e.preventDefault();
                                handleXrayClick(xray);
                            }
                        }, [
                            xray.previewImagePartialPath 
                                ? React.createElement('div', {
                                    key: 'img-container',
                                    className: 'x_img_container'
                                }, 
                                    React.createElement('img', {
                                        src: `/assets/${patientId}${xray.previewImagePartialPath}`,
                                        className: 'x_img',
                                        alt: `X-ray ${xray.name}`
                                    })
                                )
                                : React.createElement('span', { key: 'text' }, 'Click to view X-ray')
                        ]),
                        React.createElement('p', { 
                            key: 'date' 
                        }, xray.date || xray.name),
                        React.createElement('button', {
                            key: 'send',
                            onClick: () => handleSendClick(xray)
                        }, 'Send')
                    ])
                )
            )
        ])
    ]);
};

window.XraysComponent = XraysComponent;