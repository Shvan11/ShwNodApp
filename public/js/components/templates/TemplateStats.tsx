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

interface TemplateStatsProps {
    stats: TemplateStatsData;
}

function TemplateStats({ stats }: TemplateStatsProps) {
    return (
        <div className="stats-grid">
            <div className="stat-card">
                <div className="stat-icon">
                    <i className="fas fa-file-alt"></i>
                </div>
                <div className="stat-content">
                    <h3>{stats.total}</h3>
                    <p>Total Templates</p>
                </div>
            </div>
            <div className="stat-card">
                <div className="stat-icon active">
                    <i className="fas fa-check-circle"></i>
                </div>
                <div className="stat-content">
                    <h3>{stats.active}</h3>
                    <p>Active Templates</p>
                </div>
            </div>
            <div className="stat-card">
                <div className="stat-icon system">
                    <i className="fas fa-shield-alt"></i>
                </div>
                <div className="stat-content">
                    <h3>{stats.system}</h3>
                    <p>System Templates</p>
                </div>
            </div>
            <div className="stat-card">
                <div className="stat-icon usage">
                    <i className="fas fa-clock"></i>
                </div>
                <div className="stat-content">
                    <h3>{stats.usedToday}</h3>
                    <p>Used Today</p>
                </div>
            </div>
        </div>
    );
}

export default TemplateStats;
export type { TemplateStatsData, TemplateStatsProps };
