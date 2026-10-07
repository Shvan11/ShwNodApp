/**
 * The Name field of the New / Edit Photo Session dialogs: a select of the clinic's common
 * session names (`useTimepointNames`). Right-click it → "Edit values" manages the list in
 * place, the same list as Settings → Lookups → Photo Session Names.
 *
 * With `allowCustom` a last "Custom name…" option opens a text box. A session's name is
 * free text in the database and some carry one that is not on the list ("Progress_2",
 * "After_Laser"): such a name opens on Custom with its text intact, so re-dating that
 * session never renames it. Without `allowCustom` the caller keeps `value` on the list.
 */
import { useState } from 'react';
import { useLookupManager } from '@/hooks/useLookupManager';
import { useTimepointNames } from '@/hooks/useTimepointNames';
import { qk } from '@/query/keys';

/** The select's value for "Custom name…" — blank, which no listed name can be. */
const CUSTOM = '';

interface Props {
    id: string;
    value: string;
    onChange: (name: string) => void;
    /** Offer "Custom name…" and a text box for a name that is not on the list. */
    allowCustom?: boolean;
    disabled?: boolean;
    /** Styles the select and, in custom mode, the text box under it. */
    className?: string;
}

const TimepointNameSelect = ({ id, value, onChange, allowCustom = false, disabled, className }: Props) => {
    const names = useTimepointNames();
    // Sticky once chosen (or typed in): without it the box would vanish, and the select
    // snap to a listed name, the moment the text being typed happened to spell one.
    const [customChosen, setCustomChosen] = useState(false);
    const custom = allowCustom && (customChosen || !names.includes(value));

    const lookup = useLookupManager({
        tableKey: 'tblTimePointNames',
        invalidateKeys: [qk.lookups.timepointNames()],
    });

    const handleSelect = (next: string): void => {
        if (next === CUSTOM) {
            // Keep the current text: "Progress" → Custom → "Progress 2" is the common edit.
            setCustomChosen(true);
            return;
        }
        setCustomChosen(false);
        onChange(next);
    };

    return (
        <>
            <select
                id={id}
                className={className}
                value={custom ? CUSTOM : value}
                onChange={(e) => handleSelect(e.target.value)}
                onContextMenu={lookup.onContextMenu}
                title={lookup.canManage ? 'Right-click to edit this list' : undefined}
                disabled={disabled}
            >
                {names.map((name) => (
                    <option key={name} value={name}>{name}</option>
                ))}
                {allowCustom && <option value={CUSTOM}>Custom name…</option>}
            </select>
            {custom && (
                <input
                    type="text"
                    className={className}
                    value={value}
                    onChange={(e) => {
                        setCustomChosen(true);
                        onChange(e.target.value);
                    }}
                    aria-label="Custom name"
                    placeholder="Type a name"
                    disabled={disabled}
                    // eslint-disable-next-line jsx-a11y/no-autofocus -- the box "Custom name…" just opened
                    autoFocus={customChosen}
                />
            )}
            {lookup.overlay}
        </>
    );
};

export default TimepointNameSelect;
