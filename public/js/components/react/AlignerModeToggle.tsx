// AlignerModeToggle.tsx - Reusable mode toggle buttons for aligner section
import React from 'react';
import { useNavigate } from 'react-router-dom';

interface AlignerModeToggleProps {
    activeMode: 'doctors' | 'all-sets' | 'search';
}

const AlignerModeToggle: React.FC<AlignerModeToggleProps> = ({ activeMode }) => {
    const navigate = useNavigate();

    return (
        <div className="mode-toggle">
            <button
                className={`mode-btn ${activeMode === 'doctors' ? 'active' : ''}`}
                onClick={() => navigate('/aligner')}
            >
                <i className="fas fa-user-md"></i>
                Browse by Doctor
            </button>
            <button
                className={`mode-btn ${activeMode === 'all-sets' ? 'active' : ''}`}
                onClick={() => navigate('/aligner/all-sets')}
            >
                <i className="fas fa-list"></i>
                All Sets Overview
            </button>
            <button
                className={`mode-btn ${activeMode === 'search' ? 'active' : ''}`}
                onClick={() => navigate('/aligner/search')}
            >
                <i className="fas fa-search"></i>
                Quick Search
            </button>
        </div>
    );
};

export default AlignerModeToggle;
