/**
 * ComparisonViewer - Main React component for comparison viewer
 * 
 * Advanced image comparison viewer with control integration
 */

import React, { useState, useEffect, useRef } from 'react'
import CanvasControlButtons from './CanvasControlButtons.jsx'
import WhatsAppModal from './WhatsAppModal.jsx'

const ComparisonViewer = ({ patientCode, patientName, initialImages = [] }) => {
    const [showWhatsAppModal, setShowWhatsAppModal] = useState(false);
    const [comparison, setComparison] = useState(null);
    const containerRef = useRef(null);

    // Initialize comparison component when container is ready
    useEffect(() => {
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

    return (
        <div className="comparison-viewer-container">
            {/* Main comparison container */}
            <div
                ref={containerRef}
                className="comparison-container"
                id="comparison-container"
            />

            {/* Control buttons overlay */}
            <CanvasControlButtons
                comparison={comparison}
                showWhatsAppModal={showWhatsAppModal}
                setShowWhatsAppModal={setShowWhatsAppModal}
            />

            {/* WhatsApp Modal */}
            <WhatsAppModal
                show={showWhatsAppModal}
                onClose={() => setShowWhatsAppModal(false)}
                patientCode={patientCode}
                patientName={patientName}
            />
        </div>
    );
};

export default ComparisonViewer;