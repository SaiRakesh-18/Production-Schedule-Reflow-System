import {
  checkDependencies,
  checkWorkCenterConflicts,
  checkShiftBoundaries,
  checkMaintenanceConflicts,
  checkAll,
} from "../reflow/constraint-checker";
import { WorkOrder, WorkCenter, Shift, MaintenanceWindow } from "../reflow/types";

// ─── helpers ─────────────────────────────────────────────────────────────────

const MON_SHIFT: Shift = { dayOfWeek: 1, startHour: 8, endHour: 17 };
const TUE_SHIFT: Shift = { dayOfWeek: 2, startHour: 8, endHour: 17 };

function makeWO(
  docId: string,
  start: string,
  end: string,
  opts: {
    centerId?: string;
    deps?: string[];
    isMaintenance?: boolean;
  } = {}
): WorkOrder {
  return {
    docId,
    docType: "workOrder",
    data: {
      workOrderNumber: docId.toUpperCase(),
      manufacturingOrderId: "mo-test",
      workCenterId: opts.centerId ?? "wc-1",
      startDate: start,
      endDate: end,
      durationMinutes: 60,
      isMaintenance: opts.isMaintenance ?? false,
      dependsOnWorkOrderIds: opts.deps ?? [],
    },
  };
}

function makeWC(
  docId: string,
  shifts: Shift[],
  maintenanceWindows: MaintenanceWindow[] = []
): WorkCenter {
  return {
    docId,
    docType: "workCenter",
    data: { name: docId, shifts, maintenanceWindows },
  };
}

// ─── checkDependencies ───────────────────────────────────────────────────────

describe("checkDependencies", () => {
  it("returns no violations when child starts after parent ends", () => {
    const parent = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const child = makeWO("wo-2", "2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z", {
      deps: ["wo-1"],
    });
    const violations = checkDependencies([parent, child]);
    expect(violations).toHaveLength(0);
  });

  it("returns a violation when child starts before parent ends", () => {
    const parent = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const child = makeWO("wo-2", "2025-01-06T09:00:00Z", "2025-01-06T11:00:00Z", {
      deps: ["wo-1"],
    });
    const violations = checkDependencies([parent, child]);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("DEPENDENCY");
    expect(violations[0].workOrderId).toBe("wo-2");
  });

  it("returns a violation when the parent ID does not exist in the schedule", () => {
    const child = makeWO("wo-2", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
      deps: ["wo-missing"],
    });
    const violations = checkDependencies([child]);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("DEPENDENCY");
    expect(violations[0].message).toContain("wo-missing");
  });

  it("returns no violations when order has no dependencies", () => {
    const wo = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    expect(checkDependencies([wo])).toHaveLength(0);
  });

  it("returns multiple violations when multiple children violate their parents", () => {
    const parent = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const child1 = makeWO("wo-2", "2025-01-06T09:00:00Z", "2025-01-06T11:00:00Z", {
      deps: ["wo-1"],
    });
    const child2 = makeWO("wo-3", "2025-01-06T09:30:00Z", "2025-01-06T11:30:00Z", {
      deps: ["wo-1"],
    });
    const violations = checkDependencies([parent, child1, child2]);
    expect(violations).toHaveLength(2);
  });
});

// ─── checkWorkCenterConflicts ────────────────────────────────────────────────

describe("checkWorkCenterConflicts", () => {
  it("returns no violations when orders are back-to-back on the same work center", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const wo2 = makeWO("wo-2", "2025-01-06T10:00:00Z", "2025-01-06T12:00:00Z");
    expect(checkWorkCenterConflicts([wo1, wo2])).toHaveLength(0);
  });

  it("returns a violation when two orders overlap on the same work center", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T11:00:00Z");
    const wo2 = makeWO("wo-2", "2025-01-06T10:00:00Z", "2025-01-06T12:00:00Z");
    const violations = checkWorkCenterConflicts([wo1, wo2]);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("WORK_CENTER_OVERLAP");
    expect(violations[0].workOrderId).toBe("wo-2");
  });

  it("returns no violations when overlapping orders are on different work centers", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T11:00:00Z", {
      centerId: "wc-1",
    });
    const wo2 = makeWO("wo-2", "2025-01-06T10:00:00Z", "2025-01-06T12:00:00Z", {
      centerId: "wc-2",
    });
    expect(checkWorkCenterConflicts([wo1, wo2])).toHaveLength(0);
  });

  it("returns no violations for a single work order", () => {
    const wo = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    expect(checkWorkCenterConflicts([wo])).toHaveLength(0);
  });
});

// ─── checkShiftBoundaries ────────────────────────────────────────────────────

describe("checkShiftBoundaries", () => {
  const wc = makeWC("wc-1", [MON_SHIFT, TUE_SHIFT]);

  it("returns no violations when order starts and ends inside shift", () => {
    const wo = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    expect(checkShiftBoundaries([wo], [wc])).toHaveLength(0);
  });

  it("returns a violation when order starts before shift (07:00)", () => {
    const wo = makeWO("wo-1", "2025-01-06T07:00:00Z", "2025-01-06T09:00:00Z");
    const violations = checkShiftBoundaries([wo], [wc]);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("OUTSIDE_SHIFT");
    expect(violations[0].message).toContain("starts outside");
  });

  it("returns a violation when order ends outside shift (17:00 end is outside)", () => {
    // end=17:00 means the last working minute was 16:59, check end-1=16:59 which IS in shift
    // end=18:00 means last minute was 17:59 which is NOT in shift
    const wo = makeWO("wo-1", "2025-01-06T16:00:00Z", "2025-01-06T18:00:00Z");
    const violations = checkShiftBoundaries([wo], [wc]);
    expect(violations.some((v) => v.message.includes("ends outside"))).toBe(true);
  });

  it("skips isMaintenance=true orders", () => {
    const wo = makeWO("wo-1", "2025-01-06T06:00:00Z", "2025-01-06T07:00:00Z", {
      isMaintenance: true,
    });
    expect(checkShiftBoundaries([wo], [wc])).toHaveLength(0);
  });

  it("skips order when work center is not in the provided list", () => {
    const wo = makeWO("wo-1", "2025-01-06T06:00:00Z", "2025-01-06T07:00:00Z", {
      centerId: "wc-unknown",
    });
    expect(checkShiftBoundaries([wo], [wc])).toHaveLength(0);
  });
});

// ─── checkMaintenanceConflicts ───────────────────────────────────────────────

describe("checkMaintenanceConflicts", () => {
  const mw: MaintenanceWindow = {
    startDate: "2025-01-06T13:00:00Z",
    endDate: "2025-01-06T15:00:00Z",
    reason: "Scheduled service",
  };
  const wc = makeWC("wc-1", [MON_SHIFT], [mw]);

  it("returns no violations when order is completely before maintenance", () => {
    const wo = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T12:00:00Z");
    expect(checkMaintenanceConflicts([wo], [wc])).toHaveLength(0);
  });

  it("returns no violations when order is completely after maintenance", () => {
    const wo = makeWO("wo-1", "2025-01-06T15:00:00Z", "2025-01-06T16:00:00Z");
    expect(checkMaintenanceConflicts([wo], [wc])).toHaveLength(0);
  });

  it("returns a violation when order overlaps the start of maintenance", () => {
    const wo = makeWO("wo-1", "2025-01-06T12:00:00Z", "2025-01-06T14:00:00Z");
    const violations = checkMaintenanceConflicts([wo], [wc]);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("MAINTENANCE_CONFLICT");
  });

  it("returns a violation when order overlaps the end of maintenance", () => {
    const wo = makeWO("wo-1", "2025-01-06T14:00:00Z", "2025-01-06T16:00:00Z");
    const violations = checkMaintenanceConflicts([wo], [wc]);
    expect(violations).toHaveLength(1);
    expect(violations[0].type).toBe("MAINTENANCE_CONFLICT");
  });

  it("returns a violation when order is entirely inside maintenance window", () => {
    const wo = makeWO("wo-1", "2025-01-06T13:30:00Z", "2025-01-06T14:30:00Z");
    const violations = checkMaintenanceConflicts([wo], [wc]);
    expect(violations).toHaveLength(1);
    expect(violations[0].workOrderId).toBe("wo-1");
  });

  it("skips isMaintenance=true orders", () => {
    const wo = makeWO("wo-1", "2025-01-06T13:00:00Z", "2025-01-06T15:00:00Z", {
      isMaintenance: true,
    });
    expect(checkMaintenanceConflicts([wo], [wc])).toHaveLength(0);
  });
});

// ─── checkAll ─────────────────────────────────────────────────────────────────

describe("checkAll", () => {
  const wc = makeWC("wc-1", [MON_SHIFT, TUE_SHIFT]);

  it("returns isValid:true and empty violations for a clean schedule", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const wo2 = makeWO("wo-2", "2025-01-06T09:00:00Z", "2025-01-06T10:00:00Z", {
      deps: ["wo-1"],
    });
    const result = checkAll([wo1, wo2], [wc]);
    expect(result.isValid).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("returns isValid:false when there is a dependency violation", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const wo2 = makeWO("wo-2", "2025-01-06T09:00:00Z", "2025-01-06T11:00:00Z", {
      deps: ["wo-1"],
    });
    const result = checkAll([wo1, wo2], [wc]);
    expect(result.isValid).toBe(false);
    expect(result.violations.some((v) => v.type === "DEPENDENCY")).toBe(true);
  });

  it("returns isValid:false when there is a work center overlap", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T11:00:00Z");
    const wo2 = makeWO("wo-2", "2025-01-06T10:00:00Z", "2025-01-06T12:00:00Z");
    const result = checkAll([wo1, wo2], [wc]);
    expect(result.isValid).toBe(false);
    expect(result.violations.some((v) => v.type === "WORK_CENTER_OVERLAP")).toBe(true);
  });

  it("collects violations from all checkers in one result", () => {
    // dependency violation + shift violation
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const wo2 = makeWO("wo-2", "2025-01-06T06:00:00Z", "2025-01-06T07:00:00Z", {
      deps: ["wo-1"], // starts before parent ends
    });
    const result = checkAll([wo1, wo2], [wc]);
    expect(result.isValid).toBe(false);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });
});
