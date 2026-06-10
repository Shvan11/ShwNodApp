import React, { useEffect, useId, useState, ChangeEvent } from 'react';
import cn from 'classnames';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import type { PatientOption } from './PatientQuickSearch';
import styles from './PatientSearchCombobox.module.css';

interface ComboboxMatch {
    id: number;
    primary: string;
    secondary?: string;
    group?: 'ID' | 'Phone';
}

export interface PatientSearchComboboxProps {
    /** Controlled input value — the same text drives the parent's table search */
    value: string;
    onChange: (value: string) => void;
    /** A suggestion was picked — go straight to the patient */
    onJump: (personId: number) => void;
    /** Enter pressed with no suggestion highlighted — run the table search */
    onSubmit?: () => void;
    /** Preloaded patient list (route loader) for instant suggestions */
    patients: PatientOption[];
    mode: 'name' | 'phoneId';
    rtl?: boolean;
    placeholder?: string;
}

const MAX_PER_GROUP = 4;
const MAX_MATCHES = 8;

// Same matching rules the old quick-search selects used: name startsWith from
// 2 chars, ID contains from 1 char, phone contains from 2 chars.
function findMatches(patients: PatientOption[], rawInput: string, mode: 'name' | 'phoneId'): ComboboxMatch[] {
    const input = rawInput.trim();
    if (mode === 'name') {
        if (input.length < 2) return [];
        const out: ComboboxMatch[] = [];
        for (const p of patients) {
            if (p.name?.startsWith(input)) {
                out.push({ id: p.id, primary: p.name, secondary: `#${p.id}` });
                if (out.length >= MAX_MATCHES) break;
            }
        }
        return out;
    }
    if (input.length < 1) return [];
    const ids: ComboboxMatch[] = [];
    const phones: ComboboxMatch[] = [];
    for (const p of patients) {
        if (ids.length < MAX_PER_GROUP && p.id.toString().includes(input)) {
            ids.push({ id: p.id, primary: p.id.toString(), secondary: p.name, group: 'ID' });
        }
        if (input.length >= 2 && phones.length < MAX_PER_GROUP && p.phone?.includes(input)) {
            phones.push({ id: p.id, primary: formatPhoneForDisplay(p.phone), secondary: p.name, group: 'Phone' });
        }
        if (ids.length >= MAX_PER_GROUP && phones.length >= MAX_PER_GROUP) break;
    }
    return [...ids, ...phones];
}

/**
 * PatientSearchCombobox
 *
 * A text input with an instant "jump list" dropdown. Typing serves two paths
 * at once: the dropdown offers click/Enter navigation straight to a patient
 * (the old quick-search convenience), while the raw text flows up via
 * onChange to drive the persistent results table (the advanced-search path).
 *
 * Keyboard contract: plain Enter = onSubmit (table search); ArrowDown/Up +
 * Enter or click = onJump (open patient); Escape dismisses the dropdown.
 */
const PatientSearchCombobox: React.FC<PatientSearchComboboxProps> = ({
    value,
    onChange,
    onJump,
    onSubmit,
    patients,
    mode,
    rtl = false,
    placeholder
}) => {
    const [open, setOpen] = useState(false);
    const [highlight, setHighlight] = useState(-1);
    const listboxId = useId();

    const matches = findMatches(patients, value, mode);
    const isOpen = open && matches.length > 0;

    useEffect(() => {
        if (highlight >= 0) {
            document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
        }
    }, [highlight, listboxId]);

    const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        setOpen(true);
        setHighlight(-1);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch (e.key) {
            case 'ArrowDown':
                if (matches.length === 0) return;
                e.preventDefault();
                setOpen(true);
                setHighlight(h => (isOpen ? (h + 1) % matches.length : 0));
                break;
            case 'ArrowUp':
                if (matches.length === 0) return;
                e.preventDefault();
                setOpen(true);
                setHighlight(h => (isOpen && h > 0 ? h - 1 : matches.length - 1));
                break;
            case 'Enter': {
                const picked = isOpen && highlight >= 0 ? matches[highlight] : undefined;
                if (picked) {
                    e.preventDefault();
                    setOpen(false);
                    onJump(picked.id);
                } else {
                    setOpen(false);
                    onSubmit?.();
                }
                break;
            }
            case 'Escape':
                if (isOpen) {
                    e.preventDefault();
                    e.stopPropagation();
                    setOpen(false);
                    setHighlight(-1);
                }
                break;
        }
    };

    return (
        <div className={styles.combobox}>
            <input
                type="text"
                role="combobox"
                aria-expanded={isOpen}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={isOpen && highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined}
                className={cn('form-control', rtl && 'text-rtl')}
                dir={rtl ? 'rtl' : undefined}
                value={value}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onBlur={() => { setOpen(false); setHighlight(-1); }}
                placeholder={placeholder}
                autoComplete="off"
            />
            {isOpen && (
                <ul id={listboxId} role="listbox" className={cn(styles.dropdown, rtl && styles.dropdownRtl)}>
                    {matches.map((m, i) => (
                        <React.Fragment key={`${m.group || ''}-${m.id}`}>
                            {m.group && m.group !== matches[i - 1]?.group && (
                                <li className={styles.groupHeader} role="presentation">{m.group}</li>
                            )}
                            <li
                                id={`${listboxId}-opt-${i}`}
                                role="option"
                                aria-selected={i === highlight}
                                className={cn(styles.option, i === highlight && styles.optionActive)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { setOpen(false); onJump(m.id); }}
                                onMouseEnter={() => setHighlight(i)}
                            >
                                <span className={styles.optionPrimary}>{m.primary}</span>
                                {m.secondary && <span className={styles.optionSecondary}>{m.secondary}</span>}
                            </li>
                        </React.Fragment>
                    ))}
                    <li className={styles.hint} role="presentation">
                        Pick a suggestion to open the patient · Enter to search the list
                    </li>
                </ul>
            )}
        </div>
    );
};

export default PatientSearchCombobox;
