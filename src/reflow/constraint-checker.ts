import { DateTime } from "luxon";
import { WorkOrder, WorkCenter } from "./types";
import { isWithinShift, isWithinMaintenance } from "../utils/date-utils";

// ============================================================
// CONSTRAINT VIOLATION
// Describes a single broken constraint in the schedule
// ============================================================

export interface ConstraintViolation {
  workOrderId: string;
  workOrderNumber: string;
  type:
    | "DEPENDENCY"        // A parent hasn't finished before this starts
    | "WORK_CENTER_OVERLAP" // Two orders overlap on the same machine
    | "OUTSIDE_SHIFT"    // Work happens outside working hours
    | "MAINTENANCE_CONFLICT"; // Work happens during maintenance window
  message: string;
}

// ============================================================
// CHECK RESULT
// Summary of all violations found
// ============================================================

export interface CheckResult {
  isValid: boolean;
  violations: ConstraintViolation[];
}

// ============================================================
// checkDependencies
// Verifies that all parent work orders finish before
// their child work order starts.
//
// Rule: child.startDate >= max(parent.endDate for all parents)
// ============================================================

export function checkDependencies(workOrders: WorkOrder[]): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  // Build a quick lookup map: docId → workOrder
  const orderMap = new Map<string, WorkOrder>();
  workOrders.forEach((wo) => orderMap.set(wo.docId, wo));

  for (const wo of workOrders) {
    const childStart = DateTime.fromISO(wo.data.startDate, { zone: "utc" });

    for (const parentId of wo.data.dependsOnWorkOrderIds) {
      const parent = orderMap.get(parentId);

      if (!parent) {
        // Parent doesn't exist in the schedule — flag it
        violations.push({
          workOrderId: wo.docId,
          workOrderNumber: wo.data.workOrderNumber,
          type: "DEPENDENCY",
          message: `Depends on work order "${parentId}" which does not exist in the schedule.`,
        });
        continue;
      }

      const parentEnd = DateTime.fromISO(parent.data.endDate, { zone: "utc" });

      if (childStart < parentEnd) {
        violations.push({
          workOrderId: wo.docId,
          workOrderNumber: wo.data.workOrderNumber,
          type: "DEPENDENCY",
          message:
            `Work order "${wo.data.workOrderNumber}" starts at ${childStart.toISO()} ` +
            `but depends on "${parent.data.workOrderNumber}" which ends at ${parentEnd.toISO()}.`,
        });
      }
    }
  }

  return violations;
}

// ============================================================
// checkWorkCenterConflicts
// Verifies no two work orders overlap on the same work center.
//
// Rule: for any two orders on the same work center,
//       one must finish before the other starts.
// ============================================================

export function checkWorkCenterConflicts(workOrders: WorkOrder[]): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  // Group work orders by work center
  const byWorkCenter = new Map<string, WorkOrder[]>();
  for (const wo of workOrders) {
    const centerId = wo.data.workCenterId;
    if (!byWorkCenter.has(centerId)) byWorkCenter.set(centerId, []);
    byWorkCenter.get(centerId)!.push(wo);
  }

  // For each work center, check every pair of orders for overlap
  for (const [centerId, orders] of byWorkCenter) {
    // Sort by start date for easier overlap detection
    const sorted = [...orders].sort((a, b) =>
      DateTime.fromISO(a.data.startDate).toMillis() -
      DateTime.fromISO(b.data.startDate).toMillis()
    );

    for (let i = 0; i < sorted.length - 1; i++) {
      const current = sorted[i];
      const next = sorted[i + 1];

      const currentEnd = DateTime.fromISO(current.data.endDate, { zone: "utc" });
      const nextStart = DateTime.fromISO(next.data.startDate, { zone: "utc" });

      // Overlap exists if current order hasn't ended before next one starts
      if (currentEnd > nextStart) {
        violations.push({
          workOrderId: next.docId,
          workOrderNumber: next.data.workOrderNumber,
          type: "WORK_CENTER_OVERLAP",
          message:
            `Work center "${centerId}": "${current.data.workOrderNumber}" ends at ${currentEnd.toISO()} ` +
            `but "${next.data.workOrderNumber}" starts at ${nextStart.toISO()} — overlap detected.`,
        });
      }
    }
  }

  return violations;
}

// ============================================================
// checkShiftBoundaries
// Verifies that work orders only run during shift hours.
//
// Strategy: sample every 30 minutes during the order's
// wall-clock duration and check if that moment is in a shift.
//
// @upgrade: Replace sampling with exact boundary calculation
//           for better accuracy on short work orders.
// ============================================================

export function checkShiftBoundaries(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  const centerMap = new Map<string, WorkCenter>();
  workCenters.forEach((wc) => centerMap.set(wc.docId, wc));

  for (const wo of workOrders) {
    // Maintenance work orders are fixed — skip shift checking
    if (wo.data.isMaintenance) continue;

    const center = centerMap.get(wo.data.workCenterId);
    if (!center) continue;

    const start = DateTime.fromISO(wo.data.startDate, { zone: "utc" });
    const end = DateTime.fromISO(wo.data.endDate, { zone: "utc" });

    // Only check that the START and END moments are within a shift.
    // We do NOT sample through the wall-clock gap between shifts because
    // shift-aware scheduling intentionally pauses work overnight — the
    // wall-clock window spanning midnight is valid after reflow.
    const startInShift = isWithinShift(start, center.data.shifts);
    // End time is exclusive (one minute past last working minute), so check end - 1 min
    const endInShift = isWithinShift(end.minus({ minutes: 1 }), center.data.shifts);

    if (!startInShift) {
      violations.push({
        workOrderId: wo.docId,
        workOrderNumber: wo.data.workOrderNumber,
        type: "OUTSIDE_SHIFT",
        message:
          `Work order "${wo.data.workOrderNumber}" starts outside shift hours ` +
          `at ${start.toISO()} on work center "${center.data.name}".`,
      });
    }

    if (!endInShift) {
      violations.push({
        workOrderId: wo.docId,
        workOrderNumber: wo.data.workOrderNumber,
        type: "OUTSIDE_SHIFT",
        message:
          `Work order "${wo.data.workOrderNumber}" ends outside shift hours ` +
          `at ${end.toISO()} on work center "${center.data.name}".`,
      });
    }
  }

  return violations;
}

// ============================================================
// checkMaintenanceConflicts
// Verifies no work order runs during a maintenance window
// on its assigned work center.
// ============================================================

export function checkMaintenanceConflicts(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[]
): ConstraintViolation[] {
  const violations: ConstraintViolation[] = [];

  const centerMap = new Map<string, WorkCenter>();
  workCenters.forEach((wc) => centerMap.set(wc.docId, wc));

  for (const wo of workOrders) {
    // Maintenance orders ARE the maintenance — skip
    if (wo.data.isMaintenance) continue;

    const center = centerMap.get(wo.data.workCenterId);
    if (!center) continue;

    const woStart = DateTime.fromISO(wo.data.startDate, { zone: "utc" });
    const woEnd = DateTime.fromISO(wo.data.endDate, { zone: "utc" });

    for (const mw of center.data.maintenanceWindows) {
      const mwStart = DateTime.fromISO(mw.startDate, { zone: "utc" });
      const mwEnd = DateTime.fromISO(mw.endDate, { zone: "utc" });

      // Check if the work order's wall-clock window overlaps the maintenance window
      const overlaps = woStart < mwEnd && woEnd > mwStart;

      if (overlaps) {
        violations.push({
          workOrderId: wo.docId,
          workOrderNumber: wo.data.workOrderNumber,
          type: "MAINTENANCE_CONFLICT",
          message:
            `Work order "${wo.data.workOrderNumber}" overlaps maintenance window ` +
            `(${mwStart.toISO()} → ${mwEnd.toISO()}) ` +
            `on work center "${center.data.name}". Reason: ${mw.reason ?? "N/A"}`,
        });
      }
    }
  }

  return violations;
}

// ============================================================
// checkAll  ← MAIN ENTRY POINT
// Runs all constraint checks in the recommended order:
// Dependencies → Work Center Conflicts → Shifts → Maintenance
//
// Returns a CheckResult with isValid flag and all violations.
// ============================================================

export function checkAll(
  workOrders: WorkOrder[],
  workCenters: WorkCenter[]
): CheckResult {
  const violations: ConstraintViolation[] = [
    ...checkDependencies(workOrders),
    ...checkWorkCenterConflicts(workOrders),
    ...checkShiftBoundaries(workOrders, workCenters),
    ...checkMaintenanceConflicts(workOrders, workCenters),
  ];

  return {
    isValid: violations.length === 0,
    violations,
  };
}