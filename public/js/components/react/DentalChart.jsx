/**
 * DentalChart - Simple dental chart with Palmer notation
 * Click tooth or between-teeth area to insert text
 */

const DentalChart = ({ onToothClick }) => {
    const renderTooth = (prefix, number, isLower) => (
        <div
            key={`${prefix}${number}`}
            className="dental-tooth"
            onClick={() => onToothClick(`${prefix}${number}`)}
        >
            {isLower && <span className="dental-tooth-number">{number}</span>}
            <img
                src={`/images/teeth/chart/${prefix.toUpperCase()}${number}.svg`}
                alt={`${prefix}${number}`}
                onError={(e) => { e.target.style.display = 'none'; }}
            />
            {!isLower && <span className="dental-tooth-number">{number}</span>}
        </div>
    );

    const renderBetween = (tooth1, tooth2, isMidline) => (
        <div
            key={`between-${tooth1}-${tooth2}`}
            className={`dental-between${isMidline ? ' midline' : ''}`}
            onClick={() => onToothClick(`Between ${tooth1} and ${tooth2}`)}
        >
            <div className="dental-between-indicator" />
        </div>
    );

    const renderArch = (rightPrefix, leftPrefix, label, isLower) => {
        const elements = [];

        for (let i = 8; i >= 1; i--) {
            elements.push(renderTooth(rightPrefix, i, isLower));
            if (i > 1) elements.push(renderBetween(`${rightPrefix}${i-1}`, `${rightPrefix}${i}`));
        }

        elements.push(renderBetween(`${rightPrefix}1`, `${leftPrefix}1`, true));

        for (let i = 1; i <= 8; i++) {
            elements.push(renderTooth(leftPrefix, i, isLower));
            if (i < 8) elements.push(renderBetween(`${leftPrefix}${i}`, `${leftPrefix}${i+1}`));
        }

        return (
            <div className="dental-arch">
                <div className="dental-arch-label">{label}</div>
                <div className="dental-arch-teeth">{elements}</div>
            </div>
        );
    };

    return (
        <div className="dental-chart-container">
            {renderArch('UR', 'UL', 'Upper Teeth', false)}
            {renderArch('LR', 'LL', 'Lower Teeth', true)}
        </div>
    );
};

export default DentalChart;
