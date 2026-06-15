import type { ReactNode } from 'react';
import styles from './ModalHeader.module.css';

export type ModalHeaderVariant = 'default' | 'danger' | 'warning' | 'success' | 'info';

interface ModalHeaderProps {
    /** Heading text (or node). Rendered as the dialog's title. */
    title: ReactNode;
    /** id applied to the title element — pass the same value as the Modal's `ariaLabelledBy`. */
    titleId?: string;
    /** Optional leading icon, e.g. `<i className="fas fa-credit-card" />`. */
    icon?: ReactNode;
    /** Optional secondary line under the title. */
    subtitle?: ReactNode;
    /** Optional right-aligned controls placed before the close button. */
    actions?: ReactNode;
    /** When provided, renders the standardized close button. */
    onClose?: () => void;
    /** Accessible label for the close button (default "Close"). */
    closeLabel?: string;
    /** Semantic tone — tints the header in both light and dark themes. */
    variant?: ModalHeaderVariant;
    /** Tighter padding + smaller title for dense modals. */
    dense?: boolean;
    /** Extra class on the header root (escape hatch for one-off tweaks). */
    className?: string;
    /**
     * Fully custom header body, replacing the title block. Use sparingly —
     * prefer title/icon/subtitle/actions so headers stay consistent.
     */
    children?: ReactNode;
}

const VARIANT_CLASS: Record<ModalHeaderVariant, string | undefined> = {
    default: undefined,
    danger: styles.danger,
    warning: styles.warning,
    success: styles.success,
    info: styles.info,
};

/**
 * Shared modal header — the single source of truth for modal title bars.
 * Standardizes layout, the close button, aria wiring, and (via
 * `data-modal-drag-handle`) serves as the drag grip for the shared Modal.
 */
const ModalHeader = ({
    title,
    titleId,
    icon,
    subtitle,
    actions,
    onClose,
    closeLabel = 'Close',
    variant = 'default',
    dense = false,
    className,
    children,
}: ModalHeaderProps) => {
    const classes = [styles.header, VARIANT_CLASS[variant], dense ? styles.dense : undefined, className]
        .filter(Boolean)
        .join(' ');

    return (
        <header className={classes} data-modal-drag-handle>
            {children ?? (
                <div className={styles.titleBlock}>
                    {icon != null && (
                        <span className={styles.icon} aria-hidden="true">
                            {icon}
                        </span>
                    )}
                    <div className={styles.titleText}>
                        <h2 id={titleId} className={styles.title}>
                            {title}
                        </h2>
                        {subtitle != null && <p className={styles.subtitle}>{subtitle}</p>}
                    </div>
                </div>
            )}

            {(actions != null || onClose) && (
                <div className={styles.actions}>
                    {actions}
                    {onClose && (
                        <button type="button" className={styles.closeBtn} onClick={onClose} aria-label={closeLabel}>
                            <i className="fas fa-times" aria-hidden="true" />
                        </button>
                    )}
                </div>
            )}
        </header>
    );
};

export default ModalHeader;
