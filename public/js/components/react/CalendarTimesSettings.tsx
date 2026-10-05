import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { postJSON, putJSON, deleteJSON, httpErrorMessage } from '@/core/http';
import { adminLookupItemsQuery, optionQuery } from '@/query/queries';
import { qk } from '@/query/keys';
import * as calendarContract from '@shared/contracts/calendar.contract';
import styles from './CalendarTimesSettings.module.css';
import sectionStyles from './SettingsSection.module.css';

interface CalendarTimesSettingsProps {
    onChangesUpdate?: (hasChanges: boolean) => void;
}

interface TimeSlot {
    time_id: number;
    my_time: string;
}

type SlotCategory = 'early' | 'main' | 'late';

interface CategorizedSlots {
    early: string[];
    main: string[];
    late: string[];
}

// Helper to parse time from database format (1970-01-01T14:00:00 or HH:MM)
const parseTimeToHHMM = (timeStr: string): string => {
    if (timeStr.includes('T')) {
        // Format: 1970-01-01T14:00:00
        const timePart = timeStr.split('T')[1];
        return timePart.substring(0, 5); // Get HH:MM
    }
    // Already in HH:MM format
    return timeStr.substring(0, 5);
};

// Helper to sort times
const sortTimes = (times: string[]): string[] => {
    return [...times].sort((a, b) => {
        const [aHour, aMin] = a.split(':').map(Number);
        const [bHour, bMin] = b.split(':').map(Number);
        return aHour * 60 + aMin - (bHour * 60 + bMin);
    });
};

const CalendarTimesSettings = ({ onChangesUpdate }: CalendarTimesSettingsProps) => {
    // Time slots from database
    const [allTimeSlots, setAllTimeSlots] = useState<TimeSlot[]>([]);

    // Current category assignments
    const [earlySlots, setEarlySlots] = useState<string[]>([]);
    const [lateSlots, setLateSlots] = useState<string[]>([]);

    // Original values for change detection
    const [originalEarlySlots, setOriginalEarlySlots] = useState<string[]>([]);
    const [originalLateSlots, setOriginalLateSlots] = useState<string[]>([]);

    // Toggle default setting
    const [showExtendedSlotsDefault, setShowExtendedSlotsDefault] = useState(false);
    const [originalShowExtendedDefault, setOriginalShowExtendedDefault] = useState(false);

    // UI state
    const [isSaving, setIsSaving] = useState(false);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Show a success banner that clears itself. The handle is kept so a second
    // action doesn't leave the first action's timer running (it would blank the
    // newer message early), and so switching tabs mid-countdown doesn't leave a
    // timer firing setState into an unmounted tree.
    const successTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const flashSuccess = useCallback((message: string, ms = 3000): void => {
        if (successTimer.current) clearTimeout(successTimer.current);
        setSuccessMessage(message);
        successTimer.current = setTimeout(() => {
            successTimer.current = null;
            setSuccessMessage(null);
        }, ms);
    }, []);
    useEffect(() => () => {
        if (successTimer.current) clearTimeout(successTimer.current);
    }, []);

    // New time slot input
    const [newTimeHour, setNewTimeHour] = useState('');
    const [newTimeMinute, setNewTimeMinute] = useState('00');
    const [newTimeCategory, setNewTimeCategory] = useState<SlotCategory>('main');

    // Delete confirmation
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // Get all time strings from database
    const allTimes = useMemo(() => {
        return allTimeSlots.map(slot => parseTimeToHHMM(slot.my_time));
    }, [allTimeSlots]);

    // Categorized slots
    const categorizedSlots = useMemo((): CategorizedSlots => {
        const mainSlots = allTimes.filter(time =>
            !earlySlots.includes(time) && !lateSlots.includes(time)
        );
        return {
            early: sortTimes(earlySlots),
            main: sortTimes(mainSlots),
            late: sortTimes(lateSlots)
        };
    }, [allTimes, earlySlots, lateSlots]);

    const queryClient = useQueryClient();

    // Four parallel reads: the editable time-slot list + three option rows.
    // /api/options/:name 404s when an option is unset; optionQuery already
    // swallows 404→null, so a missing one falls back to its default below
    // (the rows are seeded today — audit N12/N20; the 404 path is defensive).
    const timesQuery = useQuery(adminLookupItemsQuery('tbltimes'));
    const earlyQuery = useQuery(optionQuery('CALENDAR_EARLY_SLOTS'));
    const lateQuery = useQuery(optionQuery('CALENDAR_LATE_SLOTS'));
    const toggleQuery = useQuery(optionQuery('CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT'));

    const isLoadingData =
        timesQuery.isLoading || earlyQuery.isLoading || lateQuery.isLoading || toggleQuery.isLoading;
    const hasLoadError =
        timesQuery.isError || earlyQuery.isError || lateQuery.isError || toggleQuery.isError;
    // Loading is purely the combined query state — derived, no effect/setState.
    const isLoading = isLoadingData;

    // Seed the editable state from the queries during render, keyed on each query's
    // result reference — re-seeds when an add/delete/save invalidates a query, with
    // no setState-in-effect. The time-slot list and the category assignments are
    // seeded independently so optimistic category edits survive a `tbltimes` refresh.
    const [seededTimes, setSeededTimes] = useState<unknown>(null);
    if (timesQuery.data && timesQuery.data !== seededTimes) {
        setSeededTimes(timesQuery.data);
        // adminLookupItemsQuery is the generic per-table lookup feed (its rows vary
        // by table, so the contract is intentionally `unknown[]`); for 'tbltimes' the
        // rows are TimeSlot — a single assertion off the already-`unknown[]` data.
        setAllTimeSlots(timesQuery.data as TimeSlot[]);
    }

    const [seededEarly, setSeededEarly] = useState<unknown>(null);
    if (earlyQuery.data !== seededEarly) {
        setSeededEarly(earlyQuery.data);
        // A missing or empty row hides nothing — what the calendar itself does
        // (`getSlotSettings`). Stand-in lists here used to show four "early" times
        // the calendar never hid, and an emptied list re-seeded them.
        const earlySlotsArr = (earlyQuery.data?.value ?? '').split(',').filter(Boolean);
        setEarlySlots(earlySlotsArr);
        setOriginalEarlySlots(earlySlotsArr);
    }

    const [seededLate, setSeededLate] = useState<unknown>(null);
    if (lateQuery.data !== seededLate) {
        setSeededLate(lateQuery.data);
        const lateSlotsArr = (lateQuery.data?.value ?? '').split(',').filter(Boolean);
        setLateSlots(lateSlotsArr);
        setOriginalLateSlots(lateSlotsArr);
    }

    const [seededToggle, setSeededToggle] = useState<unknown>(null);
    if (toggleQuery.data !== seededToggle) {
        setSeededToggle(toggleQuery.data);
        const toggleValue = toggleQuery.data?.value === 'true';
        setShowExtendedSlotsDefault(toggleValue);
        setOriginalShowExtendedDefault(toggleValue);
    }

    // Surface a load failure once per error transition.
    const [prevHasLoadError, setPrevHasLoadError] = useState(hasLoadError);
    if (hasLoadError !== prevHasLoadError) {
        setPrevHasLoadError(hasLoadError);
        if (hasLoadError) {
            setError('Failed to load settings. Please try again.');
        }
    }

    // Check for changes
    const hasChanges = useMemo(() => {
        const earlyChanged = JSON.stringify(sortTimes(earlySlots)) !== JSON.stringify(sortTimes(originalEarlySlots));
        const lateChanged = JSON.stringify(sortTimes(lateSlots)) !== JSON.stringify(sortTimes(originalLateSlots));
        const toggleChanged = showExtendedSlotsDefault !== originalShowExtendedDefault;
        return earlyChanged || lateChanged || toggleChanged;
    }, [earlySlots, lateSlots, showExtendedSlotsDefault, originalEarlySlots, originalLateSlots, originalShowExtendedDefault]);

    useEffect(() => {
        if (onChangesUpdate) {
            onChangesUpdate(hasChanges);
        }
    }, [hasChanges, onChangesUpdate]);

    // Move slot to a different category
    const moveSlot = (time: string, toCategory: SlotCategory) => {
        // Remove from current category
        setEarlySlots(prev => prev.filter(t => t !== time));
        setLateSlots(prev => prev.filter(t => t !== time));

        // Add to new category (if not main)
        if (toCategory === 'early') {
            setEarlySlots(prev => [...prev, time]);
        } else if (toCategory === 'late') {
            setLateSlots(prev => [...prev, time]);
        }
        // 'main' means not in early or late, so just removing is enough

        setSuccessMessage(null);
    };

    // Add new time slot
    const handleAddTimeSlot = async () => {
        if (!newTimeHour) {
            setError('Please enter an hour');
            return;
        }

        const hour = parseInt(newTimeHour, 10);
        const minute = parseInt(newTimeMinute, 10);

        if (isNaN(hour) || hour < 0 || hour > 23) {
            setError('Hour must be between 0 and 23');
            return;
        }

        const timeStr = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;

        // Check if time already exists
        if (allTimes.includes(timeStr)) {
            setError(`Time slot ${timeStr} already exists`);
            return;
        }

        setError(null);
        setIsSaving(true);

        try {
            // Create the time slot in database
            // Format as 1970-01-01THH:MM:00 to match existing format
            await postJSON('/api/admin/lookups/tbltimes', { my_time: `1970-01-01T${timeStr}:00` });

            // Add to appropriate category
            if (newTimeCategory === 'early') {
                setEarlySlots(prev => [...prev, timeStr]);
            } else if (newTimeCategory === 'late') {
                setLateSlots(prev => [...prev, timeStr]);
            }

            // Reload time slots (re-seeds the list via its query effect)
            await queryClient.invalidateQueries({ queryKey: qk.adminLookups.table('tbltimes') });

            // Clear inputs
            setNewTimeHour('');
            setNewTimeMinute('00');
            flashSuccess(`Added time slot ${timeStr}`);

        } catch (err) {
            setError(httpErrorMessage(err, 'Failed to add time slot'));
        } finally {
            setIsSaving(false);
        }
    };

    // Delete time slot
    const handleDeleteTimeSlot = async (timeStr: string) => {
        const slot = allTimeSlots.find(s => parseTimeToHHMM(s.my_time) === timeStr);
        if (!slot) {
            setError('Time slot not found');
            return;
        }

        setIsSaving(true);
        setError(null);

        try {
            await deleteJSON(`/api/admin/lookups/tbltimes/${slot.time_id}`);

            // Remove from categories
            setEarlySlots(prev => prev.filter(t => t !== timeStr));
            setLateSlots(prev => prev.filter(t => t !== timeStr));

            // Reload time slots (re-seeds the list via its query effect)
            await queryClient.invalidateQueries({ queryKey: qk.adminLookups.table('tbltimes') });

            setDeleteConfirm(null);
            flashSuccess(`Deleted time slot ${timeStr}`);

        } catch (err) {
            setError(httpErrorMessage(err, 'Failed to delete time slot'));
        } finally {
            setIsSaving(false);
        }
    };

    // Save category assignments
    const handleSave = async () => {
        setIsSaving(true);
        setError(null);
        setSuccessMessage(null);

        try {
            // One request, written in one statement; either list may be empty. It was
            // three update-only option PUTs, the first of which refused an emptied list
            // and any of which could fail after another had saved (FE-F21-5).
            const saved = await putJSON<calendarContract.UpdateSlotSettingsResponse>(
                '/api/calendar/slot-settings',
                {
                    earlySlots: sortTimes(earlySlots),
                    lateSlots: sortTimes(lateSlots),
                    showExtendedDefault: showExtendedSlotsDefault,
                },
                { schema: calendarContract.updateSlotSettings.response }
            );

            // Update original values (baseline for change detection)
            setEarlySlots(saved.earlySlots);
            setLateSlots(saved.lateSlots);
            setOriginalEarlySlots(saved.earlySlots);
            setOriginalLateSlots(saved.lateSlots);
            setOriginalShowExtendedDefault(saved.showExtendedDefault);

            // Refresh the cached option rows (the booking picker reads them) and the
            // calendar, whose grids hide the early/late times server-side.
            queryClient.invalidateQueries({ queryKey: qk.settings.option('CALENDAR_EARLY_SLOTS') });
            queryClient.invalidateQueries({ queryKey: qk.settings.option('CALENDAR_LATE_SLOTS') });
            queryClient.invalidateQueries({ queryKey: qk.settings.option('CALENDAR_SHOW_EXTENDED_SLOTS_DEFAULT') });
            queryClient.invalidateQueries({ queryKey: qk.calendar.all() });

            flashSuccess('Settings saved successfully!');

        } catch (err) {
            setError(httpErrorMessage(err, 'Failed to save settings. Please try again.'));
        } finally {
            setIsSaving(false);
        }
    };

    // Reset changes
    const handleReset = () => {
        setEarlySlots([...originalEarlySlots]);
        setLateSlots([...originalLateSlots]);
        setShowExtendedSlotsDefault(originalShowExtendedDefault);
        setSuccessMessage(null);
        setError(null);
    };

    // Regenerate calendar entries
    const handleRegenerateCalendar = async () => {
        setIsRegenerating(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const data = await postJSON<{ entriesAdded?: number; message?: string }>(
                '/api/calendar/regenerate',
                {},
                { schema: calendarContract.regenerate.response }
            );

            flashSuccess(data.message || `Added ${data.entriesAdded} calendar entries`, 5000);
        } catch (err) {
            console.error('Error regenerating calendar:', err);
            setError(httpErrorMessage(err, 'Failed to regenerate calendar'));
        } finally {
            setIsRegenerating(false);
        }
    };

    // Render a time slot chip with move buttons
    // Movement rules:
    // - Early: can move to Main only (not to Late)
    // - Late: can move to Main only (not to Early)
    // - Main: can move to both Early and Late
    const renderTimeChip = (time: string, category: SlotCategory) => {
        const isDeleting = deleteConfirm === time;

        // Determine which move buttons to show based on category
        const canMoveToEarly = category === 'main'; // Only main can move to early
        const canMoveToMain = category !== 'main';  // Early and late can move to main
        const canMoveToLate = category === 'main';  // Only main can move to late

        return (
            <div key={time} className={styles.timeChipWrapper}>
                <span className={styles.timeChip}>{time}</span>
                <div className={styles.chipActions}>
                    {canMoveToEarly && (
                        <button
                            className={styles.moveBtn}
                            onClick={() => moveSlot(time, 'early')}
                            title="Move to Early"
                            disabled={isSaving}
                        >
                            <i className="fas fa-sun"></i>
                        </button>
                    )}
                    {canMoveToMain && (
                        <button
                            className={styles.moveBtn}
                            onClick={() => moveSlot(time, 'main')}
                            title="Move to Main"
                            disabled={isSaving}
                        >
                            <i className="fas fa-calendar"></i>
                        </button>
                    )}
                    {canMoveToLate && (
                        <button
                            className={styles.moveBtn}
                            onClick={() => moveSlot(time, 'late')}
                            title="Move to Late"
                            disabled={isSaving}
                        >
                            <i className="fas fa-moon"></i>
                        </button>
                    )}
                    {isDeleting ? (
                        <>
                            <button
                                className={`${styles.moveBtn} ${styles.confirmDelete}`}
                                onClick={() => handleDeleteTimeSlot(time)}
                                title="Confirm Delete"
                                disabled={isSaving}
                            >
                                <i className="fas fa-check"></i>
                            </button>
                            <button
                                className={styles.moveBtn}
                                onClick={() => setDeleteConfirm(null)}
                                title="Cancel"
                                disabled={isSaving}
                            >
                                <i className="fas fa-times"></i>
                            </button>
                        </>
                    ) : (
                        <button
                            className={`${styles.moveBtn} ${styles.deleteBtn}`}
                            onClick={() => setDeleteConfirm(time)}
                            title="Delete"
                            disabled={isSaving}
                        >
                            <i className="fas fa-trash"></i>
                        </button>
                    )}
                </div>
            </div>
        );
    };

    if (isLoading) {
        return (
            <div className={sectionStyles.section}>
                <div className={sectionStyles.loadingContainer}>
                    <i className="fas fa-spinner fa-spin"></i>
                    <span>Loading calendar time settings...</span>
                </div>
            </div>
        );
    }

    return (
        <div>
            <div className={sectionStyles.section}>
                <h3>
                    <i className="fas fa-clock"></i>
                    Calendar Time Slots
                </h3>
                <p className={sectionStyles.sectionDescription}>
                    Manage time slots and their categories. Early and Late slots can be toggled on/off in the calendar.
                </p>

                {error && (
                    <div className={styles.errorMessage}>
                        <i className="fas fa-exclamation-circle"></i>
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div className={styles.successMessage}>
                        <i className="fas fa-check-circle"></i>
                        {successMessage}
                    </div>
                )}

                <div className={styles.settingsContent}>
                    {/* Toggle Setting */}
                    <div className={styles.toggleSection}>
                        <div className={styles.toggleRow}>
                            <div className={styles.toggleInfo}>
                                <label htmlFor="showExtendedSlots" className={styles.toggleLabel}>
                                    Show early & late slots by default
                                </label>
                                <p className={styles.toggleDescription}>
                                    When enabled, early and late time slots are visible by default in the calendar.
                                </p>
                            </div>
                            <label className={styles.switch} htmlFor="showExtendedSlots" aria-label="Show early & late slots by default">
                                <input
                                    type="checkbox"
                                    id="showExtendedSlots"
                                    checked={showExtendedSlotsDefault}
                                    onChange={() => setShowExtendedSlotsDefault(prev => !prev)}
                                />
                                <span className={styles.slider}></span>
                            </label>
                        </div>
                    </div>

                    {/* Add New Time Slot */}
                    <div className={styles.addSlotSection}>
                        <h4>
                            <i className="fas fa-plus-circle"></i>
                            Add New Time Slot
                        </h4>
                        <div className={styles.addSlotForm}>
                            <div className={styles.timeInputGroup}>
                                <input
                                    type="number"
                                    min="0"
                                    max="23"
                                    placeholder="HH"
                                    value={newTimeHour}
                                    onChange={(e) => setNewTimeHour(e.target.value)}
                                    className={styles.timeInput}
                                />
                                <span className={styles.timeSeparator}>:</span>
                                <select
                                    value={newTimeMinute}
                                    onChange={(e) => setNewTimeMinute(e.target.value)}
                                    className={styles.minuteSelect}
                                >
                                    <option value="00">00</option>
                                    <option value="30">30</option>
                                </select>
                            </div>
                            <select
                                value={newTimeCategory}
                                onChange={(e) => setNewTimeCategory(e.target.value as SlotCategory)}
                                className={styles.categorySelect}
                            >
                                <option value="early">Early</option>
                                <option value="main">Main</option>
                                <option value="late">Late</option>
                            </select>
                            <button
                                className="btn btn-primary"
                                onClick={handleAddTimeSlot}
                                disabled={isSaving || !newTimeHour}
                            >
                                <i className="fas fa-plus"></i>
                                Add
                            </button>
                        </div>
                    </div>

                    {/* Time Slot Categories */}
                    <div className={styles.categoriesSection}>
                        {/* Early Slots */}
                        <div className={`${styles.slotCategory} ${styles.earlyCategory}`}>
                            <div className={styles.categoryHeader}>
                                <i className="fas fa-sun"></i>
                                <span>Early Slots</span>
                                <span className={styles.categoryCount}>{categorizedSlots.early.length}</span>
                            </div>
                            <p className={styles.categoryNote}>
                                Hidden by default (e.g., lunch hours)
                            </p>
                            <div className={styles.slotTimes}>
                                {categorizedSlots.early.length === 0 ? (
                                    <span className={styles.emptyCategory}>No early slots</span>
                                ) : (
                                    categorizedSlots.early.map(time => renderTimeChip(time, 'early'))
                                )}
                            </div>
                        </div>

                        {/* Main Slots */}
                        <div className={`${styles.slotCategory} ${styles.mainCategory}`}>
                            <div className={styles.categoryHeader}>
                                <i className="fas fa-calendar"></i>
                                <span>Main Slots</span>
                                <span className={styles.categoryCount}>{categorizedSlots.main.length}</span>
                            </div>
                            <p className={styles.categoryNote}>
                                Always visible in the calendar
                            </p>
                            <div className={styles.slotTimes}>
                                {categorizedSlots.main.length === 0 ? (
                                    <span className={styles.emptyCategory}>No main slots</span>
                                ) : (
                                    categorizedSlots.main.map(time => renderTimeChip(time, 'main'))
                                )}
                            </div>
                        </div>

                        {/* Late Slots */}
                        <div className={`${styles.slotCategory} ${styles.lateCategory}`}>
                            <div className={styles.categoryHeader}>
                                <i className="fas fa-moon"></i>
                                <span>Late Slots</span>
                                <span className={styles.categoryCount}>{categorizedSlots.late.length}</span>
                            </div>
                            <p className={styles.categoryNote}>
                                Hidden by default (e.g., Ramadan hours)
                            </p>
                            <div className={styles.slotTimes}>
                                {categorizedSlots.late.length === 0 ? (
                                    <span className={styles.emptyCategory}>No late slots</span>
                                ) : (
                                    categorizedSlots.late.map(time => renderTimeChip(time, 'late'))
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            </div>

            <div className={sectionStyles.actions}>
                <button
                    className="btn btn-primary"
                    onClick={handleSave}
                    disabled={!hasChanges || isSaving}
                >
                    {isSaving ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Saving...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-save"></i>
                            Save Changes
                        </>
                    )}
                </button>
                <button
                    className="btn btn-secondary"
                    onClick={handleReset}
                    disabled={!hasChanges || isSaving}
                >
                    <i className="fas fa-undo"></i>
                    Reset
                </button>
            </div>

            {/* Regenerate Calendar Section */}
            <div className={`${sectionStyles.section} ${styles.regenerateSection}`}>
                <h3>
                    <i className="fas fa-sync-alt"></i>
                    Regenerate Calendar
                </h3>
                <p className={sectionStyles.sectionDescription}>
                    If you've added new time slots, click this button to populate them into the calendar for all future dates.
                </p>
                <button
                    className={`btn btn-secondary ${styles.regenerateButton}`}
                    onClick={handleRegenerateCalendar}
                    disabled={isRegenerating || isSaving}
                >
                    {isRegenerating ? (
                        <>
                            <i className="fas fa-spinner fa-spin"></i>
                            Regenerating...
                        </>
                    ) : (
                        <>
                            <i className="fas fa-sync-alt"></i>
                            Regenerate Calendar Entries
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

export default CalendarTimesSettings;
