// ============================================================
// BASE DOCUMENT STRUCTURE
// All documents in the system follow this wrapper pattern
// ============================================================

export interface BaseDocument<T extends string, D> {
  docId: string;
  docType: T;
  data: D;
}

// ============================================================
// SHIFT
// Defines working hours for a specific day of the week
// dayOfWeek: 0 = Sunday, 1 = Monday, ..., 6 = Saturday
// ============================================================

export interface Shift {
  dayOfWeek: number;   // 0–6
  startHour: number;   // e.g. 8  → 8:00 AM
  endHour: number;     // e.g. 17 → 5:00 PM
}

// ============================================================
// MAINTENANCE WINDOW
// A blocked time period on a work center — no work allowed
// ============================================================

export interface MaintenanceWindow {
  startDate: string;   // ISO 8601 UTC string
  endDate: string;     // ISO 8601 UTC string
  reason?: string;     // Optional description
}

// ============================================================
// WORK CENTER
// A machine or production line in the factory
// ============================================================

export interface WorkCenterData {
  name: string;
  shifts: Shift[];
  maintenanceWindows: MaintenanceWindow[];
}

export type WorkCenter = BaseDocument<"workCenter", WorkCenterData>;

// ============================================================
// WORK ORDER
// A single job/task to be scheduled on a work center
// ============================================================

export interface WorkOrderData {
  workOrderNumber: string;
  manufacturingOrderId: string;
  workCenterId: string;

  // Timing — these get updated by the reflow algorithm
  startDate: string;           // ISO 8601 UTC string
  endDate: string;             // ISO 8601 UTC string
  durationMinutes: number;     // Total working minutes required

  // If true, this order CANNOT be rescheduled (e.g. fixed maintenance task)
  isMaintenance: boolean;

  // All listed orders must complete before this one can start
  dependsOnWorkOrderIds: string[];

  // Bonus: optional setup time before production begins
  setupTimeMinutes?: number;
}

export type WorkOrder = BaseDocument<"workOrder", WorkOrderData>;

// ============================================================
// MANUFACTURING ORDER
// High-level production order — groups work orders together
// Used for context (due dates, quantities)
// ============================================================

export interface ManufacturingOrderData {
  manufacturingOrderNumber: string;
  itemId: string;
  quantity: number;
  dueDate: string;   // ISO 8601 UTC string
}

export type ManufacturingOrder = BaseDocument<"manufacturingOrder", ManufacturingOrderData>;

// ============================================================
// REFLOW INPUT
// Everything the algorithm needs to produce a valid schedule
// ============================================================

export interface ReflowInput {
  workOrders: WorkOrder[];
  workCenters: WorkCenter[];
  manufacturingOrders: ManufacturingOrder[];
}

// ============================================================
// CHANGE RECORD
// Describes what happened to a single work order after reflow
// ============================================================

export interface WorkOrderChange {
  workOrderId: string;
  workOrderNumber: string;
  previousStartDate: string;
  previousEndDate: string;
  newStartDate: string;
  newEndDate: string;
  delayMinutes: number;        // How much it was pushed forward
  reason: string;              // Why it moved (human-readable)
}

// ============================================================
// REFLOW RESULT
// What the algorithm returns
// ============================================================

export interface ReflowResult {
  updatedWorkOrders: WorkOrder[];       // Full updated work orders
  changes: WorkOrderChange[];           // Only orders that moved
  explanation: string;                  // High-level summary
  // Bonus: optimization metrics
  metrics?: {
    totalDelayMinutes: number;          // Σ delay across all changed orders
    affectedOrderCount: number;         // How many orders moved
    unchangedOrderCount: number;        // How many stayed the same
  };
}

// ============================================================
// INTERNAL: SCHEDULED ORDER
// Used internally during algorithm execution
// Tracks resolved start/end times while processing
// ============================================================

export interface ScheduledOrder {
  workOrder: WorkOrder;
  resolvedStartDate: string;
  resolvedEndDate: string;
}