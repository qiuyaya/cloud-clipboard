#!/usr/bin/env node

import fs from "fs";
import path from "path";

const COVERAGE_DIRS = ["./shared/coverage", "./server/coverage", "./client/coverage"];

const THRESHOLD_TARGETS = {
  shared: { functions: 80, lines: 80, statements: 80, branches: 70 },
  server: { functions: 75, lines: 75, statements: 75, branches: 65 },
  client: { functions: 70, lines: 70, statements: 70, branches: 60 },
};

function readCoverageFile(dir) {
  const summaryPath = path.join(dir, "coverage-summary.json");

  if (!fs.existsSync(summaryPath)) {
    console.warn(`Coverage summary not found: ${summaryPath}`);
    return null;
  }

  try {
    return JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  } catch (error) {
    console.error(`Error reading coverage file ${summaryPath}:`, error.message);
    return null;
  }
}

function formatPercentage(pct) {
  const color = pct >= 80 ? "\x1b[32m" : pct >= 60 ? "\x1b[33m" : "\x1b[31m";
  return `${color}${pct.toFixed(2)}%\x1b[0m`;
}

function checkThresholds(metrics, thresholds) {
  const failures = [];

  for (const [metric, threshold] of Object.entries(thresholds)) {
    if (metrics[metric] && metrics[metric].pct < threshold) {
      failures.push({
        metric,
        actual: metrics[metric].pct,
        expected: threshold,
      });
    }
  }

  return failures;
}

function generateReport() {
  console.log("\n📊 Test Coverage Report");
  console.log("========================\n");

  let overallPassed = true;
  const packageResults = {};

  // Process each package
  for (const dir of COVERAGE_DIRS) {
    const packageName = path.basename(path.dirname(dir));
    const coverage = readCoverageFile(dir);

    if (!coverage || !coverage.total) {
      console.log(`❌ ${packageName.toUpperCase()}: No coverage data available\n`);
      packageResults[packageName] = { available: false };
      continue;
    }

    const { total } = coverage;
    const thresholds = THRESHOLD_TARGETS[packageName] || {};

    console.log(`📦 ${packageName.toUpperCase()}`);
    console.log("─".repeat(30));
    console.log(
      `Functions: ${formatPercentage(total.functions.pct)} (${total.functions.covered}/${total.functions.total})`,
    );
    console.log(
      `Lines:     ${formatPercentage(total.lines.pct)} (${total.lines.covered}/${total.lines.total})`,
    );
    console.log(
      `Statements: ${formatPercentage(total.statements.pct)} (${total.statements.covered}/${total.statements.total})`,
    );
    console.log(
      `Branches:  ${formatPercentage(total.branches.pct)} (${total.branches.covered}/${total.branches.total})`,
    );

    // Check thresholds
    const failures = checkThresholds(total, thresholds, packageName);

    if (failures.length > 0) {
      console.log("\n⚠️  Threshold Failures:");
      failures.forEach((failure) => {
        console.log(`   ${failure.metric}: ${failure.actual.toFixed(2)}% < ${failure.expected}%`);
      });
      overallPassed = false;
    } else {
      console.log("\n✅ All thresholds passed");
    }

    packageResults[packageName] = {
      available: true,
      metrics: total,
      thresholdsPassed: failures.length === 0,
      failures,
    };

    console.log("");
  }

  // Overall summary
  console.log("🎯 Overall Summary");
  console.log("==================");

  const availablePackages = Object.entries(packageResults).filter(([, result]) => result.available);

  if (availablePackages.length === 0) {
    console.log("❌ No coverage data available for any package");
    return false;
  }

  // Calculate overall metrics
  let totalFunctions = 0,
    coveredFunctions = 0;
  let totalLines = 0,
    coveredLines = 0;
  let totalStatements = 0,
    coveredStatements = 0;
  let totalBranches = 0,
    coveredBranches = 0;

  availablePackages.forEach(([, result]) => {
    if (result.metrics) {
      totalFunctions += result.metrics.functions.total;
      coveredFunctions += result.metrics.functions.covered;
      totalLines += result.metrics.lines.total;
      coveredLines += result.metrics.lines.covered;
      totalStatements += result.metrics.statements.total;
      coveredStatements += result.metrics.statements.covered;
      totalBranches += result.metrics.branches.total;
      coveredBranches += result.metrics.branches.covered;
    }
  });

  const overallMetrics = {
    functions: totalFunctions > 0 ? (coveredFunctions / totalFunctions) * 100 : 0,
    lines: totalLines > 0 ? (coveredLines / totalLines) * 100 : 0,
    statements: totalStatements > 0 ? (coveredStatements / totalStatements) * 100 : 0,
    branches: totalBranches > 0 ? (coveredBranches / totalBranches) * 100 : 0,
  };

  console.log(
    `Functions: ${formatPercentage(overallMetrics.functions)} (${coveredFunctions}/${totalFunctions})`,
  );
  console.log(
    `Lines:     ${formatPercentage(overallMetrics.lines)} (${coveredLines}/${totalLines})`,
  );
  console.log(
    `Statements: ${formatPercentage(overallMetrics.statements)} (${coveredStatements}/${totalStatements})`,
  );
  console.log(
    `Branches:  ${formatPercentage(overallMetrics.branches)} (${coveredBranches}/${totalBranches})`,
  );

  const packagesPassingThresholds = availablePackages.filter(
    ([, result]) => result.thresholdsPassed,
  ).length;

  console.log(
    `\nPackages passing thresholds: ${packagesPassingThresholds}/${availablePackages.length}`,
  );

  if (overallPassed) {
    console.log("✅ All packages meet their coverage thresholds");
  } else {
    console.log("❌ Some packages do not meet their coverage thresholds");
  }

  // Generate badges data for README
  const badgeData = {
    overall: {
      functions: Math.round(overallMetrics.functions),
      lines: Math.round(overallMetrics.lines),
      statements: Math.round(overallMetrics.statements),
      branches: Math.round(overallMetrics.branches),
    },
    packages: packageResults,
  };

  // Write badge data
  try {
    fs.writeFileSync("./coverage-badges.json", JSON.stringify(badgeData, null, 2));
    console.log("\n📋 Coverage badge data written to coverage-badges.json");
  } catch (error) {
    console.error("Failed to write badge data:", error.message);
  }

  return overallPassed;
}

function main() {
  const passed = generateReport();

  if (process.argv.includes("--fail-on-threshold")) {
    process.exit(passed ? 0 : 1);
  }
}

// Check if script is run directly (ES modules equivalent of require.main === module)
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}

export { generateReport };
