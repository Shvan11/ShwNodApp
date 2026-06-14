import { useTranslation } from 'react-i18next';
import { useTheme } from '../../contexts/ThemeContext';
import type { ResolvedTheme } from '../../core/theme';
import styles from './ThemeToggle.module.css';

/**
 * ThemeToggle — sliding pill switch in the universal header. A 2-state
 * Light ⇄ Dark switch driven by the CURRENT resolved theme, so the knob shows
 * the right side even when the saved preference is 'auto' (follow-system).
 * Clicking commits to an explicit light|dark; the 'auto'/system default lives
 * in Settings → General.
 *
 * Sun (left) and moon (right) sit fixed in a translucent track; a white knob
 * slides to the active side, lifting that icon onto it (tinted) while the other
 * stays dim in the track. Exposed as role="switch" + aria-checked (checked =
 * dark); keyboard Enter/Space work because it's a real <button>.
 */
const ThemeToggle = () => {
    const { t } = useTranslation('common');
    const { resolvedTheme, setPreference } = useTheme();
    const isDark = resolvedTheme === 'dark';
    const nextTheme: ResolvedTheme = isDark ? 'light' : 'dark';

    return (
        <button
            type="button"
            role="switch"
            aria-checked={isDark}
            className={styles.toggle}
            onClick={() => setPreference(nextTheme)}
            aria-label={t('theme.toggleAria', {
                current: t(`theme.${resolvedTheme}`),
                next: t(`theme.${nextTheme}`),
            })}
            title={t('theme.switchToTitle', { mode: t(`theme.${nextTheme}`) })}
        >
            <i className={`fas fa-sun ${styles.icon} ${styles.sun}`} aria-hidden="true" />
            <i className={`fas fa-moon ${styles.icon} ${styles.moon}`} aria-hidden="true" />
            <span className={styles.knob} aria-hidden="true" />
        </button>
    );
};

export default ThemeToggle;
