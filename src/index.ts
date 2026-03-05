import { ReflowService } from "./reflow/reflow.service";
import { ReflowInput, ReflowResult, WorkOrderChange } from "./reflow/types";
import { scenario1 } from "./data/scenario-1-delay-cascade";
import { scenario2 } from "./data/scenario-2-maintenance"
import { scenario3 } from "./data/scenario-3-complex";

// ============================================================
// PRINT HELPERS
// Clean terminal output for the Loom demo
// ============================================================

function printDivider(char = "─", length = 60) {
  console.log(char.repeat(length));
}

function printHeader(title: string) {
  console.log("\n");
  printDivider("═");
  console.log(`  ${title}`);
  printDivider("═");
}

function printChange(change: WorkOrderChange) {
  const direction = change.delayMinutes > 0 ? "⏩ DELAYED" : "⏪ MOVED EARLIER";
  const hours = Math.floor(Math.abs(change.delayMinutes) / 60);
  const mins = Math.abs(change.delayMinutes) % 60;
  const timeStr = hours > 0 ? `${hours}h ${mins}m` : `${mins}m`;

  console.log(`\n  📦 ${change.workOrderNumber}  [${direction} by ${timeStr}]`);
  console.log(`     Before : ${change.previousStartDate} → ${change.previousEndDate}`);
  console.log(`     After  : ${change.newStartDate} → ${change.newEndDate}`);
  console.log(`     Reason : ${change.reason}`);
}

function printResult(result: ReflowResult) {
  // Explanation
  console.log(`\n  📋 Summary`);
  printDivider();
  console.log(`  ${result.explanation}`);

  // Metrics
  if (result.metrics) {
    console.log(`\n  📊 Metrics`);
    printDivider();
    console.log(`  Total delay introduced : ${result.metrics.totalDelayMinutes} minutes`);
    console.log(`  Orders affected        : ${result.metrics.affectedOrderCount}`);
    console.log(`  Orders unchanged       : ${result.metrics.unchangedOrderCount}`);
  }

  // Changes
  if (result.changes.length > 0) {
    console.log(`\n  🔄 Changes`);
    printDivider();
    result.changes.forEach(printChange);
  } else {
    console.log("\n  ✅ No changes needed — schedule was already valid.");
  }

  // Final schedule
  console.log(`\n  📅 Final Schedule`);
  printDivider();
  result.updatedWorkOrders
    .sort((a, b) => a.data.startDate.localeCompare(b.data.startDate))
    .forEach((wo) => {
      const tag = wo.data.isMaintenance ? " 🔒 LOCKED" : "";
      console.log(`  ${wo.data.workOrderNumber.padEnd(20)}${tag}`);
      console.log(`    Start : ${wo.data.startDate}`);
      console.log(`    End   : ${wo.data.endDate}`);
      console.log(`    Center: ${wo.data.workCenterId}`);
    });
}

// ============================================================
// RUN SCENARIO
// Wraps each scenario run in try/catch for clean error output
// ============================================================

function runScenario(name: string, input: ReflowInput, service: ReflowService) {
  printHeader(name);

  // Print original schedule before reflow
  console.log("\n  📌 Original Schedule (Before Reflow)");
  printDivider();
  input.workOrders
    .sort((a, b) => a.data.startDate.localeCompare(b.data.startDate))
    .forEach((wo) => {
      const tag = wo.data.isMaintenance ? " 🔒 LOCKED" : "";
      console.log(`  ${wo.data.workOrderNumber.padEnd(20)}${tag}`);
      console.log(`    Start : ${wo.data.startDate}`);
      console.log(`    End   : ${wo.data.endDate}`);
    });

  try {
    const result = service.reflow(input);
    printResult(result);
    console.log("\n  ✅ Scenario completed successfully.\n");
  } catch (err) {
    console.error("\n  ❌ Reflow failed:");
    console.error(`  ${(err as Error).message}\n`);
  }
}

// ============================================================
// MAIN
// ============================================================

function main() {
  const service = new ReflowService();

  console.log("\n🏭  PRODUCTION SCHEDULE REFLOW SYSTEM");
  console.log("     Naologic Technical Challenge\n");

  runScenario("SCENARIO 1 — Delay Cascade", scenario1, service);
  runScenario("SCENARIO 2 — Maintenance Conflict + Shift Boundary", scenario2, service);
  runScenario("SCENARIO 3 — Complex: Diamond Dependencies + Breakdown", scenario3, service);

  console.log("\n");
  printDivider("═");
  console.log("  All scenarios complete.");
  printDivider("═");
  console.log("\n");
}

main();