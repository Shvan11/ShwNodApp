/**
 * "All sessions" popover for the photo-session strip: every session of the patient
 * as one vertical list, so a long treatment history can be jumped through without
 * scrolling the strip. Only offered while the strip overflows (GridComponent).
 *
 * Same mechanics as the tab kebab's TimepointActionsMenu — portaled to <body> and
 * fixed-positioned so it escapes the strip's overflow clip; viewport clamping,
 * arrows/Home/End, Escape, outside-click and focus return come from the shared
 * `useFloatingMenu`. On open, focus lands on the CURRENT session (the hook starts
 * at the first item), which also scrolls it into view inside the list.
 */
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useFloatingMenu } from '@/hooks/useFloatingMenu';
import styles from './SessionListMenu.module.css';

export interface SessionListItem {
    code: string;
    description: string;
    date: string;
}

interface Props {
    x: number;
    y: number;
    sessions: SessionListItem[];
    currentCode: string;
    onSelect: (code: string) => void;
    onClose: () => void;
}

const SESSION_LIST_WIDTH = 260;

const SessionListMenu = ({ x, y, sessions, currentCode, onSelect, onClose }: Props) => {
    const ref = useRef<HTMLDivElement>(null);
    const { position, onKeyDown } = useFloatingMenu(ref, { x, y }, onClose);

    // Runs after the hook's own focus-in (effects run in declaration order).
    useEffect(() => {
        ref.current?.querySelector<HTMLElement>('[aria-current="true"]')?.focus();
    }, []);

    return createPortal(
        <div
            ref={ref}
            className={styles.menu}
            role="menu"
            tabIndex={-1}
            aria-label="All photo sessions"
            style={{ left: position.x, top: position.y, width: SESSION_LIST_WIDTH }}
            onKeyDown={onKeyDown}
        >
            <div className={styles.list}>
                {sessions.map((s) => {
                    const current = s.code === currentCode;
                    return (
                        <button
                            key={s.code}
                            type="button"
                            role="menuitem"
                            className={`${styles.item} ${current ? styles.current : ''}`}
                            aria-current={current ? 'true' : undefined}
                            onClick={() => onSelect(s.code)}
                        >
                            <i className={`fas fa-check ${styles.check}`} aria-hidden="true"></i>
                            <span className={styles.desc}>{s.description}</span>
                            <span className={styles.date}>{s.date}</span>
                        </button>
                    );
                })}
            </div>
            <div className={styles.footer}>
                <kbd>←</kbd> <kbd>→</kbd> step between sessions
            </div>
        </div>,
        document.body
    );
};

export default SessionListMenu;
