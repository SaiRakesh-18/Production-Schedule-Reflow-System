import { DateTime } from "luxon";
import { ReflowService } from "../reflow/reflow.service";
import {
  WorkOrder,
  WorkCenter,
  ReflowInput,
  Shift,
  ScheduledOrder,
} from "../reflow/types";
import { scenario1 } from "../data/scenario-1-delay-cascade";
import { scenario2 } from "../data/scenario-2-maintenance";
import { scenario3 } from "../data/scenario-3-complex";

// ─── helpers ─────────────────────────────────────────────────────────────────

const MON_FRI_SHIFTS: Shift[] = [
  { dayOfWeek: 1, startHour: 8, endHour: 17 },
  { dayOfWeek: 2, startHour: 8, endHour: 17 },
  { dayOfWeek: 3, startHour: 8, endHour: 17 },
  { dayOfWeek: 4, startHour: 8, endHour: 17 },
  { dayOfWeek: 5, startHour: 8, endHour: 17 },
];

function makeWO(
  docId: string,
  start: string,
  end: string,
  opts: {
    centerId?: string;
    durationMinutes?: number;
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
      durationMinutes: opts.durationMinutes ?? 60,
      isMaintenance: opts.isMaintenance ?? false,
      dependsOnWorkOrderIds: opts.deps ?? [],
    },
  };
}

function makeWC(
  docId: string,
  shifts = MON_FRI_SHIFTS,
  maintenanceWindows = []
): WorkCenter {
  return {
    docId,
    docType: "workCenter",
    data: { name: docId, shifts, maintenanceWindows },
  };
}

function makeInput(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[]
): ReflowInput {
  return { workOrders, workCenters, manufacturingOrders: [] };
}

// ─── setup ───────────────────────────────────────────────────────────────────

let service: ReflowService;

beforeEach(() => {
  service = new ReflowService();
});

// ─── topologicalSort (private) ───────────────────────────────────────────────

describe("topologicalSort", () => {
  const sort = (orders: WorkOrder[]) =>
    (service as any).topologicalSort(orders) as WorkOrder[];

  it("returns a single order unchanged", () => {
    const wo = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    expect(sort([wo]).map((w) => w.docId)).toEqual(["wo-1"]);
  });

  it("orders a linear chain A → B → C correctly", () => {
    const woA = makeWO("wo-a", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const woB = makeWO("wo-b", "2025-01-06T09:00:00Z", "2025-01-06T10:00:00Z", {
      deps: ["wo-a"],
    });
    const woC = makeWO("wo-c", "2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z", {
      deps: ["wo-b"],
    });
    const sorted = sort([woC, woA, woB]);
    expect(sorted.map((w) => w.docId)).toEqual(["wo-a", "wo-b", "wo-c"]);
  });

  it("handles diamond pattern — both parents appear before the child", () => {
    const woA = makeWO("wo-a", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const woB = makeWO("wo-b", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const woC = makeWO("wo-c", "2025-01-06T09:00:00Z", "2025-01-06T10:00:00Z", {
      deps: ["wo-a", "wo-b"],
    });
    const sorted = sort([woC, woB, woA]);
    const idxA = sorted.findIndex((w) => w.docId === "wo-a");
    const idxB = sorted.findIndex((w) => w.docId === "wo-b");
    const idxC = sorted.findIndex((w) => w.docId === "wo-c");
    expect(idxA).toBeLessThan(idxC);
    expect(idxB).toBeLessThan(idxC);
  });

  it("returns all independent orders (no deps) without throwing", () => {
    const woA = makeWO("wo-a", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const woB = makeWO("wo-b", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const sorted = sort([woA, woB]);
    expect(sorted).toHaveLength(2);
  });

  it("throws on circular dependency", () => {
    const wo1 = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
      deps: ["wo-2"],
    });
    const wo2 = makeWO("wo-2", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
      deps: ["wo-1"],
    });
    expect(() => sort([wo1, wo2])).toThrow("Circular dependency");
  });
});

// ─── findEarliestFit (private) ───────────────────────────────────────────────

describe("findEarliestFit", () => {
  const fit = (
    earliestStart: DateTime,
    duration: number,
    intervals: Array<{ start: DateTime; end: DateTime }>,
    shifts = MON_FRI_SHIFTS,
    maintenanceWindows: any[] = []
  ) =>
    (service as any).findEarliestFit(
      earliestStart,
      duration,
      intervals,
      shifts,
      maintenanceWindows
    ) as { validStart: string; blockedBy: DateTime | undefined };

  const dt = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

  it("returns earliestStart when no intervals exist (already in shift)", () => {
    const result = fit(dt("2025-01-06T08:00:00Z"), 120, []);
    expect(result.validStart).toBe("2025-01-06T08:00:00.000Z");
    expect(result.blockedBy).toBeUndefined();
  });

  it("fits in the gap BEFORE a later interval (key gap-fitting behaviour)", () => {
    // maintenance-like interval 11:00-14:00
    const intervals = [
      { start: dt("2025-01-06T11:00:00Z"), end: dt("2025-01-06T14:00:00Z") },
    ];
    // earliest=08:00, duration=120min → candidateEnd=10:00, no overlap with [11-14]
    const result = fit(dt("2025-01-06T08:00:00Z"), 120, intervals);
    expect(result.validStart).toBe("2025-01-06T08:00:00.000Z");
    expect(result.blockedBy).toBeUndefined();
  });

  it("pushes past a conflicting interval", () => {
    const intervals = [
      { start: dt("2025-01-06T08:00:00Z"), end: dt("2025-01-06T10:00:00Z") },
    ];
    // earliest=08:00 conflicts with [08-10] → pushed to 10:00
    const result = fit(dt("2025-01-06T08:00:00Z"), 120, intervals);
    expect(result.validStart).toBe("2025-01-06T10:00:00.000Z");
    expect(result.blockedBy).toBeDefined();
  });

  it("pushes past multiple sequential intervals until a free gap is found", () => {
    const intervals = [
      { start: dt("2025-01-06T08:00:00Z"), end: dt("2025-01-06T10:00:00Z") },
      { start: dt("2025-01-06T10:00:00Z"), end: dt("2025-01-06T12:00:00Z") },
    ];
    // 08:00 conflicts → push to 10:00 → 10:00 conflicts → push to 12:00 → free
    const result = fit(dt("2025-01-06T08:00:00Z"), 60, intervals);
    expect(result.validStart).toBe("2025-01-06T12:00:00.000Z");
  });

  it("snaps to next shift start when earliestStart is outside shift hours", () => {
    const result = fit(dt("2025-01-06T17:30:00Z"), 60, []);
    // 17:30 is after shift → snap to Tue 08:00
    expect(result.validStart).toBe("2025-01-07T08:00:00.000Z");
  });
});

// ─── buildExplanation (private) ──────────────────────────────────────────────

describe("buildExplanation", () => {
  const explain = (changes: any[], totalDelay: number): string =>
    (service as any).buildExplanation(changes, totalDelay);

  it("returns no-changes message when changes list is empty", () => {
    expect(explain([], 0)).toBe(
      "No changes were necessary. The schedule was already valid."
    );
  });

  it("formats hours and minutes correctly (90 min → 1h 30m)", () => {
    const changes = [{ workOrderNumber: "WO-001" }];
    expect(explain(changes, 90)).toContain("1h 30m");
  });

  it("shows minutes only when total is less than 60 (45 min → 45m)", () => {
    const changes = [{ workOrderNumber: "WO-001" }];
    expect(explain(changes, 45)).toContain("45m");
  });

  it("includes the count of affected orders", () => {
    const changes = [
      { workOrderNumber: "WO-001" },
      { workOrderNumber: "WO-002" },
    ];
    expect(explain(changes, 120)).toContain("2 work order(s)");
  });

  it("lists all affected work order numbers", () => {
    const changes = [
      { workOrderNumber: "WO-001" },
      { workOrderNumber: "WO-002" },
    ];
    const msg = explain(changes, 120);
    expect(msg).toContain("WO-001");
    expect(msg).toContain("WO-002");
  });
});

// ─── buildReason (private) ───────────────────────────────────────────────────

describe("buildReason", () => {
  const reason = (
    wo: WorkOrder,
    resolvedMap: Map<string, ScheduledOrder>,
    centerFreeAt: DateTime | undefined,
    earliestStart: DateTime
  ): string =>
    (service as any).buildReason(wo, resolvedMap, centerFreeAt, earliestStart);

  const dt = (iso: string) => DateTime.fromISO(iso, { zone: "utc" });

  it("attributes delay to parent dependency", () => {
    const wo = makeWO("wo-2", "2025-01-06T10:00:00Z", "2025-01-06T11:00:00Z", {
      deps: ["wo-1"],
    });
    const parent = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T10:00:00Z");
    const resolvedMap = new Map<string, ScheduledOrder>([
      [
        "wo-1",
        {
          workOrder: parent,
          resolvedStartDate: "2025-01-06T08:00:00Z",
          resolvedEndDate: "2025-01-06T10:00:00Z",
        },
      ],
    ]);
    const msg = reason(wo, resolvedMap, undefined, dt("2025-01-06T10:00:00Z"));
    expect(msg).toContain('dependency on "WO-1"');
  });

  it("attributes delay to work center being busy", () => {
    const wo = makeWO("wo-2", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const msg = reason(
      wo,
      new Map(),
      dt("2025-01-06T12:00:00Z"),
      dt("2025-01-06T10:00:00Z")
    );
    expect(msg).toContain("work center busy until");
  });

  it("returns fallback message when no specific cause is detected", () => {
    const wo = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z");
    const msg = reason(wo, new Map(), undefined, dt("2025-01-06T08:00:00Z"));
    expect(msg).toBe(
      "Shifted to comply with shift boundaries or maintenance windows."
    );
  });

  it("includes both reasons when both parent and work center caused delay", () => {
    const wo = makeWO("wo-3", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
      deps: ["wo-1"],
    });
    const parent = makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T12:00:00Z");
    const resolvedMap = new Map<string, ScheduledOrder>([
      [
        "wo-1",
        {
          workOrder: parent,
          resolvedStartDate: "2025-01-06T08:00:00Z",
          resolvedEndDate: "2025-01-06T12:00:00Z",
        },
      ],
    ]);
    const msg = reason(
      wo,
      resolvedMap,
      dt("2025-01-06T12:00:00Z"),
      dt("2025-01-06T12:00:00Z")
    );
    expect(msg).toContain("dependency on");
    expect(msg).toContain("work center busy until");
  });
});

// ─── reflow — edge cases ──────────────────────────────────────────────────────

describe("reflow — edge cases", () => {
  it("throws when a work center ID referenced by a work order is not found", () => {
    const input = makeInput(
      [makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
        centerId: "wc-missing",
      })],
      []
    );
    expect(() => service.reflow(input)).toThrow("not found");
  });

  it("throws on circular dependency via reflow entry point", () => {
    const wc = makeWC("wc-1");
    const input = makeInput(
      [
        makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
          deps: ["wo-2"],
        }),
        makeWO("wo-2", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
          deps: ["wo-1"],
        }),
      ],
      [wc]
    );
    expect(() => service.reflow(input)).toThrow("Circular dependency");
  });

  it("returns empty changes and correct explanation when schedule is already valid", () => {
    const wc = makeWC("wc-1");
    const input = makeInput(
      [makeWO("wo-1", "2025-01-06T08:00:00Z", "2025-01-06T09:00:00Z", {
        durationMinutes: 60,
      })],
      [wc]
    );
    const result = service.reflow(input);
    expect(result.changes).toHaveLength(0);
    expect(result.explanation).toBe(
      "No changes were necessary. The schedule was already valid."
    );
  });

  it("locked (isMaintenance) orders are never included in changes", () => {
    const wc = makeWC("wc-1");
    const locked = makeWO(
      "wo-locked",
      "2025-01-06T08:00:00Z",
      "2025-01-06T10:00:00Z",
      { isMaintenance: true, durationMinutes: 120 }
    );
    const input = makeInput([locked], [wc]);
    const result = service.reflow(input);
    expect(result.changes.find((c) => c.workOrderId === "wo-locked")).toBeUndefined();
  });
});

// ─── reflow — Scenario 1: Delay Cascade ──────────────────────────────────────

describe("reflow — Scenario 1 (Delay Cascade)", () => {
  let result: ReturnType<typeof service.reflow>;

  beforeAll(() => {
    result = new ReflowService().reflow(scenario1);
  });

  it("produces exactly 2 changes (WO-002 and WO-003 move, WO-001 does not)", () => {
    expect(result.changes).toHaveLength(2);
  });

  it("WO-001 is not in changes — it came in already delayed, reflow did not move it", () => {
    expect(result.changes.find((c) => c.workOrderNumber === "WO-001")).toBeUndefined();
  });

  it("WO-002 is rescheduled to start at Mon 12:00 (after WO-001 ends)", () => {
    const change = result.changes.find((c) => c.workOrderNumber === "WO-002");
    expect(change?.newStartDate).toBe("2025-01-06T12:00:00.000Z");
    expect(change?.newEndDate).toBe("2025-01-06T13:30:00.000Z");
    expect(change?.delayMinutes).toBe(120);
  });

  it("WO-003 is rescheduled to start at Mon 13:30 (after WO-002 ends)", () => {
    const change = result.changes.find((c) => c.workOrderNumber === "WO-003");
    expect(change?.newStartDate).toBe("2025-01-06T13:30:00.000Z");
    expect(change?.newEndDate).toBe("2025-01-06T14:30:00.000Z");
    expect(change?.delayMinutes).toBe(120);
  });

  it("metrics: totalDelayMinutes=240, affected=2, unchanged=1", () => {
    expect(result.metrics?.totalDelayMinutes).toBe(240);
    expect(result.metrics?.affectedOrderCount).toBe(2);
    expect(result.metrics?.unchangedOrderCount).toBe(1);
  });
});

// ─── reflow — Scenario 2: Maintenance Conflict + Gap Fitting ─────────────────

describe("reflow — Scenario 2 (Maintenance + Gap Fitting)", () => {
  let result: ReturnType<typeof service.reflow>;

  beforeAll(() => {
    result = new ReflowService().reflow(scenario2);
  });

  it("WO-004 fits in the gap before maintenance and stays at Mon 08:00 (not pushed to 14:00)", () => {
    const wo004 = result.updatedWorkOrders.find(
      (wo) => wo.data.workOrderNumber === "WO-004"
    );
    expect(wo004?.data.startDate).toBe("2025-01-06T08:00:00.000Z");
    expect(wo004?.data.endDate).toBe("2025-01-06T10:00:00.000Z");
  });

  it("WO-004 is NOT recorded as a change", () => {
    expect(result.changes.find((c) => c.workOrderNumber === "WO-004")).toBeUndefined();
  });

  it("WO-005 is pushed past maintenance to Mon 14:00", () => {
    const change = result.changes.find((c) => c.workOrderNumber === "WO-005");
    expect(change?.newStartDate).toBe("2025-01-06T14:00:00.000Z");
    expect(change?.newEndDate).toBe("2025-01-06T16:00:00.000Z");
    expect(change?.delayMinutes).toBe(240);
  });

  it("WO-007 locked order is in updatedWorkOrders but not in changes", () => {
    const lockedInResult = result.updatedWorkOrders.find(
      (wo) => wo.data.workOrderNumber === "WO-007-MAINT"
    );
    expect(lockedInResult).toBeDefined();
    expect(lockedInResult?.data.startDate).toBe("2025-01-06T11:00:00.000Z");
    expect(result.changes.find((c) => c.workOrderNumber === "WO-007-MAINT")).toBeUndefined();
  });

  it("WO-006 start does not change (starts at Mon 16:00 as originally scheduled)", () => {
    expect(result.changes.find((c) => c.workOrderNumber === "WO-006")).toBeUndefined();
  });

  it("WO-006 end date is corrected to wrap across shift boundary to Tue 09:00", () => {
    const wo006 = result.updatedWorkOrders.find(
      (wo) => wo.data.workOrderNumber === "WO-006"
    );
    expect(wo006?.data.endDate).toBe("2025-01-07T09:00:00.000Z");
  });
});

// ─── reflow — Scenario 3: Diamond Dependencies + Breakdown ───────────────────

describe("reflow — Scenario 3 (Diamond + Breakdown)", () => {
  let result: ReturnType<typeof service.reflow>;

  beforeAll(() => {
    result = new ReflowService().reflow(scenario3);
  });

  it("produces exactly 2 changes (WO-011 and WO-012)", () => {
    expect(result.changes).toHaveLength(2);
  });

  it("WO-008, WO-009, WO-010 are NOT in changes", () => {
    const unchanged = ["WO-008", "WO-009", "WO-010"];
    unchanged.forEach((num) => {
      expect(result.changes.find((c) => c.workOrderNumber === num)).toBeUndefined();
    });
  });

  it("WO-009 end date is corrected to Tue 07:00 (540min crosses Line 2 shift boundary)", () => {
    const wo009 = result.updatedWorkOrders.find(
      (wo) => wo.data.workOrderNumber === "WO-009"
    );
    expect(wo009?.data.endDate).toBe("2025-01-07T07:00:00.000Z");
  });

  it("WO-011 is pushed to Mon 15:00 due to maintenance window (13:00-15:00)", () => {
    const change = result.changes.find((c) => c.workOrderNumber === "WO-011");
    expect(change?.newStartDate).toBe("2025-01-06T15:00:00.000Z");
    expect(change?.newEndDate).toBe("2025-01-06T16:30:00.000Z");
    expect(change?.delayMinutes).toBe(120);
  });

  it("WO-012 (assembly) waits for BOTH parents — WO-009 is the bottleneck (Tue 07:00 > Mon 16:30)", () => {
    const change = result.changes.find((c) => c.workOrderNumber === "WO-012-ASSEMBLY");
    // WO-009 ends Tue 07:00, shift starts Tue 08:00 → assembly starts Tue 08:00
    expect(change?.newStartDate).toBe("2025-01-07T08:00:00.000Z");
    expect(change?.newEndDate).toBe("2025-01-07T10:00:00.000Z");
    expect(change?.delayMinutes).toBe(1050);
  });

  it("WO-012 reason cites WO-009 as the cause (the last parent to finish)", () => {
    const change = result.changes.find((c) => c.workOrderNumber === "WO-012-ASSEMBLY");
    expect(change?.reason).toContain("WO-009");
  });

  it("metrics: totalDelayMinutes=1170, affected=2, unchanged=3", () => {
    expect(result.metrics?.totalDelayMinutes).toBe(1170);
    expect(result.metrics?.affectedOrderCount).toBe(2);
    expect(result.metrics?.unchangedOrderCount).toBe(3);
  });
});
