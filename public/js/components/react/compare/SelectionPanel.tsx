/**
 * Step 1 / Step 2 rail card: pick exactly two timepoints, then a photo type
 * present in BOTH. The earlier timepoint (by DATE) is badged "Before", the later
 * "After" — the canvas draws them in the same order.
 */

import type { ChangeEvent } from 'react';
import cn from 'classnames';
import type { TimepointRow } from '@shared/contracts/patient.contract';
import { parseLocalDate } from '@/utils/calendarDate';
import type { PhotoType } from './types';
import { PHOTO_CATEGORIES, PHOTO_TYPES } from './types';
import styles from './SelectionPanel.module.css';

interface Props {
    timepoints: TimepointRow[];
    /** The selected sessions in date order (Before, After). */
    pair: TimepointRow[];
    selectedTimepoints: string[];
    onToggleTimepoint: (tpCode: string, checked: boolean) => void;
    selectedPhotoType: string;
    onSelectPhotoType: (id: string) => void;
    isViewAvailable: (photoType: PhotoType) => boolean;
    /** The session list's read failed (shown with a Retry — FE-F13-15c). */
    loadError: string | null;
    onRetry: () => void;
}

const SelectionPanel = ({
    timepoints,
    pair,
    selectedTimepoints,
    onToggleTimepoint,
    selectedPhotoType,
    onSelectPhotoType,
    isViewAvailable,
    loadError,
    onRetry,
}: Props) => {
    const pairChosen = pair.length === 2;

    // By the sessions' DATE order (the list's), not their codes: a backdated or
    // re-dated session used to be badged the wrong way round (FE-F13-3).
    const orderBadge = (tpCode: string): 'Before' | 'After' | null => {
        if (!selectedTimepoints.includes(tpCode)) return null;
        if (pair.length < 2) return 'Before';
        return tpCode === pair[0].tp_code ? 'Before' : 'After';
    };

    const renderChip = (photoType: PhotoType) => {
        const available = isViewAvailable(photoType);
        const selected = selectedPhotoType === photoType.id;
        return (
            <label
                key={photoType.id}
                title={available || !pairChosen
                    ? photoType.label
                    : `${photoType.label} — not available in both timepoints`}
                className={cn(
                    styles.chip,
                    selected && styles.chipSelected,
                    !available && styles.chipDisabled,
                )}
            >
                <input
                    type="radio"
                    name="photoType"
                    value={photoType.id}
                    checked={selected}
                    disabled={!available}
                    onChange={(e: ChangeEvent<HTMLInputElement>) => onSelectPhotoType(e.target.value)}
                    className={styles.chipInput}
                />
                {photoType.short}
            </label>
        );
    };

    return (
        <div className={styles.card}>
            <div className={styles.step}>
                <h4 className={styles.stepHeader}>
                    <span className={cn(styles.stepNumber, pairChosen && styles.stepNumberComplete)}>1</span>
                    Select 2 timepoints
                </h4>
                {loadError && (
                    <div className={styles.loadError} role="alert">
                        <span>{loadError}</span>
                        <button type="button" className={styles.retryButton} onClick={onRetry}>
                            Retry
                        </button>
                    </div>
                )}
                <div className={styles.timepointList}>
                    {timepoints.map(tp => {
                        const badge = orderBadge(tp.tp_code);
                        return (
                            <label
                                key={tp.tp_code}
                                className={cn(
                                    styles.timepointRow,
                                    selectedTimepoints.includes(tp.tp_code) && styles.timepointRowSelected,
                                )}
                            >
                                <input
                                    type="checkbox"
                                    checked={selectedTimepoints.includes(tp.tp_code)}
                                    onChange={(e: ChangeEvent<HTMLInputElement>) => onToggleTimepoint(tp.tp_code, e.target.checked)}
                                    className={styles.timepointInput}
                                />
                                <span className={styles.timepointText}>
                                    <span className={styles.timepointName}>{tp.tp_description}</span>
                                    <span className={styles.timepointDate}>
                                        {/* A local parse: `new Date('YYYY-MM-DD')` is UTC midnight,
                                            a day early west of UTC (FE-F13-11). */}
                                        {parseLocalDate(tp.tp_date_time).toLocaleDateString('en-GB', {
                                            day: 'numeric',
                                            month: 'short',
                                            year: 'numeric',
                                        })}
                                    </span>
                                </span>
                                {badge && (
                                    <span className={cn(styles.orderBadge, badge === 'After' && styles.orderBadgeAfter)}>
                                        {badge}
                                    </span>
                                )}
                            </label>
                        );
                    })}
                </div>
            </div>

            <div className={cn(styles.step, !pairChosen && styles.stepDisabled)}>
                <h4 className={styles.stepHeader}>
                    <span className={cn(styles.stepNumber, pairChosen && Boolean(selectedPhotoType) && styles.stepNumberComplete)}>2</span>
                    Select photo type
                </h4>
                {!pairChosen && (
                    <p className={styles.stepHint}>Select 2 timepoints first — types missing in either one are disabled.</p>
                )}
                <div>
                    {PHOTO_CATEGORIES.map(category => (
                        <div key={category} className={styles.categoryBlock}>
                            <h5 className={styles.categoryTitle}>{category}</h5>
                            <div className={styles.chipGrid}>
                                {PHOTO_TYPES.filter(pt => pt.category === category).map(renderChip)}
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default SelectionPanel;
