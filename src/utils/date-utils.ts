import { DateTime } from "luxon";
import { Shift, MaintenanceWindow } from "../reflow/types";

// All times are handled in UTC throughout the system

// ============================================================
// isWithinShift
// Checks if a given UTC moment falls inside any working shift
//
// Example: shifts = [{ dayOfWeek: 1, startHour: 8, endHour: 17 }]
//          moment = Monday 10:00 UTC → true
//          moment = Monday 18:00 UTC → false
//          moment = Sunday 10:00 UTC → false
// ============================================================

export function isWithinShift(moment: DateTime, shifts: Shift[]): boolean {
  const dayOfWeek = moment.weekday % 7; // Luxon: Mon=1..Sun=7, convert to 0=Sun..6=Sat
  const hour = moment.hour;
  const minute = moment.minute;

  return shifts.some((shift) => {
    if (shift.dayOfWeek !== dayOfWeek) return false;
    // Check if current time is within [startHour, endHour)
    const afterStart = hour > shift.startHour || (hour === shift.startHour && minute >= 0);
    const beforeEnd = hour < shift.endHour;
    return afterStart && beforeEnd;
  });
}

// ============================================================
// isWithinMaintenance
// Checks if a given UTC moment falls inside any maintenance window
// ============================================================

export function isWithinMaintenance(
  moment: DateTime,
  maintenanceWindows: MaintenanceWindow[]
): boolean {
  return maintenanceWindows.some((mw) => {
    const start = DateTime.fromISO(mw.startDate, { zone: "utc" });
    const end = DateTime.fromISO(mw.endDate, { zone: "utc" });
    return moment >= start && moment < end;
  });
}

// ============================================================
// getNextShiftStart
// Given a moment that is OUTSIDE a shift, find the next
// moment when work can resume.
//
// Strategy: advance minute by minute until we find a shift.
// Simple and reliable for scheduling purposes.
// @upgrade: For performance with large schedules, replace with
//           direct calculation of next shift boundary instead
//           of iterating minute by minute.
// ============================================================

export function getNextShiftStart(moment: DateTime, shifts: Shift[]): DateTime {
  // Start checking from the next minute boundary
  let candidate = moment.startOf("minute");

  // Safety limit: search up to 14 days ahead to avoid infinite loops
  const limit = candidate.plus({ days: 14 });

  while (candidate < limit) {
    if (isWithinShift(candidate, shifts)) {
      return candidate;
    }
    candidate = candidate.plus({ minutes: 1 });
  }

  // @upgrade: throw a domain-specific error with constraint details
  throw new Error(
    `No shift found within 14 days from ${moment.toISO()}. Check shift configuration.`
  );
}

// ============================================================
// getMaintenanceEnd
// Given a moment inside a maintenance window, returns when
// that maintenance window ends so we can resume after it.
// ============================================================

export function getMaintenanceEnd(
  moment: DateTime,
  maintenanceWindows: MaintenanceWindow[]
): DateTime {
  const active = maintenanceWindows.find((mw) => {
    const start = DateTime.fromISO(mw.startDate, { zone: "utc" });
    const end = DateTime.fromISO(mw.endDate, { zone: "utc" });
    return moment >= start && moment < end;
  });

  if (!active) return moment; // Not in maintenance, return as-is
  return DateTime.fromISO(active.endDate, { zone: "utc" });
}

// ============================================================
// calculateEndDate  ← THE CORE FUNCTION
//
// Given a start date and required working minutes, calculates
// the real end date by only counting time inside shifts
// and skipping maintenance windows.
//
// Example:
//   startDate    = Monday 4:00 PM UTC
//   duration     = 120 minutes
//   shifts       = Mon-Fri 8AM-5PM
//
//   Mon 4PM→5PM  = 60 min counted  (hits shift end)
//   Jump to      = Tue 8AM
//   Tue 8AM→9AM  = 60 min counted  (total = 120 ✓)
//   endDate      = Tuesday 9:00 AM UTC
// ============================================================

export function calculateEndDate(
  startDate: string,
  durationMinutes: number,
  shifts: Shift[],
  maintenanceWindows: MaintenanceWindow[]
): string {
  let current = DateTime.fromISO(startDate, { zone: "utc" });
  let remainingMinutes = durationMinutes;

  // If we start outside a shift, jump to the next shift start first
  if (!isWithinShift(current, shifts)) {
    current = getNextShiftStart(current, shifts);
  }

  // If we start inside a maintenance window, jump past it
  if (isWithinMaintenance(current, maintenanceWindows)) {
    const maintEnd = getMaintenanceEnd(current, maintenanceWindows);
    // After maintenance ends, we may be outside a shift — jump to next shift if so
    current = isWithinShift(maintEnd, shifts)
      ? maintEnd
      : getNextShiftStart(maintEnd, shifts);
  }

  // Tick forward minute by minute, counting only valid working minutes
  // @upgrade: optimize by calculating how many minutes remain in current
  //           shift block and jumping directly instead of ticking per minute.
  //           This matters for work orders with very long durations.
  while (remainingMinutes > 0) {
    // Check if current minute is a valid working minute
    if (isWithinShift(current, shifts) && !isWithinMaintenance(current, maintenanceWindows)) {
      remainingMinutes--;
      if (remainingMinutes > 0) {
        current = current.plus({ minutes: 1 });
      }
    } else if (isWithinMaintenance(current, maintenanceWindows)) {
      // Jump past the maintenance window
      const maintEnd = getMaintenanceEnd(current, maintenanceWindows);
      current = isWithinShift(maintEnd, shifts)
        ? maintEnd
        : getNextShiftStart(maintEnd, shifts);
    } else {
      // Outside shift — jump to next shift start
      current = getNextShiftStart(current, shifts);
    }
  }

  // current now points to the last working minute
  // Add 1 minute to get the actual end time
  return current.plus({ minutes: 1 }).toUTC().toISO()!;
}

// ============================================================
// getEffectiveStartDate
// Ensures a proposed start date is valid:
// - Inside a shift
// - Not inside a maintenance window
// If not valid, pushes forward to next valid moment.
// ============================================================

export function getEffectiveStartDate(
  proposedStart: string,
  shifts: Shift[],
  maintenanceWindows: MaintenanceWindow[]
): string {
  let current = DateTime.fromISO(proposedStart, { zone: "utc" });

  // Push past maintenance if needed
  if (isWithinMaintenance(current, maintenanceWindows)) {
    const maintEnd = getMaintenanceEnd(current, maintenanceWindows);
    current = maintEnd;
  }

  // Push to next shift if outside working hours
  if (!isWithinShift(current, shifts)) {
    current = getNextShiftStart(current, shifts);
  }

  // Re-check maintenance after shift adjustment (edge case: shift starts during maintenance)
  if (isWithinMaintenance(current, maintenanceWindows)) {
    const maintEnd = getMaintenanceEnd(current, maintenanceWindows);
    current = isWithinShift(maintEnd, shifts)
      ? maintEnd
      : getNextShiftStart(maintEnd, shifts);
  }

  return current.toUTC().toISO()!;
}