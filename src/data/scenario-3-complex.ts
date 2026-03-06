import { ReflowInput } from "../reflow/types";

// ============================================================
// SCENARIO 3: Complex — Diamond Dependencies + Breakdown + Finishing Chain
//
// Story:
//   Two separate production lines (Line 1 and Line 2) produce
//   components that are BOTH needed before final assembly (WO-012).
//   After assembly, the product goes through a finishing line
//   and a quality control check before dispatch.
//
//   Full dependency graph:
//
//     WO-008 (Line 1)──→ WO-010 (Line 1) ──→ WO-011 (Line 1) ─┐
//                                                                ├──→ WO-012 (Assembly) ──→ WO-013 (Finishing) ──→ WO-014 (QC)
//     WO-009 (Line 2) ─────────────────────────────────────────┘
//
//     WO-015 (Finishing) — independent spare run, no deps
//
//   Constraints:
//   - Line 1 has a breakdown Mon 13:00-15:00
//   - Line 2 shift is 6AM-2PM; WO-009 (540 min) spans into Tuesday
//   - WO-012 must wait for BOTH WO-011 AND WO-009 (diamond pattern)
//   - Quality Control (wc-qc) has maintenance Tue 09:00-10:00
//
// Expected result after reflow:
//   WO-008: Mon 08:00 → Mon 11:00  (unchanged)
//   WO-009: Mon 06:00 → Tue 07:00  (unchanged start, end corrected across shift)
//   WO-010: Mon 11:00 → Mon 13:00  (unchanged — fits before breakdown)
//   WO-011: Mon 15:00 → Mon 16:30  (delay +120 min — blocked by breakdown)
//   WO-012: Tue 08:00 → Tue 10:00  (delay +1050 min — WO-009 is bottleneck)
//   WO-013: Tue 10:00 → Tue 11:00  (delay +1050 min — depends on WO-012)
//   WO-014: Tue 11:00 → Tue 11:45  (delay +180 min — depends on WO-013)
//   WO-015: Mon 08:00 → Mon 09:00  (unchanged — independent)
// ============================================================

export const scenario3: ReflowInput = {
  workCenters: [
    {
      docId: "wc-line1",
      docType: "workCenter",
      data: {
        name: "Extrusion Line 1",
        shifts: [
          { dayOfWeek: 1, startHour: 8, endHour: 17 }, // Monday
          { dayOfWeek: 2, startHour: 8, endHour: 17 }, // Tuesday
          { dayOfWeek: 3, startHour: 8, endHour: 17 }, // Wednesday
          { dayOfWeek: 4, startHour: 8, endHour: 17 }, // Thursday
          { dayOfWeek: 5, startHour: 8, endHour: 17 }, // Friday
        ],
        maintenanceWindows: [
          {
            // Unplanned breakdown Monday afternoon
            startDate: "2025-01-06T13:00:00.000Z", // Mon 1PM
            endDate:   "2025-01-06T15:00:00.000Z", // Mon 3PM
            reason: "Unplanned breakdown — screw drive failure",
          },
        ],
      },
    },
    {
      docId: "wc-line2",
      docType: "workCenter",
      data: {
        name: "Extrusion Line 2",
        shifts: [
          { dayOfWeek: 1, startHour: 6, endHour: 14 },  // Monday   6AM-2PM
          { dayOfWeek: 2, startHour: 6, endHour: 14 },  // Tuesday  6AM-2PM
          { dayOfWeek: 3, startHour: 6, endHour: 14 },  // Wednesday
          { dayOfWeek: 4, startHour: 6, endHour: 14 },  // Thursday
          { dayOfWeek: 5, startHour: 6, endHour: 14 },  // Friday
        ],
        maintenanceWindows: [],
      },
    },
    {
      docId: "wc-assembly",
      docType: "workCenter",
      data: {
        name: "Assembly Station",
        shifts: [
          { dayOfWeek: 1, startHour: 8, endHour: 17 },
          { dayOfWeek: 2, startHour: 8, endHour: 17 },
          { dayOfWeek: 3, startHour: 8, endHour: 17 },
          { dayOfWeek: 4, startHour: 8, endHour: 17 },
          { dayOfWeek: 5, startHour: 8, endHour: 17 },
        ],
        maintenanceWindows: [],
      },
    },
    {
      // NEW: downstream finishing line — used by WO-013 and WO-015
      docId: "wc-finishing",
      docType: "workCenter",
      data: {
        name: "Finishing Line",
        shifts: [
          { dayOfWeek: 1, startHour: 8, endHour: 17 },
          { dayOfWeek: 2, startHour: 8, endHour: 17 },
          { dayOfWeek: 3, startHour: 8, endHour: 17 },
          { dayOfWeek: 4, startHour: 8, endHour: 17 },
          { dayOfWeek: 5, startHour: 8, endHour: 17 },
        ],
        maintenanceWindows: [],
      },
    },
    {
      // NEW: quality control — has its own maintenance Tue 09:00-10:00
      docId: "wc-qc",
      docType: "workCenter",
      data: {
        name: "Quality Control",
        shifts: [
          { dayOfWeek: 1, startHour: 8, endHour: 17 },
          { dayOfWeek: 2, startHour: 8, endHour: 17 },
          { dayOfWeek: 3, startHour: 8, endHour: 17 },
          { dayOfWeek: 4, startHour: 8, endHour: 17 },
          { dayOfWeek: 5, startHour: 8, endHour: 17 },
        ],
        maintenanceWindows: [
          {
            startDate: "2025-01-07T09:00:00.000Z", // Tue 9AM
            endDate:   "2025-01-07T10:00:00.000Z", // Tue 10AM
            reason: "Weekly calibration of measurement tools",
          },
        ],
      },
    },
  ],

  workOrders: [
    {
      // WO-008: Line 1, Monday morning — runs fine before breakdown
      docId: "wo-008",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-008",
        manufacturingOrderId: "mo-004",
        workCenterId: "wc-line1",
        startDate: "2025-01-06T08:00:00.000Z", // Mon 8AM
        endDate:   "2025-01-06T11:00:00.000Z", // Mon 11AM (180 min)
        durationMinutes: 180,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-009: Line 2, starts Mon 6AM, 540 min (9 hours)
      // Line 2 shift is 6AM-2PM = 480 min/day
      // 540 min spans into Tuesday: Mon 6AM→2PM (480 min) + Tue 6AM→7AM (60 min)
      docId: "wo-009",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-009",
        manufacturingOrderId: "mo-004",
        workCenterId: "wc-line2",
        startDate: "2025-01-06T06:00:00.000Z", // Mon 6AM
        endDate:   "2025-01-06T15:00:00.000Z", // Originally Mon 3PM (ignores shift boundary)
        durationMinutes: 540,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-010: Line 1, planned Mon 11AM — depends on WO-008
      // 120 min starting 11:00 → ends 13:00 (just before breakdown at 13:00) — unchanged
      docId: "wo-010",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-010",
        manufacturingOrderId: "mo-004",
        workCenterId: "wc-line1",
        startDate: "2025-01-06T11:00:00.000Z", // Mon 11AM
        endDate:   "2025-01-06T13:00:00.000Z", // Mon 1PM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-008"],
      },
    },
    {
      // WO-011: Line 1, depends on WO-010
      // Originally Mon 13:00, but breakdown starts 13:00 → pushed to Mon 15:00
      docId: "wo-011",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-011",
        manufacturingOrderId: "mo-004",
        workCenterId: "wc-line1",
        startDate: "2025-01-06T13:00:00.000Z", // Originally Mon 1PM
        endDate:   "2025-01-06T14:30:00.000Z", // 90 min
        durationMinutes: 90,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-010"],
      },
    },
    {
      // WO-012: ASSEMBLY — diamond pattern — depends on BOTH WO-011 AND WO-009
      // WO-011 ends Mon 16:30 | WO-009 ends Tue 07:00 → max = Tue 07:00
      // Shift starts Tue 08:00 → assembly begins Tue 08:00
      docId: "wo-012",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-012-ASSEMBLY",
        manufacturingOrderId: "mo-004",
        workCenterId: "wc-assembly",
        startDate: "2025-01-06T14:30:00.000Z", // Originally Mon 2:30PM
        endDate:   "2025-01-06T16:30:00.000Z", // 120 min
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-011", "wo-009"], // BOTH must finish first
      },
    },
    {
      // WO-013 (NEW): Finishing — depends on WO-012
      // WO-012 ends Tue 10:00 → WO-013 starts Tue 10:00 (delay +1050 min vs original Mon 16:30)
      docId: "wo-013",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-013",
        manufacturingOrderId: "mo-005",
        workCenterId: "wc-finishing",
        startDate: "2025-01-06T16:30:00.000Z", // Originally Mon 4:30PM (right after old WO-012)
        endDate:   "2025-01-06T17:30:00.000Z", // 60 min (outside shift — reflow will correct)
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-012"],
      },
    },
    {
      // WO-014 (NEW): Quality Control check — depends on WO-013
      // WO-013 ends Tue 11:00. wc-qc maintenance Tue 09:00-10:00 is already past → no issue
      // Originally planned Tue 08:00, pushed to Tue 11:00 (delay +180 min)
      docId: "wo-014",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-014",
        manufacturingOrderId: "mo-005",
        workCenterId: "wc-qc",
        startDate: "2025-01-07T08:00:00.000Z", // Originally Tue 8AM
        endDate:   "2025-01-07T08:45:00.000Z", // 45 min
        durationMinutes: 45,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-013"],
      },
    },
    {
      // WO-015 (NEW): Independent spare-parts finishing run — no deps, no conflicts
      // Mon 08:00-09:00 on Finishing Line, well before WO-013 arrives (Tue 10:00)
      docId: "wo-015",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-015",
        manufacturingOrderId: "mo-005",
        workCenterId: "wc-finishing",
        startDate: "2025-01-06T08:00:00.000Z", // Mon 8AM
        endDate:   "2025-01-06T09:00:00.000Z", // Mon 9AM
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
  ],

  manufacturingOrders: [
    {
      docId: "mo-004",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-004",
        itemId: "pipe-assembly-100mm",
        quantity: 200,
        dueDate: "2025-01-08T17:00:00.000Z", // Due Wednesday 5PM
      },
    },
    {
      // NEW: manufacturing order for finishing and QC steps
      docId: "mo-005",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-005",
        itemId: "finished-assembly-100mm",
        quantity: 200,
        dueDate: "2025-01-09T17:00:00.000Z", // Due Thursday 5PM
      },
    },
  ],
};
