import { ReflowInput } from "../reflow/types";

// ============================================================
// SCENARIO 2: Maintenance Window Conflict + Shift Boundary
//
// Story:
//   Three work centers are active this week.
//   Extrusion Line 1 (wc-001) has a planned maintenance window
//   Mon 11AM-2PM. Cooling Station (wc-002) and Quality Lab
//   (wc-003) are also in use.
//
//   Key behaviours demonstrated:
//   - WO-004: fits in the gap BEFORE maintenance → unchanged (gap-fitting)
//   - WO-005: conflicts with maintenance → pushed past 2PM (delay +240 min)
//   - WO-006: depends on WO-005, spans shift boundary Mon→Tue (unchanged start)
//   - WO-007-MAINT: locked maintenance block — never moved
//   - WO-008 (NEW): depends on WO-006, runs on Cooling Station
//                   pushed to Tue 09:00 because WO-006 ends Tue 09:00 (delay +60 min)
//   - WO-009 (NEW): independent order on Quality Lab Mon 09:00 → unchanged
//   - WO-010 (NEW): independent order on Cooling Station Mon 10:00 → unchanged
//
// Expected result after reflow:
//   WO-004: Mon 08:00 → Mon 10:00  (unchanged — fits before maintenance)
//   WO-005: Mon 14:00 → Mon 16:00  (delay +240 min)
//   WO-006: Mon 16:00 → Tue 09:00  (unchanged start, end corrected across shift)
//   WO-007: Mon 11:00 → Mon 14:00  (LOCKED, never moved)
//   WO-008: Tue 09:00 → Tue 10:30  (delay +60 min — waits for WO-006)
//   WO-009: Mon 09:00 → Mon 10:00  (unchanged — independent)
//   WO-010: Mon 10:00 → Mon 11:00  (unchanged — independent, different center)
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
            // Planned maintenance during lunch hours on Monday
            startDate: "2025-01-06T11:00:00.000Z", // Mon 11AM
            endDate:   "2025-01-06T14:00:00.000Z", // Mon 2PM
            reason: "Scheduled lubrication and calibration",
          },
        ],
      },
    },
    {
      // NEW: downstream cooling station — used by WO-008 and WO-010
      docId: "wc-002",
      docType: "workCenter",
      data: {
        name: "Cooling Station",
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
      // NEW: quality lab — shift starts at 9AM, maintenance Mon 15:00-16:00
      docId: "wc-003",
      docType: "workCenter",
      data: {
        name: "Quality Lab",
        shifts: [
          { dayOfWeek: 1, startHour: 9, endHour: 18 },
          { dayOfWeek: 2, startHour: 9, endHour: 18 },
          { dayOfWeek: 3, startHour: 9, endHour: 18 },
          { dayOfWeek: 4, startHour: 9, endHour: 18 },
          { dayOfWeek: 5, startHour: 9, endHour: 18 },
        ],
        maintenanceWindows: [
          {
            startDate: "2025-01-06T15:00:00.000Z", // Mon 3PM
            endDate:   "2025-01-06T16:00:00.000Z", // Mon 4PM
            reason: "Weekly instrument calibration",
          },
        ],
      },
    },
  ],

  workOrders: [
    {
      // WO-004: Runs before maintenance — no conflict (gap-fitting keeps it at 08:00)
      docId: "wo-004",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-004",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T08:00:00.000Z", // Mon 8AM
        endDate:   "2025-01-06T10:00:00.000Z", // Mon 10AM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-005: Originally Mon 10AM but conflicts with maintenance (11AM-2PM)
      // Must be pushed to after 2PM → starts Mon 14:00
      docId: "wo-005",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-005",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T10:00:00.000Z", // Mon 10AM — conflicts with maintenance
        endDate:   "2025-01-06T12:00:00.000Z", // Originally Mon 12PM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-006: Depends on WO-005, spans shift boundary Mon→Tue
      // 120 min from Mon 16:00 → shift ends 17:00 (60 min done)
      // Resumes Tue 08:00 → completes Tue 09:00
      docId: "wo-006",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-006",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T16:00:00.000Z", // Mon 4PM
        endDate:   "2025-01-06T18:00:00.000Z", // Originally Mon 6PM (invalid — outside shift)
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-005"],
      },
    },
    {
      // WO-007: Fixed maintenance task — CANNOT be moved (isMaintenance = true)
      docId: "wo-007",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-007-MAINT",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T11:00:00.000Z", // Mon 11AM
        endDate:   "2025-01-06T14:00:00.000Z", // Mon 2PM
        durationMinutes: 180,
        isMaintenance: true,                    // Locked — cannot reschedule
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-008 (NEW): Depends on WO-006, runs on Cooling Station
      // WO-006 ends Tue 09:00 → WO-008 pushed from Tue 08:00 to Tue 09:00 (delay +60 min)
      docId: "wo-008",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-008",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-002",
        startDate: "2025-01-07T08:00:00.000Z", // Originally Tue 8AM
        endDate:   "2025-01-07T09:30:00.000Z", // 90 min
        durationMinutes: 90,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-006"],      // Must wait for WO-006 to finish
      },
    },
    {
      // WO-009 (NEW): Independent quality sample on Quality Lab — no conflicts
      // Runs Mon 09:00-10:00, unaffected by anything on wc-001
      docId: "wo-009",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-009",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-003",
        startDate: "2025-01-06T09:00:00.000Z", // Mon 9AM (shift start on wc-003)
        endDate:   "2025-01-06T10:00:00.000Z", // Mon 10AM
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-010 (NEW): Independent cooling run on Cooling Station — no conflicts
      // Runs Mon 10:00-11:00, completely separate from the wc-001 chain
      docId: "wo-010",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-010",
        manufacturingOrderId: "mo-003",
        workCenterId: "wc-002",
        startDate: "2025-01-06T10:00:00.000Z", // Mon 10AM
        endDate:   "2025-01-06T11:00:00.000Z", // Mon 11AM
        durationMinutes: 60,
        isMaintenance: false,
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
    {
      // NEW: separate manufacturing order for quality and cooling samples
      docId: "mo-003",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-003",
        itemId: "quality-sample-kit",
        quantity: 50,
        dueDate: "2025-01-06T16:00:00.000Z", // Due Monday 4PM
      },
    },
  ],
};
