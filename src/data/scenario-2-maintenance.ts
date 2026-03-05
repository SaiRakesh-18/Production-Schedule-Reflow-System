import { ReflowInput } from "../reflow/types";

// ============================================================
// SCENARIO 2: Maintenance Window Conflict + Shift Boundary
//
// Story:
//   Two work orders are scheduled on the same extrusion line.
//   WO-004 runs fine. But WO-005 is scheduled right when the
//   machine goes into a maintenance window (lunch break servicing).
//   Also WO-006 spans across end of shift — must pause and resume.
//
// Expected result:
//   WO-004: Mon 8:00  → Mon 10:00  (unchanged)
//   WO-005: Pushed past maintenance → Mon 14:00 → Mon 16:00
//   WO-006: Starts Mon 16:00, shift ends 17:00 (60 min done)
//           Pauses → resumes Tue 8:00 → completes Tue 9:00
// ============================================================

export const scenario2: ReflowInput = {
  workCenters: [
    {
      docId: "wc-001",
      docType: "workCenter",
      data: {
        name: "Extrusion Line 1",
        shifts: [
          { dayOfWeek: 1, startHour: 8, endHour: 17 },  // Monday
          { dayOfWeek: 2, startHour: 8, endHour: 17 },  // Tuesday
          { dayOfWeek: 3, startHour: 8, endHour: 17 },  // Wednesday
          { dayOfWeek: 4, startHour: 8, endHour: 17 },  // Thursday
          { dayOfWeek: 5, startHour: 8, endHour: 17 },  // Friday
        ],
        maintenanceWindows: [
          {
            // Planned maintenance during lunch hours every Monday
            startDate: "2025-01-06T11:00:00.000Z", // Mon 11AM
            endDate: "2025-01-06T14:00:00.000Z",   // Mon 2PM
            reason: "Scheduled lubrication and calibration",
          },
        ],
      },
    },
  ],

  workOrders: [
    {
      // WO-004: Runs before maintenance — no conflict
      docId: "wo-004",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-004",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T08:00:00.000Z", // Mon 8AM
        endDate: "2025-01-06T10:00:00.000Z",   // Mon 10AM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-005: Originally Mon 10AM but conflicts with maintenance (11AM-2PM)
      // Must be pushed to after 2PM
      docId: "wo-005",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-005",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T10:00:00.000Z", // Mon 10AM — conflicts with maintenance
        endDate: "2025-01-06T12:00:00.000Z",   // Originally Mon 12PM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-006: Scheduled after WO-005, will span across shift boundary
      // 120 min starting Mon 4PM → shift ends 5PM (60 min done)
      // Must pause → resume Tue 8AM → complete Tue 9AM
      docId: "wo-006",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-006",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T16:00:00.000Z", // Mon 4PM
        endDate: "2025-01-06T18:00:00.000Z",   // Originally Mon 6PM (invalid — outside shift)
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-005"],
      },
    },
    {
      // WO-007: Fixed maintenance task — CANNOT be moved
      docId: "wo-007",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-007-MAINT",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T11:00:00.000Z", // Mon 11AM
        endDate: "2025-01-06T14:00:00.000Z",   // Mon 2PM
        durationMinutes: 180,
        isMaintenance: true,                    // Locked — cannot reschedule
        dependsOnWorkOrderIds: [],
      },
    },
  ],

  manufacturingOrders: [
    {
      docId: "mo-002",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-002",
        itemId: "pipe-50mm",
        quantity: 300,
        dueDate: "2025-01-07T17:00:00.000Z", // Due Tuesday 5PM
      },
    },
  ],
};