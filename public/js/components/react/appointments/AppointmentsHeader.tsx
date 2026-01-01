import type { ChangeEvent } from 'react';
import ConnectionStatus, { type ConnectionStatusType } from './ConnectionStatus';

interface AppointmentsHeaderProps {
    selectedDate: string;
    onDateChange: (date: string) => void;
    onRefresh: () => void;
    isRefreshing: boolean;
    searchTerm: string;
    onSearchChange: (term: string) => void;
    connectionStatus: ConnectionStatusType;
    showFlash: boolean;
}

/**
 * AppointmentsHeader Component
 * Header with title, date picker, refresh button, search box, and connection status
 */
const AppointmentsHeader = ({
    selectedDate,
    onDateChange,
    onRefresh,
    isRefreshing,
    searchTerm,
    onSearchChange,
    connectionStatus,
    showFlash
}: AppointmentsHeaderProps) => {
    // Format date for display
    const formatDateForDisplay = (dateString: string): string => {
        if (!dateString) return 'Today';

        const date = new Date(dateString + 'T12:00:00'); // Add time to avoid timezone issues
        return date.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        });
    };

    const handleDateInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
        onDateChange(e.target.value);
    };

    const handleSearchInputChange = (e: ChangeEvent<HTMLInputElement>): void => {
        onSearchChange(e.target.value);
    };

    return (
        <div className="header-section">
            <h1 id="title">Appointments for {formatDateForDisplay(selectedDate)}</h1>
            <div className="header-controls">
                <div className="date-picker-container">
                    <div className="date-picker-left">
                        <label htmlFor="date-picker">Select Date:</label>
                        <input
                            type="date"
                            id="date-picker"
                            value={selectedDate}
                            onChange={handleDateInputChange}
                        />
                        <button
                            className="btn-refresh"
                            onClick={onRefresh}
                            disabled={isRefreshing}
                            title="Refresh today's appointments"
                        >
                            <i className={`fas fa-sync-alt ${isRefreshing ? 'spinning' : ''}`}></i>
                        </button>
                    </div>
                </div>
                <div className="search-input-wrapper">
                    <i className="fas fa-search search-icon"></i>
                    <input
                        type="text"
                        className="search-input"
                        placeholder="Search patient..."
                        value={searchTerm}
                        onChange={handleSearchInputChange}
                    />
                    {searchTerm && (
                        <button
                            className="search-clear"
                            onClick={() => onSearchChange('')}
                            title="Clear search"
                        >
                            <i className="fas fa-times"></i>
                        </button>
                    )}
                </div>
            </div>
            <ConnectionStatus status={connectionStatus} showFlash={showFlash} />
        </div>
    );
};

export type { AppointmentsHeaderProps };
export default AppointmentsHeader;
