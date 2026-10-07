import React, { useEffect, useId, useState, ChangeEvent, type Ref } from 'react';
import cn from 'classnames';
import type { PatientLookupMatch } from '@shared/contracts/patient.contract';
import { usePatientLookup } from '@/hooks/usePatientLookup';
import { formatPhoneForDisplay } from '../../utils/phoneFormatter';
import styles from './PatientSearchCombobox.module.css';

/** One suggestion: a row of GET /api/patients/lookup, as the contract parses it. */
export type PatientOption = PatientLookupMatch;

interface ComboboxMatch {
    /** Stable across answers: the highlight follows the row, not its position. */
    key: string;
    patient: PatientOption;
    primary: string;
    secondary?: string;
    group?: 'ID' | 'Phone';
}

export interface PatientSearchComboboxProps {
    /** Controlled input value — the same text drives the parent's table search */
    value: string;
    onChange: (value: string) => void;
    /** A suggestion was picked (click, or ArrowDown/Up + Enter). */
    onPick: (patient: PatientOption) => void;
    /** Enter pressed with no suggestion highlighted — run the table search */
    onSubmit?: () => void;
    /** What the text is matched against. `auto`: a leading digit means phone/ID, anything else a name. */
    mode: 'name' | 'phoneId' | 'auto';
    /** Mirrors PatientManagement's "Match from beginning of name only" checkbox.
     *  Defaults to false (substring), which is both the checkbox's own default
     *  and what the server does when `nameStartsWith` is absent — the jump list
     *  used to ignore the flag and always match a prefix. */
    nameStartsWith?: boolean;
    /** A patient never to offer (the Transfer dialog's own). */
    exclude?: number;
    rtl?: boolean;
    placeholder?: string;
    /** id forwarded to the inner input so a sibling <label htmlFor> can associate with it */
    id?: string;
    /** The dropdown's footer line. Defaults to the patient-list wording (pick = open, Enter = search). */
    hint?: string;
    /** Headers of the phone/ID mode's two groups (defaults: 'ID' / 'Phone'). */
    groupLabels?: { ID: string; Phone: string };
    /** Shown in place of the list when the suggestions could not be loaded. */
    errorText?: string;
    /** The inner input, e.g. for a dialog's `initialFocusRef`. */
    inputRef?: Ref<HTMLInputElement>;
}

// The server sends the rows already matched, ranked and capped (name from 2
// chars, ID from 1, phone from 2 — shared/patient-lookup.ts). This only words them.
function toComboboxMatch(p: PatientOption): ComboboxMatch {
    if (p.group === 'id') {
        return { key: `ID-${p.id}`, patient: p, primary: p.id.toString(), secondary: p.name, group: 'ID' };
    }
    if (p.group === 'phone') {
        return { key: `Phone-${p.id}`, patient: p, primary: formatPhoneForDisplay(p.phone), secondary: p.name, group: 'Phone' };
    }
    return { key: `-${p.id}`, patient: p, primary: p.name, secondary: `#${p.id}` };
}

/**
 * PatientSearchCombobox
 *
 * A text input with a "jump list" dropdown of the server's best matches
 * (`usePatientLookup`). Typing serves two paths at once: the dropdown offers
 * click/Enter navigation straight to a patient (the old quick-search
 * convenience), while the raw text flows up via onChange to drive the
 * persistent results table (the advanced-search path).
 *
 * Keyboard contract: plain Enter = onSubmit (table search); ArrowDown/Up +
 * Enter or click = onPick (open patient); Escape dismisses the dropdown.
 *
 * The list arrives a moment after the text, so two things hold that a list
 * filtered in the browser got for free. It only ever shows rows that match the
 * text as it is NOW (the hook drops the others while an answer is on its way).
 * And the highlight is kept by ROW, not by position: an answer that reorders the
 * list under a highlighted row moves the highlight with it, and one that removes
 * the row clears it — so Enter opens the patient that was highlighted, or runs
 * the search, never whoever slid into that position.
 *
 * It asks nothing while the list is closed: text restored into the box, or put
 * there by a pick, is not a question.
 *
 * The <li role="option"> elements are deliberately NOT focusable. This is the
 * `aria-activedescendant` pattern — focus stays on the input and the highlighted
 * option is named by id — so a `tabIndex={0}` on each option would be wrong even
 * if it worked, and it could not work: the input's onBlur closes the list before
 * Tab could land on one, which made the Enter/Space handler they used to carry
 * unreachable.
 */
const PatientSearchCombobox: React.FC<PatientSearchComboboxProps> = ({
    value,
    onChange,
    onPick,
    onSubmit,
    mode,
    nameStartsWith = false,
    exclude,
    rtl = false,
    placeholder,
    id,
    hint = 'Pick a suggestion to open the patient · Enter to search the list',
    groupLabels,
    errorText = 'Suggestions could not be loaded',
    inputRef,
}) => {
    const [open, setOpen] = useState(false);
    const [activeKey, setActiveKey] = useState<string | null>(null);
    const listboxId = useId();

    const lookup = usePatientLookup(value, { by: mode, nameStartsWith, exclude, enabled: open });
    const matches = lookup.matches.map(toComboboxMatch);
    const isOpen = open && matches.length > 0;
    const highlight = activeKey === null ? -1 : matches.findIndex((m) => m.key === activeKey);
    const showError = open && lookup.isError && matches.length === 0;

    useEffect(() => {
        if (highlight >= 0) {
            document.getElementById(`${listboxId}-opt-${highlight}`)?.scrollIntoView({ block: 'nearest' });
        }
    }, [highlight, listboxId]);

    const close = () => { setOpen(false); setActiveKey(null); };
    const pick = (m: ComboboxMatch) => { close(); onPick(m.patient); };

    const handleInput = (e: ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value);
        setOpen(true);
        setActiveKey(null);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
        switch (e.key) {
            case 'ArrowDown':
                // Reopens a dismissed list too; its rows arrive with the answer.
                setOpen(true);
                if (matches.length === 0) return;
                e.preventDefault();
                setActiveKey(matches[isOpen ? (highlight + 1) % matches.length : 0]?.key ?? null);
                break;
            case 'ArrowUp':
                setOpen(true);
                if (matches.length === 0) return;
                e.preventDefault();
                setActiveKey(matches[isOpen && highlight > 0 ? highlight - 1 : matches.length - 1]?.key ?? null);
                break;
            case 'Enter': {
                const picked = isOpen && highlight >= 0 ? matches[highlight] : undefined;
                if (picked) {
                    e.preventDefault();
                    pick(picked);
                } else {
                    setOpen(false);
                    onSubmit?.();
                }
                break;
            }
            case 'Escape':
                if (isOpen || showError) {
                    e.preventDefault();
                    e.stopPropagation();
                    close();
                }
                break;
        }
    };

    return (
        <div className={styles.combobox}>
            <input
                id={id}
                ref={inputRef}
                type="text"
                role="combobox"
                aria-expanded={isOpen}
                aria-controls={listboxId}
                aria-autocomplete="list"
                aria-activedescendant={isOpen && highlight >= 0 ? `${listboxId}-opt-${highlight}` : undefined}
                aria-busy={lookup.isSearching}
                className={cn('form-control', rtl && 'text-rtl')}
                dir={rtl ? 'rtl' : undefined}
                value={value}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                onBlur={close}
                placeholder={placeholder}
                autoComplete="off"
            />
            {isOpen && (
                <ul id={listboxId} role="listbox" className={cn(styles.dropdown, rtl && styles.dropdownRtl)}>
                    {matches.map((m, i) => (
                        <React.Fragment key={m.key}>
                            {m.group && m.group !== matches[i - 1]?.group && (
                                <li className={styles.groupHeader} role="presentation">{groupLabels?.[m.group] ?? m.group}</li>
                            )}
                            {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events -- aria-activedescendant combobox: the listbox is driven from the input's own onKeyDown (ArrowUp/Down + Enter) and options are deliberately not focusable, so a per-option key handler would be unreachable */}
                            <li
                                id={`${listboxId}-opt-${i}`}
                                role="option"
                                aria-selected={i === highlight}
                                className={cn(styles.option, i === highlight && styles.optionActive)}
                                onMouseDown={(e) => e.preventDefault()}
                                onClick={() => pick(m)}
                                onMouseEnter={() => setActiveKey(m.key)}
                            >
                                <span className={styles.optionPrimary}>{m.primary}</span>
                                {m.secondary && <span className={styles.optionSecondary}>{m.secondary}</span>}
                            </li>
                        </React.Fragment>
                    ))}
                    <li className={styles.hint} role="presentation">
                        {hint}
                    </li>
                </ul>
            )}
            {showError && (
                <div className={cn(styles.dropdown, styles.status)} role="status">
                    {errorText}
                </div>
            )}
        </div>
    );
};

export default PatientSearchCombobox;
