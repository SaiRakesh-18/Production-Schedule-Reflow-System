import { ReflowInput } from "../reflow/types";

// ============================================================
// SCENARIO 3: Complex — Multi-constraint + Multiple Parents
//
// Story:
//   Two separate production lines (Line 1 and Line 2) produce
//   components that are BOTH needed before final assembly (WO-012).
//   This is a "diamond" dependency pattern:
//
//         WO-008 (Line 1) ─┐
//                           ├──→ WO-012 (Assembly)
//         WO-009 (Line 2) ─┘
//
//   Additionally:
//   - Line 1 has a maintenance window Friday afternoon
//   - WO-010 on Line 1 gets delayed, pushing WO-011 and WO-012
//   - WO-012 has MULTIPLE parents (WO-010 AND WO-011 must both finish)
//   - WO-009 spans a weekend (shift gap Sat-Sun)
//
// Expected result:
//   - WO-008: runs normally Mon morning
//   - WO-009: starts Mon, spans shift boundary into Tuesday
//   - WO-010: delayed due to maintenance on Line 1
//   - WO-011: waits for WO-010 + work center conflict resolved
//   - WO-012: starts only after BOTH WO-010 AND WO-011 finish
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
            endDate: "2025-01-06T15:00:00.000Z",   // Mon 3PM
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
        // Line 2 has no maintenance windows
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
  ],

  workOrders: [
    {
      // WO-008: Line 1, Monday morning — runs fine before breakdown
      docId: "wo-008",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-008",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-line1",
        startDate: "2025-01-06T08:00:00.000Z", // Mon 8AM
        endDate: "2025-01-06T11:00:00.000Z",   // Mon 11AM (180 min)
        durationMinutes: 180,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-009: Line 2, starts Mon 6AM, 540 min (9 hours)
      // Line 2 shift is 6AM-2PM = 480 min/day
      // So 540 min spans into Tuesday: Mon 6AM→2PM (480min) + Tue 6AM→7AM (60min)
      docId: "wo-009",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-009",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-line2",
        startDate: "2025-01-06T06:00:00.000Z", // Mon 6AM
        endDate: "2025-01-06T15:00:00.000Z",   // Originally Mon 3PM (ignores shift)
        durationMinutes: 540,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-010: Line 1, planned Mon 11AM but hits maintenance window (1PM-3PM)
      // Must be pushed to after 3PM
      docId: "wo-010",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-010",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-line1",
        startDate: "2025-01-06T11:00:00.000Z", // Mon 11AM
        endDate: "2025-01-06T13:00:00.000Z",   // Originally Mon 1PM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-008"],      // Must wait for WO-008
      },
    },
    {
      // WO-011: Line 1, depends on WO-010
      // Will be pushed forward due to WO-010 delay
      docId: "wo-011",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-011",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-line1",
        startDate: "2025-01-06T13:00:00.000Z", // Originally Mon 1PM
        endDate: "2025-01-06T14:30:00.000Z",   // 90 min
        durationMinutes: 90,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-010"],
      },
    },
    {
      // WO-012: ASSEMBLY — depends on BOTH WO-011 (Line 1) AND WO-009 (Line 2)
      // This is the "diamond" pattern — must wait for the LAST of the two to finish
      docId: "wo-012",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-012-ASSEMBLY",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-assembly",
        startDate: "2025-01-06T14:30:00.000Z", // Originally Mon 2:30PM
        endDate: "2025-01-06T16:30:00.000Z",   // 120 min
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-011", "wo-009"], // BOTH must finish first
      },
    },
  ],

  manufacturingOrders: [
    {
      docId: "mo-003",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-003",
        itemId: "pipe-assembly-100mm",
        quantity: 200,
        dueDate: "2025-01-08T17:00:00.000Z", // Due Wednesday 5PM
      },
    },
  ],
};