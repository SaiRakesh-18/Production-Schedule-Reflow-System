import { DateTime } from "luxon";
import {
  isWithinShift,
  isWithinMaintenance,
  getNextShiftStart,
  getMaintenanceEnd,
  calculateEndDate,
  getEffectiveStartDate,
} from "../utils/date-utils";
import { Shift, MaintenanceWindow } from "../reflow/types";

// ─── shared fixtures ────────────────────────────────────────────────────────

/** Monday–Friday 08:00-17:00 (Luxon weekday: Mon=1 … Fri=5) */
const weekdayShifts: Shift[] = [
  { dayOfWeek: 1, startHour: 8, endHour: 17 }, // Monday    2025-01-06
  { dayOfWeek: 2, startHour: 8, endHour: 17 }, // Tuesday   2025-01-07
  { dayOfWeek: 3, startHour: 8, endHour: 17 }, // Wednesday 2025-01-08
  { dayOfWeek: 4, startHour: 8, endHour: 17 }, // Thursday  2025-01-09
  { dayOfWeek: 5, startHour: 8, endHour: 17 }, // Friday    2025-01-10
];

/** Monday 13:00–15:00 maintenance */
const maintenance: MaintenanceWindow[] = [
  { startDate: "2025-01-06T13:00:00.000Z", endDate: "2025-01-06T15:00:00.000Z" },
];

const dt = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

// ─── isWithinShift ───────────────────────────────────────────────────────────

describe("isWithinShift", () => {
  it("returns true for a moment inside shift hours", () => {
    expect(isWithinShift(dt("2025-01-06T10:00:00Z"), weekdayShifts)).toBe(true);
  });

  it("returns true at exactly shift start (08:00)", () => {
    expect(isWithinShift(dt("2025-01-06T08:00:00Z"), weekdayShifts)).toBe(true);
  });

  it("returns true one minute before shift end (16:59)", () => {
    expect(isWithinShift(dt("2025-01-06T16:59:00Z"), weekdayShifts)).toBe(true);
  });

  it("returns false at exactly shift end (17:00) — end is exclusive", () => {
    expect(isWithinShift(dt("2025-01-06T17:00:00Z"), weekdayShifts)).toBe(false);
  });

  it("returns false before shift start (07:59)", () => {
    expect(isWithinShift(dt("2025-01-06T07:59:00Z"), weekdayShifts)).toBe(false);
  });

  it("returns false after shift end (18:00)", () => {
    expect(isWithinShift(dt("2025-01-06T18:00:00Z"), weekdayShifts)).toBe(false);
  });

  it("returns false on a day with no shift (Saturday 2025-01-11)", () => {
    expect(isWithinShift(dt("2025-01-11T10:00:00Z"), weekdayShifts)).toBe(false);
  });

  it("returns false on Sunday (2025-01-12)", () => {
    expect(isWithinShift(dt("2025-01-12T10:00:00Z"), weekdayShifts)).toBe(false);
  });

  it("returns false when shifts array is empty", () => {
    expect(isWithinShift(dt("2025-01-06T10:00:00Z"), [])).toBe(false);
  });
});

// ─── isWithinMaintenance ─────────────────────────────────────────────────────

describe("isWithinMaintenance", () => {
  it("returns true at exactly maintenance start (13:00)", () => {
    expect(isWithinMaintenance(dt("2025-01-06T13:00:00Z"), maintenance)).toBe(true);
  });

  it("returns true for a moment inside the maintenance window (14:00)", () => {
    expect(isWithinMaintenance(dt("2025-01-06T14:00:00Z"), maintenance)).toBe(true);
  });

  it("returns false at exactly maintenance end (15:00) — end is exclusive", () => {
    expect(isWithinMaintenance(dt("2025-01-06T15:00:00Z"), maintenance)).toBe(false);
  });

  it("returns false before the maintenance window (12:59)", () => {
    expect(isWithinMaintenance(dt("2025-01-06T12:59:00Z"), maintenance)).toBe(false);
  });

  it("returns false after the maintenance window (15:01)", () => {
    expect(isWithinMaintenance(dt("2025-01-06T15:01:00Z"), maintenance)).toBe(false);
  });

  it("returns false on a different day", () => {
    expect(isWithinMaintenance(dt("2025-01-07T13:00:00Z"), maintenance)).toBe(false);
  });

  it("returns false when maintenance array is empty", () => {
    expect(isWithinMaintenance(dt("2025-01-06T13:00:00Z"), [])).toBe(false);
  });
});

// ─── getNextShiftStart ───────────────────────────────────────────────────────

describe("getNextShiftStart", () => {
  it("finds next day start when called after shift end (Mon 17:00 → Tue 08:00)", () => {
    const result = getNextShiftStart(dt("2025-01-06T17:00:00Z"), weekdayShifts);
    expect(result.toISO()).toBe("2025-01-07T08:00:00.000Z");
  });

  it("finds same day start when called before shift (Mon 06:00 → Mon 08:00)", () => {
    const result = getNextShiftStart(dt("2025-01-06T06:00:00Z"), weekdayShifts);
    expect(result.toISO()).toBe("2025-01-06T08:00:00.000Z");
  });

  it("skips weekend to find Monday (Sat 10:00 → Mon 08:00)", () => {
    const result = getNextShiftStart(dt("2025-01-11T10:00:00Z"), weekdayShifts);
    expect(result.toISO()).toBe("2025-01-13T08:00:00.000Z");
  });

  it("finds next shift start after end of Friday (Fri 17:00 → Mon 08:00)", () => {
    const result = getNextShiftStart(dt("2025-01-10T17:00:00Z"), weekdayShifts);
    expect(result.toISO()).toBe("2025-01-13T08:00:00.000Z");
  });
});

// ─── getMaintenanceEnd ───────────────────────────────────────────────────────

describe("getMaintenanceEnd", () => {
  it("returns the maintenance end time when moment is inside the window", () => {
    const result = getMaintenanceEnd(dt("2025-01-06T14:00:00Z"), maintenance);
    expect(result.toISO()).toBe("2025-01-06T15:00:00.000Z");
  });

  it("returns the maintenance end when called at exactly maintenance start", () => {
    const result = getMaintenanceEnd(dt("2025-01-06T13:00:00Z"), maintenance);
    expect(result.toISO()).toBe("2025-01-06T15:00:00.000Z");
  });

  it("returns the moment unchanged when not inside any maintenance window", () => {
    const outside = dt("2025-01-06T10:00:00Z");
    const result = getMaintenanceEnd(outside, maintenance);
    expect(result.toISO()).toBe(outside.toISO());
  });

  it("returns moment unchanged when maintenance array is empty", () => {
    const moment = dt("2025-01-06T13:00:00Z");
    const result = getMaintenanceEnd(moment, []);
    expect(result.toISO()).toBe(moment.toISO());
  });
});

// ─── calculateEndDate ────────────────────────────────────────────────────────

describe("calculateEndDate", () => {
  describe("normal duration inside single shift", () => {
    it("120 min starting Mon 08:00 → Mon 10:00", () => {
      const result = calculateEndDate("2025-01-06T08:00:00Z", 120, weekdayShifts, []);
      expect(result).toBe("2025-01-06T10:00:00.000Z");
    });

    it("60 min starting Mon 14:00 → Mon 15:00", () => {
      const result = calculateEndDate("2025-01-06T14:00:00Z", 60, weekdayShifts, []);
      expect(result).toBe("2025-01-06T15:00:00.000Z");
    });
  });

  describe("crosses shift end — wraps to next day", () => {
    it("120 min starting Mon 16:00 → Tue 09:00 (60 min Mon + 60 min Tue)", () => {
      // Mon 16:00-16:59 = 60 min, shift ends 17:00, jump to Tue 08:00
      // Tue 08:00-08:59 = 60 min → return 09:00
      const result = calculateEndDate("2025-01-06T16:00:00Z", 120, weekdayShifts, []);
      expect(result).toBe("2025-01-07T09:00:00.000Z");
    });

    it("60 min starting Mon 16:30 → Tue 08:30 (30 min Mon + 30 min Tue)", () => {
      const result = calculateEndDate("2025-01-06T16:30:00Z", 60, weekdayShifts, []);
      expect(result).toBe("2025-01-07T08:30:00.000Z");
    });
  });

  describe("skips maintenance window", () => {
    it("120 min starting Mon 12:00 skips 13:00-15:00 → Mon 16:00", () => {
      // 12:00-12:59 = 60 min, hits maintenance 13:00 → jump to 15:00
      // 15:00-15:59 = 60 min → return 16:00
      const result = calculateEndDate("2025-01-06T12:00:00Z", 120, weekdayShifts, maintenance);
      expect(result).toBe("2025-01-06T16:00:00.000Z");
    });

    it("60 min starting Mon 08:00 with maintenance 13-15 ends at 09:00 (no maintenance hit)", () => {
      const result = calculateEndDate("2025-01-06T08:00:00Z", 60, weekdayShifts, maintenance);
      expect(result).toBe("2025-01-06T09:00:00.000Z");
    });
  });

  describe("starts outside shift — snaps first", () => {
    it("60 min starting Mon 17:30 snaps to Tue 08:00 then runs → Tue 09:00", () => {
      const result = calculateEndDate("2025-01-06T17:30:00Z", 60, weekdayShifts, []);
      expect(result).toBe("2025-01-07T09:00:00.000Z");
    });
  });
});

// ─── getEffectiveStartDate ───────────────────────────────────────────────────

describe("getEffectiveStartDate", () => {
  it("returns the same time when already inside shift with no maintenance", () => {
    const result = getEffectiveStartDate("2025-01-06T10:00:00Z", weekdayShifts, []);
    expect(result).toBe("2025-01-06T10:00:00.000Z");
  });

  it("snaps to shift start when proposed time is before shift (Mon 06:00 → Mon 08:00)", () => {
    const result = getEffectiveStartDate("2025-01-06T06:00:00Z", weekdayShifts, []);
    expect(result).toBe("2025-01-06T08:00:00.000Z");
  });

  it("snaps to next shift start when proposed time is after shift (Mon 18:00 → Tue 08:00)", () => {
    const result = getEffectiveStartDate("2025-01-06T18:00:00Z", weekdayShifts, []);
    expect(result).toBe("2025-01-07T08:00:00.000Z");
  });

  it("snaps past maintenance window when proposed time is inside it (Mon 13:30 → Mon 15:00)", () => {
    const result = getEffectiveStartDate("2025-01-06T13:30:00Z", weekdayShifts, maintenance);
    expect(result).toBe("2025-01-06T15:00:00.000Z");
  });

  it("snaps to maintenance end exactly when proposed time is at maintenance start (13:00 → 15:00)", () => {
    const result = getEffectiveStartDate("2025-01-06T13:00:00Z", weekdayShifts, maintenance);
    expect(result).toBe("2025-01-06T15:00:00.000Z");
  });

  it("does not move when proposed time is exactly at maintenance end (15:00) — outside maintenance", () => {
    const result = getEffectiveStartDate("2025-01-06T15:00:00Z", weekdayShifts, maintenance);
    expect(result).toBe("2025-01-06T15:00:00.000Z");
  });
});
