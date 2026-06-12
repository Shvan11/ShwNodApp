/**
 * Step 1 / Step 2 rail card: pick exactly two timepoints, then a photo type
 * present in BOTH. The earlier timepoint is badged "Before", the later
 * "After" (the canvas always draws them in chronological order).
 */

import React, { ChangeEvent } from 'react';
import cn from 'classnames';
import type { PhotoType, Timepoint } from './types';
import { PHOTO_CATEGORIES, PHOTO_TYPES } from './types';
import styles from './SelectionPanel.module.css';

interface Props {
    timepoints: Timepoint[];
    selectedTimepoints: number[];
    onToggleTimepoint: (tpCode: number, checked: boolean) => void;
    selectedPhotoType: string;
    onSelectPhotoType: (id: string) => void;
    isPhotoTypeAvailable: (code: string) => boolean;
}

const SelectionPanel = ({
    timepoints,
    selectedTimepoints,
    onToggleTimepoint,
    selectedPhotoType,
    onSelectPhotoType,
    isPhotoTypeAvailable,
}: Props) => {
    const pairChosen = selectedTimepoints.length === 2;
    const sortedSelection = [...selectedTimepoints].sort((a, b) => a - b);

    const orderBadge = (tpCode: number): 'Before' | 'After' | null => {
        if (!selectedTimepoints.includes(tpCode)) return null;
        if (selectedTimepoints.length === 1) return 'Before';
        return tpCode === sortedSelection[0] ? 'Before' : 'After';
    };

    const renderChip = (photoType: PhotoType) => {
        const available = pairChosen && isPhotoTypeAvailable(photoType.code);
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
                                        {new Date(tp.tp_date_time).toLocaleDateString()}
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
