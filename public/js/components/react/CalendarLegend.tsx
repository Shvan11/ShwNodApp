/**
 * CalendarLegend — colour key for the week/day grid.
 *
 * Renders one chip per appointment-eligible doctor (tblEmployees.getAppointments
 * = 1). Doctors with no assigned colour — e.g. the generic "Clinic" bucket —
 * show a neutral swatch, mirroring how their cards render in the grid.
 */

import type { LegendDoctor } from './calendar.types';

interface CalendarLegendProps {
    doctors: LegendDoctor[];
}

const CalendarLegend = ({ doctors }: CalendarLegendProps) => {
    if (!doctors.length) return null;

    return (
        <div className="cal-legend" role="group" aria-label="Doctor colour key">
            <span className="cal-legend-title">Doctors</span>
            <ul className="cal-legend-items">
                {doctors.map(doc => (
                    <li key={doc.id} className="cal-legend-item">
                        <span
                            className={`cal-legend-swatch${doc.color ? '' : ' neutral'}`}
                            style={
                                doc.color
                                    ? { background: doc.color.fill, borderColor: doc.color.edge }
                                    : undefined
                            }
                            aria-hidden="true"
                        />
                        <span className="cal-legend-name">{doc.name}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export default CalendarLegend;
