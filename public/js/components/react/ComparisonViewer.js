// ComparisonViewer.js - Main React component for comparison viewer
const ComparisonViewer = ({ patientCode, patientName, initialImages = [] }) => {
    const [showWhatsAppModal, setShowWhatsAppModal] = React.useState(false);
    const [comparison, setComparison] = React.useState(null);
    const containerRef = React.useRef(null);

    // Initialize comparison component when container is ready
    React.useEffect(() => {
        if (containerRef.current && !comparison) {
            // Wait for the ComparisonComponent to be available
            if (window.ComparisonComponent) {
                const comp = new window.ComparisonComponent(containerRef.current);
                setComparison(comp);
                
                // Load initial images if provided
                if (initialImages.length > 0) {
                    initialImages.forEach((img, index) => {
                        comp.loadImage(img.src, img.type || (index === 0 ? 'before' : 'after'));
                    });
                }
            }
        }
    }, [containerRef.current, initialImages]);

    return React.createElement('div', {
        className: 'comparison-viewer-container',
        style: {
            position: 'relative',
            width: '100%',
            height: '100%',
            minHeight: '500px'
        }
    }, [
        // Main comparison container
        React.createElement('div', {
            key: 'comparison-container',
            ref: containerRef,
            className: 'comparison-container',
            id: 'comparison-container',
            style: {
                width: '100%',
                height: '100%',
                position: 'relative',
                backgroundColor: '#f8f9fa',
                border: '1px solid #dee2e6',
                borderRadius: '4px'
            }
        }),

        // Control buttons overlay
        React.createElement(window.CanvasControlButtons, {
            key: 'controls',
            comparison: comparison,
            showWhatsAppModal: showWhatsAppModal,
            setShowWhatsAppModal: setShowWhatsAppModal
        }),

        // WhatsApp Modal
        React.createElement(window.WhatsAppModal, {
            key: 'whatsapp-modal',
            show: showWhatsAppModal,
            onClose: () => setShowWhatsAppModal(false),
            patientCode: patientCode,
            patientName: patientName
        })
    ]);
};

// Export for use in other components
window.ComparisonViewer = ComparisonViewer;