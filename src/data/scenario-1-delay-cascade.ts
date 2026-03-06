import { ReflowInput } from "../reflow/types";

// ============================================================
// SCENARIO 1: Delay Cascade
//
// Story:
//   A factory produces plastic pipes through a 5-step pipeline
//   across 5 dedicated work centers:
//
//   WO-001 (Extrude) → WO-002 (Cool) → WO-003 (Inspect)
//                                          → WO-004 (Cut) → WO-005 (Label)
//
//   WO-001 was originally scheduled Mon 8AM-10AM (120 min).
//   Due to a machine issue, it now starts late at Mon 10AM.
//   This cascades through all downstream steps.
//
//   WO-006 runs independently on Extrusion Line 1 (no deps) — unaffected.
//
// Expected result after reflow:
//   WO-001: Mon 10:00 → Mon 12:00  (came in delayed — not moved by reflow)
//   WO-002: Mon 12:00 → Mon 13:30  (delay +120 min)
//   WO-003: Mon 13:30 → Mon 14:30  (delay +120 min)
//   WO-004: Mon 14:30 → Mon 15:15  (delay +120 min)
//   WO-005: Mon 15:15 → Mon 15:45  (delay +120 min)
//   WO-006: Mon 14:00 → Mon 15:00  (unchanged — independent order)
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
        name: "Quality Inspection",
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
      // NEW: downstream cutting step
      docId: "wc-004",
      docType: "workCenter",
      data: {
        name: "Cutting & Trimming",
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
      // NEW: final labeling step
      docId: "wc-005",
      docType: "workCenter",
      data: {
        name: "Labeling Station",
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
        endDate:   "2025-01-06T12:00:00.000Z", // Monday 12PM
        durationMinutes: 120,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
      },
    },
    {
      // WO-002: Cooling — depends on WO-001, must wait for extrusion to finish
      docId: "wo-002",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-002",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-002",
        startDate: "2025-01-06T10:00:00.000Z", // Originally planned Mon 10AM
        endDate:   "2025-01-06T11:30:00.000Z", // 90 min
        durationMinutes: 90,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-001"],
      },
    },
    {
      // WO-003: Quality Inspection — depends on WO-002
      docId: "wo-003",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-003",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-003",
        startDate: "2025-01-06T11:30:00.000Z", // Originally planned Mon 11:30AM
        endDate:   "2025-01-06T12:30:00.000Z", // 60 min
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-002"],
      },
    },
    {
      // WO-004 (NEW): Cutting — depends on WO-003
      // Originally planned Mon 12:30, pushed to Mon 14:30 by cascade (+120 min)
      docId: "wo-004",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-004",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-004",
        startDate: "2025-01-06T12:30:00.000Z", // Originally planned Mon 12:30
        endDate:   "2025-01-06T13:15:00.000Z", // 45 min
        durationMinutes: 45,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-003"],
      },
    },
    {
      // WO-005 (NEW): Labeling — depends on WO-004, final step of main pipeline
      // Originally planned Mon 13:15, pushed to Mon 15:15 by cascade (+120 min)
      docId: "wo-005",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-005",
        manufacturingOrderId: "mo-001",
        workCenterId: "wc-005",
        startDate: "2025-01-06T13:15:00.000Z", // Originally planned Mon 13:15
        endDate:   "2025-01-06T13:45:00.000Z", // 30 min
        durationMinutes: 30,
        isMaintenance: false,
        dependsOnWorkOrderIds: ["wo-004"],
      },
    },
    {
      // WO-006 (NEW): Independent spare-parts batch on Extrusion Line 1
      // No dependencies — runs Mon 14:00-15:00, completely unaffected by cascade
      docId: "wo-006",
      docType: "workOrder",
      data: {
        workOrderNumber: "WO-006",
        manufacturingOrderId: "mo-002",
        workCenterId: "wc-001",
        startDate: "2025-01-06T14:00:00.000Z", // Mon 14:00 — no conflict with WO-001 (ends 12:00)
        endDate:   "2025-01-06T15:00:00.000Z", // Mon 15:00
        durationMinutes: 60,
        isMaintenance: false,
        dependsOnWorkOrderIds: [],
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
    {
      // NEW: separate manufacturing order for the spare-parts batch (WO-006)
      docId: "mo-002",
      docType: "manufacturingOrder",
      data: {
        manufacturingOrderNumber: "MO-002",
        itemId: "spare-parts-kit",
        quantity: 100,
        dueDate: "2025-01-07T12:00:00.000Z", // Due Tuesday noon
      },
    },
  ],
};
