import { useTranslation } from 'react-i18next';
import styles from './MobileViewToggle.module.css';

type ViewType = 'all' | 'checked-in';

interface MobileViewToggleProps {
    activeView: ViewType;
    onViewChange: (view: ViewType) => void;
    /** List sizes shown in the labels — the stats chips are hidden on mobile,
        so these counts are the phone's only at-a-glance numbers. */
    allCount: number;
    checkedInCount: number;
}

/**
 * MobileViewToggle Component
 * Toggle between "All Appointments" and "Checked-In" views on mobile
 */
const MobileViewToggle = ({ activeView, onViewChange, allCount, checkedInCount }: MobileViewToggleProps) => {
    const { t } = useTranslation('appointments');
    return (
        <div className={styles.container}>
            <button
                className={activeView === 'all' ? styles.buttonActive : styles.button}
                data-view="all"
                onClick={() => onViewChange('all')}
            >
                <i className="fas fa-calendar-alt"></i>
                <span>{t('mobile.all', { count: allCount })}</span>
            </button>
            <button
                className={activeView === 'checked-in' ? styles.buttonActive : styles.button}
                data-view="checked-in"
                onClick={() => onViewChange('checked-in')}
            >
                <i className="fas fa-user-check"></i>
                <span>{t('mobile.checkedIn', { count: checkedInCount })}</span>
            </button>
        </div>
    );
};

export type { ViewType, MobileViewToggleProps };
export default MobileViewToggle;
