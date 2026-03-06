# Production Schedule Reflow System

A TypeScript scheduling engine that automatically reschedules disrupted factory work orders. When a machine breaks down, a maintenance window is added, or a job runs late, the engine cascades the impact across all dependent orders and produces a new valid schedule — respecting shift hours, maintenance windows, machine availability, and dependency chains.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Project Structure](#project-structure)
- [Core Concepts](#core-concepts)
- [Algorithm Deep Dive](#algorithm-deep-dive)
- [Scenarios](#scenarios)
- [Data Model](#data-model)
- [Getting Started](#getting-started)
- [Running the Project](#running-the-project)
- [Known Limitations & Upgrade Notes](#known-limitations--upgrade-notes)

---

## Overview

In a manufacturing environment, schedules break constantly. A machine fails, a job runs over, a maintenance team needs access — and every downstream order needs to shift. Doing this manually is slow and error-prone.

This engine takes a **disrupted schedule** as input and produces a **valid rescheduled output** automatically. It handles:

- Dependency chains (A must finish before B can start)
- Diamond dependencies (C requires both A and B to finish)
- Work center occupancy (two jobs cannot run on the same machine at the same time)
- Shift boundaries (jobs pause at shift end and resume next morning)
- Maintenance windows (jobs are pushed past maintenance, not scheduled through it)
- Locked maintenance orders (fixed blocks that cannot be moved)
- Free-gap scheduling (a new job fits in a gap *before* a maintenance block, not just after)

---

## How It Works

```
Input (disrupted schedule)
        │
        ▼
┌───────────────────────────────────────────────────┐
│  1. Split locked (maintenance) vs movable orders  │
│  2. Topological sort (Kahn's BFS algorithm)       │
│  3. For each order in dependency order:           │
│     a. Find earliest start (after all parents)    │
│     b. Find first free gap on the work center     │
│     c. Snap start to valid shift moment           │
│     d. Calculate real end date (shift-aware)      │
│     e. Record change if order moved               │
│  4. Validate the entire final schedule            │
│  5. Return result with changes + metrics          │
└───────────────────────────────────────────────────┘
        │
        ▼
Output (valid rescheduled result)
```

---

## Project Structure

```
rakesh_technical_test/
├── src/
│   ├── index.ts                          # Entry point — runs all 3 scenarios
│   │
│   ├── reflow/
│   │   ├── reflow.service.ts             # Main scheduling engine
│   │   ├── constraint-checker.ts         # Post-schedule validation
│   │   └── types.ts                      # All TypeScript interfaces
│   │
│   ├── utils/
│   │   └── date-utils.ts                 # Shift/maintenance time helpers
│   │
│   └── data/
│       ├── scenario-1-delay-cascade.ts   # 5-step chain, delay ripple + independent order
│       ├── scenario-2-maintenance.ts     # Maintenance block + shift wrap + dependency push
│       └── scenario-3-complex.ts         # Diamond deps + breakdown + finishing chain
│
├── package.json
├── tsconfig.json
└── README.md
```

---

## Core Concepts

### Work Order
A single job to be scheduled on a work center. Has a start date, end date, duration in working minutes, and a list of parent orders it depends on.

```typescript
{
  docId: "wo-001",
  data: {
    workOrderNumber: "WO-001",
    workCenterId: "wc-001",
    startDate: "2025-01-06T10:00:00Z",
    endDate:   "2025-01-06T12:00:00Z",
    durationMinutes: 120,
    isMaintenance: false,
    dependsOnWorkOrderIds: [],
  }
}
```

### Work Center
A machine or production line. Defines its working shifts and any maintenance windows.

```typescript
{
  docId: "wc-001",
  data: {
    name: "Extrusion Line 1",
    shifts: [
      { dayOfWeek: 1, startHour: 8, endHour: 17 },  // Monday 8AM-5PM
    ],
    maintenanceWindows: [
      { startDate: "2025-01-06T13:00:00Z", endDate: "2025-01-06T15:00:00Z" }
    ]
  }
}
```

### Locked Order (`isMaintenance: true`)
A work order that **cannot be moved**. It occupies a fixed block of time on a work center. All movable orders must schedule around it.

### Dependency (`dependsOnWorkOrderIds`)
A list of order IDs that must all complete before this order can start. The algorithm processes orders in topological order (parents before children) to ensure all parent end times are known before scheduling each child.

### Working Minutes vs Wall-Clock Time
Duration is measured in **working minutes** — time actually spent inside a shift, outside maintenance. A 120-minute job starting at 4PM does not end at 6PM. It works 4PM–5PM (60 min), then resumes next morning 8AM–9AM (60 min). Wall-clock time is longer but working time is exactly 120 minutes.

---

## Algorithm Deep Dive

### Step 1 — Topological Sort (`topologicalSort`)

Uses **Kahn's BFS algorithm** to order work orders so every parent is always processed before its children.

```
Input:  [C depends on B, B depends on A, A]
Output: [A, B, C]
```

- Builds an `inDegree` map (how many parents each order has)
- Builds a `children` map (who depends on each order)
- Starts a queue with all orders that have zero parents
- Processes each order, reduces the in-degree of its children
- When a child's in-degree hits 0, all its parents are resolved → add to queue
- If the sorted list is shorter than the input, a **circular dependency** exists → throws

### Step 2 — Find Earliest Start

For each work order, the earliest start is the maximum of:

1. Its **original scheduled start date**
2. The **end time of every parent** (`dependsOnWorkOrderIds`)

```typescript
// Parent pushes the start forward if it finishes later
if (parentEnd > earliestStart) {
  earliestStart = parentEnd;
}
```

### Step 3 — Find First Free Gap (`findEarliestFit`)

Instead of simply starting after the last occupied slot (which incorrectly blocks gaps before maintenance), the engine scans all occupied intervals and finds the **first gap that fits**.

```
Occupied intervals on wc-001:
  [ 08:00–11:00 ]  ← WO-004
  [ 11:00–14:00 ]  ← Locked maintenance

New order needs 120 min, earliestStart = 08:00:
  Try 08:00 → candidateEnd = 10:00 → no overlap with any interval → FITS ✓
  Result: start at 08:00 (not 14:00!)
```

**Overlap rule:** Two intervals `[A, B)` and `[C, D)` overlap when `A < D && C < B`.

If a conflict is found, the candidate start is pushed past the conflicting interval's end and the check restarts. The loop has a 60-day safety limit.

### Step 4 — Shift-Aware End Date (`calculateEndDate`)

Ticks working minutes forward from the start, skipping:
- Time outside shift hours → jumps to next shift start
- Time inside maintenance windows → jumps to maintenance end

```
Start = Monday 16:00, duration = 120 min, shift = 08:00-17:00

Mon 16:00 → 16:59  = 60 min counted   (hits shift end at 17:00)
Jump to    → Tue 08:00
Tue 08:00 → 08:59  = 60 min counted   (total = 120 ✓)
End        = Tuesday 09:00
```

### Step 5 — Constraint Validation (`checkAll`)

After scheduling all orders, the final schedule is validated across four rules:

| Check | Rule |
|---|---|
| `checkDependencies` | Every parent must end before its child starts |
| `checkWorkCenterConflicts` | No two orders overlap on the same machine |
| `checkShiftBoundaries` | Start and end must fall inside shift hours |
| `checkMaintenanceConflicts` | No order's wall-clock window overlaps a maintenance window |

If any violation is found the engine throws with a detailed list of all violations.

---

## Scenarios

### Scenario 1 — Delay Cascade

**Story:** A factory produces plastic pipes in 5 steps: Extrude → Cool → Inspect → Cut → Label, each on its own work center. The extrusion machine starts late (10AM instead of 8AM). The delay ripples through all downstream steps. An independent spare-parts batch (WO-006) runs on the same extrusion line but is unaffected.

```
Dependency chain:   WO-001 → WO-002 → WO-003 → WO-004 → WO-005
Independent:        WO-006 (no deps)

BEFORE:  WO-001: 08:00-10:00  WO-002: 10:00-11:30  WO-003: 11:30-12:30  WO-004: 12:30-13:15  WO-005: 13:15-13:45
AFTER:   WO-001: 10:00-12:00  WO-002: 12:00-13:30  WO-003: 13:30-14:30  WO-004: 14:30-15:15  WO-005: 15:15-15:45
         WO-006: 14:00-15:00  (unchanged)
```

**Metrics:** 4 orders affected, 480 total delay minutes, 2 unchanged (WO-001 came in already delayed; WO-006 independent).

**Key mechanism:** Each order reads its parent's resolved end time from `resolvedMap` and starts no earlier than that.

---

### Scenario 2 — Maintenance Conflict + Shift Boundary

**Story:** Three work centers are active. Extrusion Line 1 (wc-001) has a planned maintenance window Mon 11AM–2PM. A job originally at 10AM must move past it. A downstream job wraps across the shift boundary into Tuesday. A further dependent order on the Cooling Station is pushed by the shift-wrap. Two independent jobs on separate machines are unaffected.

```
wc-001 (Extrusion Line 1) — Monday:
  [WO-004: 08:00-10:00]  [WO-007-MAINT: 11:00-14:00 LOCKED]  [WO-005: 14:00-16:00]  [WO-006: 16:00→]
wc-001 — Tuesday:
  [→WO-006: 08:00-09:00]

wc-002 (Cooling Station):
  [WO-010: Mon 10:00-11:00]  [WO-008: Tue 09:00-10:30]  ← WO-008 waits for WO-006

wc-003 (Quality Lab, shift 09:00-18:00):
  [WO-009: Mon 09:00-10:00]
```

**Orders:** WO-004 unchanged (gap-fit before maintenance) · WO-005 delayed +240 min · WO-006 shift-wrap corrected · WO-007-MAINT locked · WO-008 delayed +60 min · WO-009 & WO-010 unchanged (independent)

**Key mechanism:** `findEarliestFit` allows WO-004 to fit in the 08:00–11:00 gap *before* the maintenance block instead of being pushed past it.

---

### Scenario 3 — Diamond Dependencies + Breakdown + Finishing Chain

**Story:** Two production lines produce components *both* needed for final assembly (diamond pattern). After assembly, the product flows through a Finishing Line and a Quality Control check before dispatch. Line 1 has an unplanned breakdown 1PM–3PM. Line 2 runs a long overnight job and is the bottleneck. Quality Control has its own maintenance Tue 09:00–10:00. An independent spare-parts finishing run (WO-015) is unaffected.

```
Dependency graph:
  WO-008 (Line 1) ──→ WO-010 ──→ WO-011 ─┐
                                           ├──→ WO-012 (Assembly) ──→ WO-013 (Finishing) ──→ WO-014 (QC)
  WO-009 (Line 2, overnight) ─────────────┘

  WO-015 (Finishing) — independent spare run

Line 1 Mon:  [WO-008: 08-11][WO-010: 11-13][BREAKDOWN: 13-15][WO-011: 15-16:30]
Line 2:      [WO-009: Mon 06:00 → Tue 07:00]
Assembly:                                        [WO-012: Tue 08:00-10:00]
Finishing:   [WO-015: Mon 08-09]                 [WO-013: Tue 10:00-11:00]
QC:          [MAINTENANCE: Tue 09-10]            [WO-014: Tue 11:00-11:45]
```

**Key mechanism:** The parent loop pushes WO-012's start to `max(WO-011 end, WO-009 end)`. WO-009 (Line 2) is the bottleneck — it ends Tue 07:00 which is later than WO-011's Mon 16:30. The entire downstream chain (WO-013, WO-014) cascades from there.

---

## Data Model

```
ReflowInput
├── workOrders:         WorkOrder[]
├── workCenters:        WorkCenter[]
└── manufacturingOrders: ManufacturingOrder[]

ReflowResult
├── updatedWorkOrders:  WorkOrder[]       ← full updated list
├── changes:            WorkOrderChange[] ← only orders that moved
├── explanation:        string            ← human-readable summary
└── metrics
    ├── totalDelayMinutes:   number
    ├── affectedOrderCount:  number
    └── unchangedOrderCount: number

WorkOrderChange
├── workOrderId / workOrderNumber
├── previousStartDate / previousEndDate
├── newStartDate / newEndDate
├── delayMinutes
└── reason                               ← why it moved
```

---

## Getting Started

**Prerequisites:** Node.js 16+

```bash
# Clone the repository
git clone <repo-url>
cd rakesh_technical_test

# Install dependencies
npm install
```

---

## Running the Project

```bash
# Run all 3 scenarios (development mode with ts-node)
npm start
# or
npm run dev

# Compile TypeScript to JavaScript
npm run build
# Output goes to ./dist/
```

**Expected output for each scenario:**

```
════════════════════════════════════════════════════════════
  SCENARIO 1 — Delay Cascade
════════════════════════════════════════════════════════════

  📌 Original Schedule (Before Reflow)
  ...

  📋 Summary
  Reflow complete. 4 work order(s) were rescheduled...

  📊 Metrics
  Total delay introduced : 480 minutes
  Orders affected        : 4
  Orders unchanged       : 2

  🔄 Changes
  📦 WO-002  [⏩ DELAYED by 2h 0m]
     Before : 2025-01-06T10:00:00.000Z → 2025-01-06T11:30:00.000Z
     After  : 2025-01-06T12:00:00.000Z → 2025-01-06T13:30:00.000Z
     Reason : Delayed due to: dependency on "WO-001" ...

  📅 Final Schedule
  ...
```

---

## Known Limitations & Upgrade Notes

These are marked with `@upgrade` comments throughout the codebase:

| Location | Limitation | Suggested Fix |
|---|---|---|
| `date-utils.ts` `getNextShiftStart` | Searches minute-by-minute for next shift start | Calculate next shift boundary directly instead of iterating |
| `date-utils.ts` `calculateEndDate` | Ticks one minute at a time to count working minutes | Jump directly to the end of each shift block instead of ticking |
| `reflow.service.ts` `reflow` | Throws on invalid schedule instead of returning partial result | Return violations in the result so the caller can decide |
| `constraint-checker.ts` `checkShiftBoundaries` | Only checks start and end moments | Sample through the full wall-clock window for full accuracy |
| `reflow.service.ts` `buildReason` | Cannot attribute delay to a maintenance window that has no locked order | Extend reason logic to detect shift/maintenance snaps in `findEarliestFit` |

### Design Decision: No Split Across Maintenance

Work orders are **not split** across maintenance windows. If an order would start before maintenance and end after, it is pushed entirely past the maintenance window. This is the safer default for manufacturing — stopping mid-operation is undesirable for most production processes.

To allow split scheduling, remove locked maintenance orders from `workCenterIntervals` (since `calculateEndDate` already skips maintenance time internally).

---

## Tech Stack

| Tool | Version | Purpose |
|---|---|---|
| TypeScript | 5.9 | Language |
| ts-node | 10.9 | Run TypeScript directly without compiling |
| Luxon | 3.7 | UTC-safe date/time arithmetic |
| Node.js | 16+ | Runtime |
