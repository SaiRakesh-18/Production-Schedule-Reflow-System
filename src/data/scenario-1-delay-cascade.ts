import { ReflowInput } from "../reflow/types";

// ============================================================
// SCENARIO 1: Delay Cascade
//
// Story:
//   A factory produces plastic pipes in 3 steps:
//   WO-001 (Extrude) → WO-002 (Cool) → WO-003 (Package)
//
//   WO-001 was originally scheduled Mon 8AM-10AM (120 min).
//   Due to a machine issue, it now starts late at Mon 10AM.
//   This cascades: WO-002 and WO-003 must also shift forward.
//
// Expected result:
//   WO-001: Mon 10:00 → Mon 12:00
//   WO-002: Mon 12:00 → Mon 13:30
//   WO-003: Mon 13:30 → Mon 14:30
// ============================================================

export const scenario1: ReflowInput = {
  workCenters: [
    {
      docId: "wc-001",
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
        maintenanceWindows: [],
      },
    },
    {
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
      docId: "wc-003",
      docType: "workCenter",
      data: {
        name: "Packaging Unit",
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
      // WO-001: Delayed start — triggers the cascade
      docId: "wo-001",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-001",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-001",
        startDate: "2025-01-06T10:00:00.000Z", // Monday 10AM (delayed from 8AM)
        endDate: "2025-01-06T12:00:00.000Z",   // Monday 12PM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-002: Depends on WO-001 — must wait for extrusion to finish
      docId: "wo-002",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-002",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-002",
        startDate: "2025-01-06T10:00:00.000Z", // Originally planned Mon 10AM
        endDate: "2025-01-06T11:30:00.000Z",   // 90 min duration
        durationMinutes: 90,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-001"],      // Can't start until WO-001 done
      },
    },
    {
      // WO-003: Depends on WO-002 — end of the chain
      docId: "wo-003",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-003",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-003",
        startDate: "2025-01-06T11:30:00.000Z", // Originally planned Mon 11:30AM
        endDate: "2025-01-06T12:30:00.000Z",   // 60 min duration
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-002"],      // Can't start until WO-002 done
      },
    },
  ],

  manufacturingOrders: [
    {
      docId: "mo-001",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-001",
        itemId: "pipe-32mm",
        quantity: 500,
        dueDate: "2025-01-06T17:00:00.000Z", // Due Monday 5PM
      },
    },
  ],
};