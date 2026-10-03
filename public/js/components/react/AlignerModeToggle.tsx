// AlignerModeToggle.tsx - Reusable mode toggle buttons for aligner section
import React from 'react';
import { useNavigate } from 'react-router-dom';
import cn from 'classnames';
import styles from './AlignerModeToggle.module.css';

export type AlignerMode = 'doctors' | 'all-sets' | 'search' | 'archform-match';

interface AlignerModeToggleProps {
    activeMode: AlignerMode;
    /** Pin under the universal header while the page scrolls (off in a viewport-locked shell). */
    sticky: boolean;
}

const MODES: ReadonlyArray<{ mode: AlignerMode; to: string; icon: string; label: string }> = [
    { mode: 'doctors', to: '/aligner', icon: 'fa-user-md', label: 'Browse by Doctor' },
    { mode: 'all-sets', to: '/aligner/all-sets', icon: 'fa-list', label: 'All Sets Overview' },
    { mode: 'search', to: '/aligner/search', icon: 'fa-search', label: 'Quick Search' },
    { mode: 'archform-match', to: '/aligner/archform-match', icon: 'fa-link', label: 'Archform Match' },
];

/**
 * NOT a tablist: each button navigates to a different route, so the right
 * semantics are a nav with `aria-current="page"` on the one you are on — a
 * `role="tab"`/`aria-selected` pair would promise an in-page panel that does not
 * exist. `type="button"` because a bare <button> defaults to submit.
 *
 * Owns its stylesheet. It used to take the LAYOUT's CSS-module object as a
 * `styles` prop (with a global `'active'` fallback), a prop-drilled sheet no
 * dead-class scan could follow (audit FE-F4-14).
 */
const AlignerModeToggle: React.FC<AlignerModeToggleProps> = ({ activeMode, sticky }) => {
    const navigate = useNavigate();

    return (
        <nav className={cn(styles.modeToggle, sticky && styles.sticky)} aria-label="Aligner views">
            {MODES.map(({ mode, to, icon, label }) => (
                <button
                    key={mode}
                    type="button"
                    aria-current={activeMode === mode ? 'page' : undefined}
                    className={cn(styles.modeBtn, activeMode === mode && styles.active)}
                    onClick={() => navigate(to)}
                >
                    <i className={`fas ${icon}`} aria-hidden="true"></i>
                    {label}
                </button>
            ))}
        </nav>
    );
};

export default AlignerModeToggle;
