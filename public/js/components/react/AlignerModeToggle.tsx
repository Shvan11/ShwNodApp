// AlignerModeToggle.tsx - Reusable mode toggle buttons for aligner section
import React from 'react';
import { useNavigate } from 'react-router-dom';

interface AlignerModeToggleProps {
    activeMode: 'doctors' | 'all-sets' | 'search';
    styles: Record<string, string>;
}

const AlignerModeToggle: React.FC<AlignerModeToggleProps> = ({ activeMode, styles }) => {
    const navigate = useNavigate();

    return (
        <div className={styles.modeToggle}>
            <button
                className={`${styles.modeBtn} ${activeMode === 'doctors' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner')}
            >
                <i className="fas fa-user-md"></i>
                Browse by Doctor
            </button>
            <button
                className={`${styles.modeBtn} ${activeMode === 'all-sets' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner/all-sets')}
            >
                <i className="fas fa-list"></i>
                All Sets Overview
            </button>
            <button
                className={`${styles.modeBtn} ${activeMode === 'search' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner/search')}
            >
                <i className="fas fa-search"></i>
                Quick Search
            </button>
        </div>
    );
};

export default AlignerModeToggle;
