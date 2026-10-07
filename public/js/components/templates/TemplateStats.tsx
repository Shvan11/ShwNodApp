/**
 * Template Statistics Component
 * Displays template statistics overview
 */

interface TemplateStatsData {
    total: number;
    active: number;
    system: number;
    usedToday: number;
}

interface StatsStyles {
    readonly [key: string]: string;
}

interface TemplateStatsProps {
    stats: TemplateStatsData;
    styles: StatsStyles;
}

function TemplateStats({ stats, styles }: TemplateStatsProps) {
    return (
        <div className={styles.statsGrid}>
            <div className={styles.statCard}>
                <div className={styles.statIcon}>
                    <i className="fas fa-file-alt" aria-hidden="true"></i>
                </div>
                <div className={styles.statContent}>
                    <h3>{stats.total}</h3>
                    <p>Total Templates</p>
                </div>
            </div>
            <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconActive}`}>
                    <i className="fas fa-check-circle" aria-hidden="true"></i>
                </div>
                <div className={styles.statContent}>
                    <h3>{stats.active}</h3>
                    <p>Active Templates</p>
                </div>
            </div>
            <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconSystem}`}>
                    <i className="fas fa-shield-alt" aria-hidden="true"></i>
                </div>
                <div className={styles.statContent}>
                    <h3>{stats.system}</h3>
                    <p>System Templates</p>
                </div>
            </div>
            <div className={styles.statCard}>
                <div className={`${styles.statIcon} ${styles.statIconUsage}`}>
                    <i className="fas fa-clock" aria-hidden="true"></i>
                </div>
                <div className={styles.statContent}>
                    <h3>{stats.usedToday}</h3>
                    <p>Used Today</p>
                </div>
            </div>
        </div>
    );
}

export default TemplateStats;
export type { TemplateStatsData, TemplateStatsProps };
