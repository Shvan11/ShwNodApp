import { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import { postJSON, httpErrorMessage } from '@/core/http';
import styles from './UserMenu.module.css';

interface UserMenuProps {
    user: { username: string; fullName?: string; role: string };
}

const MENU_WIDTH = 220;

/**
 * UserMenu — the account control in the universal header. The user pill (name +
 * role, reusing the global `.user-info` styles) is a button that opens a small
 * popover with Change password + Log out. Mirrors TasksBell's mechanics: the
 * popover is portaled to <body> (the fixed, overflow:hidden universal-header
 * would otherwise clip an in-flow dropdown) and anchored to the trigger via
 * viewport-fixed coords, with outside-click + Escape to close.
 */
const UserMenu = ({ user }: UserMenuProps) => {
    const navigate = useNavigate();
    const { t } = useTranslation('common');
    const toast = useToast();
    const confirm = useConfirm();
    const queryClient = useQueryClient();

    const [open, setOpen] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);

    const wrapRef = useRef<HTMLDivElement | null>(null);
    const btnRef = useRef<HTMLButtonElement | null>(null);
    const popRef = useRef<HTMLDivElement | null>(null);

    const placeMenu = useCallback(() => {
        const r = btnRef.current?.getBoundingClientRect();
        if (!r) return;
        const left = Math.min(Math.max(8, r.right - MENU_WIDTH), window.innerWidth - MENU_WIDTH - 8);
        setCoords({ top: r.bottom + 8, left: Math.max(8, left) });
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

    const goChangePassword = () => {
        setOpen(false);
        navigate('/settings/security');
    };

    const handleLogout = async () => {
        setOpen(false);
        if (!await confirm(t('user.logoutConfirm'), { title: t('user.logoutTitle') })) return;
        try {
            await postJSON('/api/auth/logout', {});
            // Drop cached query data so the next user in this tab can't see it.
            queryClient.clear();
            // Security logout: sanctioned full-reload exception to React Router nav.
            window.location.href = '/login.html';
        } catch (err) {
            toast.error(httpErrorMessage(err, t('user.logoutFailed')));
        }
    };

    const displayName = user.fullName || user.username;
    const menuLabel = t('user.menuAria', { name: displayName });

    return (
        <div className={styles.wrap} ref={wrapRef}>
            <button
                type="button"
                ref={btnRef}
                className={`user-info ${styles.trigger}`}
                onClick={toggleOpen}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-label={menuLabel}
            >
                <i className="fas fa-user-circle" aria-hidden="true" />
                <div className="user-details">
                    <span className="user-name">{displayName}</span>
                    <span className="user-role">{user.role}</span>
                </div>
                <i
                    className={`fas fa-chevron-down ${styles.caret} ${open ? styles.caretOpen : ''}`}
                    aria-hidden="true"
                />
            </button>

            {open && coords && createPortal(
                <div
                    className={styles.menu}
                    role="menu"
                    aria-label={menuLabel}
                    ref={popRef}
                    style={{ position: 'fixed', top: coords.top, left: coords.left }}
                >
                    <div className={styles.identity}>
                        <span className={styles.identityName}>{displayName}</span>
                        <span className={styles.identityRole}>{user.role}</span>
                    </div>
                    <div className={styles.divider} />
                    <button type="button" role="menuitem" className={styles.item} onClick={goChangePassword}>
                        <i className="fas fa-key" aria-hidden="true" />
                        <span>{t('user.changePassword')}</span>
                    </button>
                    <button
                        type="button"
                        role="menuitem"
                        className={`${styles.item} ${styles.danger}`}
                        onClick={handleLogout}
                    >
                        <i className="fas fa-sign-out-alt" aria-hidden="true" />
                        <span>{t('user.logout')}</span>
                    </button>
                </div>,
                document.body
            )}
        </div>
    );
};

export default UserMenu;
