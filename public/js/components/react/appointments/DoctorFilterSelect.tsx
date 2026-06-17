import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import type { DoctorFilter } from './AppointmentsHeader';
import type { LegendDoctor } from '../calendar.types';
import styles from './DoctorFilterSelect.module.css';

interface DoctorFilterSelectProps {
    doctors: LegendDoctor[];
    value: DoctorFilter;
    onChange: (value: DoctorFilter) => void;
}

/**
 * DoctorFilterSelect — the doctor filter in the appointments header.
 *
 * A native <select> can't render the per-doctor colour swatches the user wants,
 * so this reimplements the control as a button trigger + a portaled listbox.
 * Mirrors the UserMenu popover mechanics: the menu is portaled to <body> and
 * anchored to the trigger via viewport-fixed coords (so the sticky header's
 * overflow can't clip it), with outside-click + Escape to close. Each row shows
 * a colour swatch matching the calendar legend, so the colour alone reads as the
 * doctor's identity — the same colour that tints the per-card doctor icon.
 */
const DoctorFilterSelect = ({ doctors, value, onChange }: DoctorFilterSelectProps) => {
    const { t } = useTranslation('appointments');
    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);

    const wrapRef = useRef<HTMLDivElement | null>(null);
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);

    const placeMenu = useCallback(() => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const width = Math.max(r.width, 200);
        const left = Math.min(r.left, window.innerWidth - width - 8);
        setCoords({ top: r.bottom + 6, left: Math.max(8, left), width });
    }, []);

    // Close on outside click / Escape; keep anchored on resize.
    useEffect(() => {
        if (!open) return;
        const onDown = (e: MouseEvent) => {
            const node = e.target as Node;
            if (wrapRef.current?.contains(node) || popRef.current?.contains(node)) return;
            setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDown);
        document.addEventListener('keydown', onKey);
        window.addEventListener('resize', placeMenu);
        return () => {
            document.removeEventListener('mousedown', onDown);
            document.removeEventListener('keydown', onKey);
            window.removeEventListener('resize', placeMenu);
        };
    }, [open, placeMenu]);

    const toggleOpen = () => {
        if (!open) placeMenu();
        setOpen((o) => !o);
    };

    const selectValue = (v: DoctorFilter) => {
        onChange(v);
        setOpen(false);
    };

    const selectedDoctor = typeof value === 'number' ? doctors.find((d) => d.id === value) ?? null : null;

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <button
                type="button"
                ref={btnRef}
                className={styles.trigger}
                onClick={toggleOpen}
                aria-haspopup="listbox"
                aria-expanded={open}
                aria-label={t('filter.byDoctor')}
            >
                {selectedDoctor ? (
                    <span
                        className={selectedDoctor.color ? styles.swatch : `${styles.swatch} ${styles.neutral}`}
                        style={selectedDoctor.color
                            ? { background: selectedDoctor.color.fill, borderColor: selectedDoctor.color.edge }
                            : undefined}
                        aria-hidden="true"
                    />
                ) : (
                    <i className={`fas fa-user-md ${styles.triggerIcon}`} aria-hidden="true" />
                )}
                <span className={styles.triggerLabel}>{selectedDoctor ? selectedDoctor.name : t('filter.allDoctors')}</span>
                <i className={`fas fa-chevron-down ${styles.caret} ${open ? styles.caretOpen : ''}`} aria-hidden="true" />
            </button>

            {open && coords && createPortal(
                <div
                    className={styles.menu}
                    role="listbox"
                    aria-label={t('filter.byDoctor')}
                    ref={popRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left, width: coords.width }}
                >
                    <button
                        type="button"
                        role="option"
                        aria-selected={value === 'all'}
                        className={value === 'all' ? `${styles.option} ${styles.optionSelected}` : styles.option}
                        onClick={() => selectValue('all')}
                    >
                        <i className={`fas fa-user-md ${styles.allIcon}`} aria-hidden="true" />
                        <span className={styles.optionLabel}>{t('filter.allDoctors')}</span>
                        {value === 'all' && <i className={`fas fa-check ${styles.check}`} aria-hidden="true" />}
                    </button>

                    {doctors.map((doc) => (
                        <button
                            key={doc.id}
                            type="button"
                            role="option"
                            aria-selected={value === doc.id}
                            className={value === doc.id ? `${styles.option} ${styles.optionSelected}` : styles.option}
                            onClick={() => selectValue(doc.id)}
                        >
                            <span
                                className={doc.color ? styles.swatch : `${styles.swatch} ${styles.neutral}`}
                                style={doc.color
                                    ? { background: doc.color.fill, borderColor: doc.color.edge }
                                    : undefined}
                                aria-hidden="true"
                            />
                            <span className={styles.optionLabel}>{doc.name}</span>
                            {value === doc.id && <i className={`fas fa-check ${styles.check}`} aria-hidden="true" />}
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
};

export default DoctorFilterSelect;
