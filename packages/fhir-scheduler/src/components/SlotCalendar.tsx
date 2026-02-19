import { useMemo, useCallback, useEffect, useState, useRef } from 'react';
import type { Slot, Schedule } from '../types';
import { useSchedulerStore } from '../store/schedulerStore';

type DateViewMode = 'available' | 'calendar';

interface SlotCalendarProps {
  provider: Schedule;
  slots: Slot[];
  selectedDate: string | null;
  onDateChange: (date: string) => void;
  onSlotSelect: (slot: Slot) => void;
  onBack: () => void;
  loading?: boolean;
}

/**
 * Format time for display (e.g., "2:30 PM")
 */
function formatTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

/**
 * Format date for display (e.g., "Tuesday, December 10")
 */
function formatDateDisplay(dateString: string): string {
  const date = new Date(dateString + 'T00:00:00');
  return date.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * Get array of next N days starting from today
 */
function getDateOptions(days: number = 180): string[] {
  const dates: string[] = [];
  const today = new Date();
  
  for (let i = 0; i < days; i++) {
    const date = new Date(today);
    date.setDate(today.getDate() + i);
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${d}`);
  }
  
  return dates;
}

/**
 * Get calendar weeks for a specific month, including empty cells for proper alignment
 */
function getMonthCalendarWeeks(year: number, month: number, availableDates: Set<string>): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();
  
  // Start first week with empty cells
  let currentWeek: (string | null)[] = new Array(startDayOfWeek).fill(null);
  
  for (let d = 1; d <= lastDay.getDate(); d++) {
    if (currentWeek.length === 7) {
      weeks.push(currentWeek);
      currentWeek = [];
    }
    const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    // Only include if it's in our available range
    if (availableDates.has(dateStr)) {
      currentWeek.push(dateStr);
    } else {
      currentWeek.push(null); // Out of range
    }
  }
  
  // Pad the last week
  if (currentWeek.length > 0) {
    while (currentWeek.length < 7) {
      currentWeek.push(null);
    }
    weeks.push(currentWeek);
  }
  
  return weeks;
}

/**
 * Group slots by time period (morning, afternoon, evening)
 */
function groupSlotsByPeriod(slots: Slot[]): Record<string, Slot[]> {
  const groups: Record<string, Slot[]> = {
    morning: [],
    afternoon: [],
    evening: [],
  };
  
  for (const slot of slots) {
    const hour = new Date(slot.start).getHours();
    if (hour < 12) {
      groups.morning.push(slot);
    } else if (hour < 17) {
      groups.afternoon.push(slot);
    } else {
      groups.evening.push(slot);
    }
  }
  
  return groups;
}

/**
 * Get provider display name
 */
function getProviderName(schedule: Schedule): string {
  const firstActor = schedule.actor?.[0];
  return firstActor?.display || firstActor?.reference?.split('/').pop() || 'Provider';
}

const WEEKDAY_HEADERS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function SlotCalendar({
  provider,
  slots,
  selectedDate,
  onDateChange,
  onSlotSelect,
  onBack,
  loading,
}: SlotCalendarProps) {
  const [viewMode, setViewMode] = useState<DateViewMode>('available');
  const [currentMonth, setCurrentMonth] = useState(() => {
    const today = new Date();
    return { year: today.getFullYear(), month: today.getMonth() };
  });
  
  // Ref for scrolling to time slots after date selection
  const timeSlotsRef = useRef<HTMLElement>(null);
  
  const dateOptions = useMemo(() => getDateOptions(180), []);
  const dateOptionsSet = useMemo(() => new Set(dateOptions), [dateOptions]);
  
  // Get calendar weeks for the current month view
  const calendarWeeks = useMemo(
    () => getMonthCalendarWeeks(currentMonth.year, currentMonth.month, dateOptionsSet),
    [currentMonth.year, currentMonth.month, dateOptionsSet]
  );
  
  const groupedSlots = useMemo(() => groupSlotsByPeriod(slots), [slots]);
  
  // Calculate min/max months for navigation bounds
  const { minMonth, maxMonth } = useMemo(() => {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setDate(endDate.getDate() + 180);
    return {
      minMonth: { year: today.getFullYear(), month: today.getMonth() },
      maxMonth: { year: endDate.getFullYear(), month: endDate.getMonth() },
    };
  }, []);
  
  const canGoPrev = currentMonth.year > minMonth.year || 
    (currentMonth.year === minMonth.year && currentMonth.month > minMonth.month);
  const canGoNext = currentMonth.year < maxMonth.year || 
    (currentMonth.year === maxMonth.year && currentMonth.month < maxMonth.month);
  
  const handlePrevMonth = useCallback(() => {
    if (!canGoPrev) return;
    setCurrentMonth((prev) => {
      if (prev.month === 0) {
        return { year: prev.year - 1, month: 11 };
      }
      return { year: prev.year, month: prev.month - 1 };
    });
  }, [canGoPrev]);
  
  const handleNextMonth = useCallback(() => {
    if (!canGoNext) return;
    setCurrentMonth((prev) => {
      if (prev.month === 11) {
        return { year: prev.year + 1, month: 0 };
      }
      return { year: prev.year, month: prev.month + 1 };
    });
  }, [canGoNext]);
  
  const currentMonthLabel = useMemo(() => {
    const date = new Date(currentMonth.year, currentMonth.month, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  }, [currentMonth.year, currentMonth.month]);
  
  // Get availability data from store
  const dateAvailability = useSchedulerStore((state) => state.dateAvailability);
  const fetchDateAvailability = useSchedulerStore((state) => state.fetchDateAvailability);
  
  // Fetch availability when component mounts or provider changes
  useEffect(() => {
    if (provider && dateOptions.length > 0) {
      fetchDateAvailability(dateOptions);
    }
  }, [provider, dateOptions, fetchDateAvailability]);
  
  // Get only dates with availability for the compact view
  const availableDates = useMemo(() => {
    return dateOptions.filter((date) => {
      const count = dateAvailability[date];
      return count !== undefined && count > 0;
    });
  }, [dateOptions, dateAvailability]);
  
  const handleDateSelect = useCallback(
    (date: string) => {
      onDateChange(date);
      // Scroll to time slots after a brief delay to allow render
      setTimeout(() => {
        timeSlotsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 100);
    },
    [onDateChange]
  );
  
  return (
    <div className="fs-slot-calendar">
      <header className="fs-calendar-header">
        <button
          type="button"
          className="fs-back-button"
          onClick={onBack}
          aria-label="Back to provider list"
        >
          <svg className="fs-icon" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
          </svg>
          Back
        </button>
        <h2 className="fs-calendar-title">
          Schedule with {getProviderName(provider)}
        </h2>
      </header>
      
      {/* Date Picker */}
      <section className="fs-date-picker" aria-label="Select a date">
        <div className="fs-date-picker-header">
          <h3 className="fs-subsection-title">Select a Date</h3>
          <div className="fs-view-toggle" role="tablist" aria-label="Date view mode">
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'available'}
              className={`fs-view-toggle-btn ${viewMode === 'available' ? 'fs-active' : ''}`}
              onClick={() => setViewMode('available')}
            >
              Available
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={viewMode === 'calendar'}
              className={`fs-view-toggle-btn ${viewMode === 'calendar' ? 'fs-active' : ''}`}
              onClick={() => setViewMode('calendar')}
            >
              Calendar
            </button>
          </div>
        </div>
        
        {/* Available dates list (compact view) */}
        {viewMode === 'available' && (
          <div className="fs-available-dates" role="listbox" aria-label="Available dates">
            {availableDates.length === 0 ? (
              <p className="fs-no-available-dates">No available dates found.</p>
            ) : (
              availableDates.map((date) => {
                const isSelected = date === selectedDate;
                const dateObj = new Date(date + 'T00:00:00');
                const dayName = dateObj.toLocaleDateString('en-US', { weekday: 'short' });
                const monthDay = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                const slotCount = dateAvailability[date] ?? 0;
                
                return (
                  <button
                    key={date}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    className={`fs-available-date-btn ${isSelected ? 'fs-selected' : ''}`}
                    onClick={() => handleDateSelect(date)}
                  >
                    <span className="fs-date-info">
                      <span className="fs-date-day">{dayName}</span>
                      <span className="fs-date-monthday">{monthDay}</span>
                    </span>
                    <span className="fs-slot-count">{slotCount} slots</span>
                  </button>
                );
              })
            )}
          </div>
        )}
        
        {/* Calendar grid view */}
        {viewMode === 'calendar' && (
          <div className="fs-calendar-container">
            {/* Month navigation */}
            <div className="fs-month-nav">
              <button
                type="button"
                className="fs-month-nav-btn"
                onClick={handlePrevMonth}
                disabled={!canGoPrev}
                aria-label="Previous month"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z" fill="currentColor" />
                </svg>
              </button>
              <span className="fs-month-label-nav">{currentMonthLabel}</span>
              <button
                type="button"
                className="fs-month-nav-btn"
                onClick={handleNextMonth}
                disabled={!canGoNext}
                aria-label="Next month"
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M8.59 16.59L10 18l6-6-6-6-1.41 1.41L13.17 12z" fill="currentColor" />
                </svg>
              </button>
            </div>
            
            <div className="fs-calendar-grid" role="grid" aria-label="Available dates">
            {/* Weekday headers */}
            <div className="fs-calendar-header-row" role="row">
              {WEEKDAY_HEADERS.map((day) => (
                <div key={day} className="fs-calendar-header-cell" role="columnheader">
                  {day}
                </div>
              ))}
            </div>
            
            {/* Calendar weeks */}
            {calendarWeeks.map((week, weekIndex) => (
              <div key={weekIndex} className="fs-calendar-week" role="row">
                {week.map((date, dayIndex) => {
                  if (date === null) {
                    return <div key={`empty-${dayIndex}`} className="fs-calendar-cell fs-empty" role="gridcell" />;
                  }
                  
                  const isSelected = date === selectedDate;
                  const dateObj = new Date(date + 'T00:00:00');
                  const dayNum = dateObj.getDate();
                  const monthName = dateObj.toLocaleDateString('en-US', { month: 'short' });
                  const slotCount = dateAvailability[date] ?? null;
                  const hasAvailability = slotCount !== null && slotCount > 0;
                  const noAvailability = slotCount === 0;
                  const isFirstOfMonth = dayNum === 1;
                  
                  return (
                    <button
                      key={date}
                      type="button"
                      role="gridcell"
                      aria-selected={isSelected}
                      aria-label={`${dateObj.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}${hasAvailability ? `, ${slotCount} slots available` : noAvailability ? ', no availability' : ''}`}
                      className={`fs-calendar-cell fs-date-option ${isSelected ? 'fs-selected' : ''} ${hasAvailability ? 'fs-has-availability' : ''} ${noAvailability ? 'fs-no-availability' : ''}`}
                      onClick={() => handleDateSelect(date)}
                    >
                      {isFirstOfMonth && <span className="fs-month-label">{monthName}</span>}
                      <span className="fs-day-number">{dayNum}</span>
                      {hasAvailability && (
                        <span className="fs-availability-dot" aria-hidden="true" title={`${slotCount} slots`} />
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
            </div>
          </div>
        )}
      </section>
      
      {/* Time Slots */}
      {selectedDate && (
        <section ref={timeSlotsRef} className="fs-time-slots" aria-label="Available times">
          <h3 className="fs-subsection-title">
            {formatDateDisplay(selectedDate)}
          </h3>
          
          {loading ? (
            <div className="fs-loading-slots">
              <span className="fs-loading-text">Loading available times...</span>
            </div>
          ) : slots.length === 0 ? (
            <div className="fs-no-slots">
              <p>No available times for this date. Please select another date.</p>
            </div>
          ) : (
            <div className="fs-slot-groups">
              {Object.entries(groupedSlots).map(([period, periodSlots]) => {
                if (periodSlots.length === 0) return null;
                
                const periodLabel =
                  period === 'morning'
                    ? '🌅 Morning'
                    : period === 'afternoon'
                    ? '☀️ Afternoon'
                    : '🌙 Evening';
                
                return (
                  <div key={period} className="fs-slot-group">
                    <h4 className="fs-period-label">{periodLabel}</h4>
                    <div className="fs-slot-grid" role="listbox" aria-label={`${period} times`}>
                      {periodSlots.map((slot) => (
                        <button
                          key={slot.id}
                          type="button"
                          role="option"
                          className="fs-slot-button"
                          onClick={() => onSlotSelect(slot)}
                          aria-label={`${formatTime(slot.start)} to ${formatTime(slot.end)}`}
                        >
                          {formatTime(slot.start)}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}
    </div>
  );
}

/**
 * Connected version that uses the Zustand store
 */
export function ConnectedSlotCalendar() {
  const provider = useSchedulerStore((state) => state.selectedProvider);
  const slots = useSchedulerStore((state) => state.slots);
  const selectedDate = useSchedulerStore((state) => state.selectedDate);
  const loading = useSchedulerStore((state) => state.loading);
  const fetchSlots = useSchedulerStore((state) => state.fetchSlots);
  const selectSlot = useSchedulerStore((state) => state.selectSlot);
  const goBack = useSchedulerStore((state) => state.goBack);
  
  if (!provider) {
    return null;
  }
  
  return (
    <SlotCalendar
      provider={provider}
      slots={slots}
      selectedDate={selectedDate}
      onDateChange={fetchSlots}
      onSlotSelect={selectSlot}
      onBack={goBack}
      loading={loading}
    />
  );
}
