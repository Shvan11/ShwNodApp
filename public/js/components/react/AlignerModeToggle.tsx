// AlignerModeToggle.tsx - Reusable mode toggle buttons for aligner section
import React from 'react';
import { useNavigate } from 'react-router-dom';

interface AlignerModeToggleProps {
    activeMode: 'doctors' | 'all-sets' | 'search' | 'archform-match';
    styles: Record<string, string>;
}

/**
 * NOT a tablist: each button navigates to a different route, so the right
 * semantics are a nav with `aria-current="page"` on the one you are on — a
 * `role="tab"`/`aria-selected` pair would promise an in-page panel that does not
 * exist. `type="button"` because a bare <button> defaults to submit.
 */
const AlignerModeToggle: React.FC<AlignerModeToggleProps> = ({ activeMode, styles }) => {
    const navigate = useNavigate();

    return (
        <nav className={styles.modeToggle} aria-label="Aligner views">
            <button
                type="button"
                aria-current={activeMode === 'doctors' ? 'page' : undefined}
                className={`${styles.modeBtn} ${activeMode === 'doctors' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner')}
            >
                <i className="fas fa-user-md"></i>
                Browse by Doctor
            </button>
            <button
                type="button"
                aria-current={activeMode === 'all-sets' ? 'page' : undefined}
                className={`${styles.modeBtn} ${activeMode === 'all-sets' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner/all-sets')}
            >
                <i className="fas fa-list"></i>
                All Sets Overview
            </button>
            <button
                type="button"
                aria-current={activeMode === 'search' ? 'page' : undefined}
                className={`${styles.modeBtn} ${activeMode === 'search' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner/search')}
            >
                <i className="fas fa-search"></i>
                Quick Search
            </button>
            <button
                type="button"
                aria-current={activeMode === 'archform-match' ? 'page' : undefined}
                className={`${styles.modeBtn} ${activeMode === 'archform-match' ? styles.active || 'active' : ''}`}
                onClick={() => navigate('/aligner/archform-match')}
            >
                <i className="fas fa-link"></i>
                Archform Match
            </button>
        </nav>
    );
};

export default AlignerModeToggle;
