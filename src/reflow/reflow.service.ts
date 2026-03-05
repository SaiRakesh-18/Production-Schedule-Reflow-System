import { DateTime } from "luxon";
import {
  ReflowInput,
  ReflowResult,
  WorkOrder,
  WorkCenter,
  WorkOrderChange,
  ScheduledOrder,
  Shift,
  MaintenanceWindow,
} from "./types";
import { checkAll } from "./constraint-checker";
import { calculateEndDate, getEffectiveStartDate } from "../utils/date-utils";

// ============================================================
// ReflowService
// Main scheduling engine. Takes a disrupted schedule as input
// and produces a valid rescheduled output.
//
// Algorithm overview:
//   1. Separate locked (maintenance) orders from movable ones
//   2. Topological sort using dependency graph (DAG)
//   3. For each order (in dependency order):
//      a. Find earliest valid start (after parents + work center free)
//      b. Calculate real end date (respecting shifts + maintenance)
//      c. Record change if dates moved
//   4. Validate final schedule
//   5. Return result with changes + metrics
// ============================================================

export class ReflowService {

  // ==========================================================
  // reflow  ← MAIN ENTRY POINT
  // ==========================================================

  reflow(input: ReflowInput): ReflowResult {
    const { workOrders, workCenters } = input;

    // Build a lookup map for work centers
    const centerMap = new Map<string, WorkCenter>();
    workCenters.forEach((wc) => centerMap.set(wc.docId, wc));

    // Step 1: Separate locked orders (isMaintenance = true)
    // These cannot be moved — treat them as fixed blocks
    const lockedOrders = workOrders.filter((wo) => wo.data.isMaintenance);
    const movableOrders = workOrders.filter((wo) => !wo.data.isMaintenance);

    // Step 2: Topological sort — process orders in dependency order
    // Orders with no parents come first, children come after parents
    const sortedOrders = this.topologicalSort(movableOrders);

    // Step 3: Schedule each order in sorted order
    // Track resolved schedules so children can look up parent end times
    const resolvedMap = new Map<string, ScheduledOrder>();

    // Pre-populate resolved map with locked orders (they are already placed)
    lockedOrders.forEach((wo) => {
      resolvedMap.set(wo.docId, {
        workOrder: wo,
        resolvedStartDate: wo.data.startDate,
        resolvedEndDate: wo.data.endDate,
      });
    });

    // Track per-work-center the list of occupied intervals (locked + scheduled orders).
    // Using a list of intervals instead of a single "latest end time" allows new orders
    // to be placed in FREE GAPS that exist before a locked maintenance block.
    const workCenterIntervals = new Map<string, Array<{ start: DateTime; end: DateTime }>>();

    // Pre-populate with locked order intervals — they occupy fixed time blocks
    lockedOrders.forEach((wo) => {
      const start    = DateTime.fromISO(wo.data.startDate, { zone: "utc" });
      const end      = DateTime.fromISO(wo.data.endDate,   { zone: "utc" });
      const centerId = wo.data.workCenterId;
      if (!workCenterIntervals.has(centerId)) workCenterIntervals.set(centerId, []);
      workCenterIntervals.get(centerId)!.push({ start, end });
    });

    const changes: WorkOrderChange[] = [];
    const updatedWorkOrders: WorkOrder[] = [...lockedOrders];

    for (const wo of sortedOrders) {
      const center = centerMap.get(wo.data.workCenterId);
      if (!center) {
        throw new Error(
          `Work center "${wo.data.workCenterId}" not found for work order "${wo.data.workOrderNumber}".`
        );
      }

      // --- Find earliest possible start time ---

      // 1. Start from the original scheduled start date
      let earliestStart = DateTime.fromISO(wo.data.startDate, { zone: "utc" });

      // 2. Must start after ALL parent dependencies finish
      for (const parentId of wo.data.dependsOnWorkOrderIds) {
        const parent = resolvedMap.get(parentId);
        if (!parent) {
          throw new Error(
            `Dependency "${parentId}" not resolved before processing "${wo.data.workOrderNumber}". ` +
            `Check for missing orders or circular dependencies.`
          );
        }
        const parentEnd = DateTime.fromISO(parent.resolvedEndDate, { zone: "utc" });
        if (parentEnd > earliestStart) {
          earliestStart = parentEnd;
        }
      }

      // 3. Find the earliest gap on this work center that fits this order.
      //    Checks ALL occupied intervals so an order can be placed in any free slot
      //    — including gaps that exist BEFORE a locked maintenance block.
      const totalDuration = wo.data.durationMinutes + (wo.data.setupTimeMinutes ?? 0);
      const intervals = workCenterIntervals.get(wo.data.workCenterId) ?? [];
      const { validStart, blockedBy } = this.findEarliestFit(
        earliestStart,
        totalDuration,
        intervals,
        center.data.shifts,
        center.data.maintenanceWindows
      );

      // --- Calculate real end date (respects shifts + maintenance) ---
      const newEndDate = calculateEndDate(
        validStart,
        totalDuration,
        center.data.shifts,
        center.data.maintenanceWindows
      );

      // --- Record change if this order moved ---
      const originalStart = wo.data.startDate;
      const originalEnd = wo.data.endDate;

      const originalStartDt = DateTime.fromISO(originalStart, { zone: "utc" });
      const newStartDt = DateTime.fromISO(validStart, { zone: "utc" });
      const delayMinutes = Math.round(newStartDt.diff(originalStartDt, "minutes").minutes);

      if (delayMinutes !== 0) {
        changes.push({
          workOrderId: wo.docId,
          workOrderNumber: wo.data.workOrderNumber,
          previousStartDate: originalStart,
          previousEndDate: originalEnd,
          newStartDate: validStart,
          newEndDate: newEndDate,
          delayMinutes,
          reason: this.buildReason(wo, resolvedMap, blockedBy, earliestStart),
        });
      }

      // --- Build updated work order ---
      const updatedWO: WorkOrder = {
        ...wo,
        data: {
          ...wo.data,
          startDate: validStart,
          endDate: newEndDate,
        },
      };

      updatedWorkOrders.push(updatedWO);

      // --- Update tracking maps ---
      resolvedMap.set(wo.docId, {
        workOrder: updatedWO,
        resolvedStartDate: validStart,
        resolvedEndDate: newEndDate,
      });

      // Register this order's slot so future orders on the same work center
      // know this window is occupied and must work around it
      const newEndDt = DateTime.fromISO(newEndDate, { zone: "utc" });
      if (!workCenterIntervals.has(wo.data.workCenterId)) workCenterIntervals.set(wo.data.workCenterId, []);
      workCenterIntervals.get(wo.data.workCenterId)!.push({ start: newStartDt, end: newEndDt });
    }

    // Step 4: Validate the final schedule
    const validation = checkAll(updatedWorkOrders, workCenters);
    if (!validation.isValid) {
      // @upgrade: Instead of throwing, return partial result with violation details
      //           so the caller can decide how to handle impossible schedules.
      throw new Error(
        `Reflow produced an invalid schedule:\n` +
        validation.violations.map((v) => `  [${v.type}] ${v.message}`).join("\n")
      );
    }

    // Step 5: Build metrics
    const totalDelayMinutes = changes.reduce((sum, c) => sum + c.delayMinutes, 0);
    const affectedOrderCount = changes.length;
    const unchangedOrderCount = updatedWorkOrders.length - affectedOrderCount;

    // Step 6: Build explanation summary
    const explanation = this.buildExplanation(changes, totalDelayMinutes);

    return {
      updatedWorkOrders,
      changes,
      explanation,
      metrics: {
        totalDelayMinutes,
        affectedOrderCount,
        unchangedOrderCount,
      },
    };
  }

  // ==========================================================
  // topologicalSort
  // Sorts work orders so that all parents come before children.
  // Uses Kahn's algorithm (BFS-based).
  //
  // Also detects circular dependencies (A → B → A) and throws.
  //
  // Example:
  //   Input:  [C (depends on B), B (depends on A), A]
  //   Output: [A, B, C]
  // ==========================================================

  private topologicalSort(workOrders: WorkOrder[]): WorkOrder[] {
    const orderMap = new Map<string, WorkOrder>();
    workOrders.forEach((wo) => orderMap.set(wo.docId, wo));

    // Build in-degree count and adjacency list
    // in-degree = number of parents an order has
    const inDegree = new Map<string, number>();
    const children = new Map<string, string[]>(); // parentId → [childIds]

    workOrders.forEach((wo) => {
      if (!inDegree.has(wo.docId)) inDegree.set(wo.docId, 0);
      if (!children.has(wo.docId)) children.set(wo.docId, []);
    });

    workOrders.forEach((wo) => {
      for (const parentId of wo.data.dependsOnWorkOrderIds) {
        // Only count dependencies within movable orders
        // (locked orders are pre-resolved, not part of sort)
        if (!orderMap.has(parentId)) continue;

        inDegree.set(wo.docId, (inDegree.get(wo.docId) ?? 0) + 1);
        children.get(parentId)!.push(wo.docId);
      }
    });

    // Queue starts with all orders that have no parents (in-degree = 0)
    const queue: string[] = [];
    inDegree.forEach((degree, id) => {
      if (degree === 0) queue.push(id);
    });

    const sorted: WorkOrder[] = [];

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const current = orderMap.get(currentId)!;
      sorted.push(current);

      // For each child of this order, reduce their in-degree
      // When a child's in-degree hits 0, all its parents are resolved → add to queue
      for (const childId of children.get(currentId) ?? []) {
        const newDegree = (inDegree.get(childId) ?? 0) - 1;
        inDegree.set(childId, newDegree);
        if (newDegree === 0) queue.push(childId);
      }
    }

    // If sorted length < total orders, there's a cycle
    if (sorted.length !== workOrders.length) {
      const unresolved = workOrders
        .filter((wo) => !sorted.find((s) => s.docId === wo.docId))
        .map((wo) => wo.data.workOrderNumber)
        .join(", ");
      throw new Error(
        `Circular dependency detected among work orders: ${unresolved}. ` +
        `These orders depend on each other in a cycle.`
      );
    }

    return sorted;
  }

  // ==========================================================
  // findEarliestFit
  // Given an earliest possible start and a required working duration,
  // finds the first time slot on a work center that:
  //   1. Starts at or after earliestStart
  //   2. Does not overlap any already-occupied interval (locked or scheduled)
  //   3. Falls inside shift hours and outside maintenance windows
  //
  // Unlike the old "start after the latest end" approach, this scans
  // ALL occupied intervals so an order can be placed in a FREE GAP
  // that exists before a later locked maintenance block.
  //
  // Example:
  //   intervals = [{ 11:00–14:00 }]   (locked maintenance)
  //   earliestStart = 08:00, duration = 120 min
  //   → tries 08:00: candidateEnd = 10:00, no overlap with [11:00–14:00] → fits!
  //   → returns { validStart: "08:00", blockedBy: undefined }
  // ==========================================================

  private findEarliestFit(
    earliestStart: DateTime,
    totalDuration: number,
    intervals: Array<{ start: DateTime; end: DateTime }>,
    shifts: Shift[],
    maintenanceWindows: MaintenanceWindow[]
  ): { validStart: string; blockedBy: DateTime | undefined } {
    // Snap the candidate start to a valid shift/maintenance-free moment
    let current = DateTime.fromISO(
      getEffectiveStartDate(earliestStart.toUTC().toISO()!, shifts, maintenanceWindows),
      { zone: "utc" }
    );
    let blockedBy: DateTime | undefined;

    // Sort a copy of intervals chronologically so we always hit the earliest conflict first
    const sorted = [...intervals].sort((a, b) => a.start.toMillis() - b.start.toMillis());

    // Safety limit: prevent infinite loops on pathological inputs
    const limit = current.plus({ days: 60 });

    while (current < limit) {
      const candidateEnd = calculateEndDate(
        current.toUTC().toISO()!,
        totalDuration,
        shifts,
        maintenanceWindows
      );
      const candidateEndDt = DateTime.fromISO(candidateEnd, { zone: "utc" });

      // Two intervals [A, B) and [C, D) overlap when: A < D && C < B
      const conflict = sorted.find(
        (iv) => iv.start < candidateEndDt && current < iv.end
      );

      if (!conflict) {
        // No overlap found — this slot works
        return { validStart: current.toUTC().toISO()!, blockedBy };
      }

      // Push current start past the conflicting interval, then re-snap to shift
      blockedBy = conflict.end;
      current = DateTime.fromISO(
        getEffectiveStartDate(conflict.end.toUTC().toISO()!, shifts, maintenanceWindows),
        { zone: "utc" }
      );
    }

    throw new Error(
      `Could not find a valid time slot within 60 days from ${earliestStart.toISO()}.`
    );
  }

  // ==========================================================
  // buildReason
  // Generates a human-readable explanation for why an order moved
  // ==========================================================

  private buildReason(
    wo: WorkOrder,
    resolvedMap: Map<string, ScheduledOrder>,
    centerFreeAt: DateTime | undefined,
    earliestStart: DateTime
  ): string {
    const reasons: string[] = [];

    // Check if a parent dependency pushed this order
    for (const parentId of wo.data.dependsOnWorkOrderIds) {
      const parent = resolvedMap.get(parentId);
      if (parent) {
        const parentEnd = DateTime.fromISO(parent.resolvedEndDate, { zone: "utc" });
        if (parentEnd >= earliestStart) {
          reasons.push(
            `dependency on "${parent.workOrder.data.workOrderNumber}" (ends ${parentEnd.toISO()})`
          );
        }
      }
    }

    // Check if work center conflict pushed this order
    if (centerFreeAt && centerFreeAt >= earliestStart) {
      reasons.push(`work center busy until ${centerFreeAt.toISO()}`);
    }

    if (reasons.length === 0) {
      return "Shifted to comply with shift boundaries or maintenance windows.";
    }

    return `Delayed due to: ${reasons.join("; ")}.`;
  }

  // ==========================================================
  // buildExplanation
  // Generates a high-level summary of what the reflow did
  // ==========================================================

  private buildExplanation(changes: WorkOrderChange[], totalDelayMinutes: number): string {
    if (changes.length === 0) {
      return "No changes were necessary. The schedule was already valid.";
    }

    const hours = Math.floor(totalDelayMinutes / 60);
    const minutes = totalDelayMinutes % 60;
    const timeStr = hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;

    return (
      `Reflow complete. ${changes.length} work order(s) were rescheduled, ` +
      `introducing a total delay of ${timeStr}. ` +
      `Affected orders: ${changes.map((c) => c.workOrderNumber).join(", ")}.`
    );
  }
}