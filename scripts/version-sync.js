#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Version synchronization utility
 * Ensures all packages have consistent versions
 */

const WORKSPACE_ROOT = path.resolve(__dirname, "..");
const PACKAGES = [
  { name: "root", path: WORKSPACE_ROOT },
  { name: "client", path: path.join(WORKSPACE_ROOT, "client") },
  { name: "server", path: path.join(WORKSPACE_ROOT, "server") },
  { name: "shared", path: path.join(WORKSPACE_ROOT, "shared") },
  { name: "desktop", path: path.join(WORKSPACE_ROOT, "desktop") },
];

function log(message, type = "info") {
  const colors = {
    info: "\x1b[36m",
    success: "\x1b[32m",
    warning: "\x1b[33m",
    error: "\x1b[31m",
  };
  const reset = "\x1b[0m";
  const prefix =
    type === "error" ? "❌" : type === "success" ? "✅" : type === "warning" ? "⚠️" : "ℹ️";
  console.log(`${colors[type]}${prefix} ${message}${reset}`);
}

function readPackageJson(packagePath) {
  const packageJsonPath = path.join(packagePath, "package.json");
  if (!fs.existsSync(packageJsonPath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function readCargoToml(cargoPath) {
  if (!fs.existsSync(cargoPath)) {
    return null;
  }
  const content = fs.readFileSync(cargoPath, "utf8");
  const versionMatch = content.match(/^version\s*=\s*"(.+)"$/m);
  return versionMatch ? versionMatch[1] : null;
}

function readTauriConf(tauriConfPath) {
  if (!fs.existsSync(tauriConfPath)) {
    return null;
  }
  const config = JSON.parse(fs.readFileSync(tauriConfPath, "utf8"));
  return config.version;
}

function checkVersionConsistency() {
  log("🔍 Checking version consistency across all packages...");

  const versions = {};
  let hasInconsistency = false;

  // Check package.json files
  PACKAGES.forEach((pkg) => {
    const packageJson = readPackageJson(pkg.path);
    if (packageJson && packageJson.version) {
      versions[pkg.name] = packageJson.version;
      log(`  ${pkg.name}/package.json: ${packageJson.version}`);
    }
  });

  // Check Cargo.toml
  const cargoPath = path.join(WORKSPACE_ROOT, "desktop/src-tauri/Cargo.toml");
  const cargoVersion = readCargoToml(cargoPath);
  if (cargoVersion) {
    versions["cargo"] = cargoVersion;
    log(`  desktop/src-tauri/Cargo.toml: ${cargoVersion}`);
  }

  // Check tauri.conf.json
  const tauriConfPath = path.join(WORKSPACE_ROOT, "desktop/src-tauri/tauri.conf.json");
  const tauriVersion = readTauriConf(tauriConfPath);
  if (tauriVersion) {
    versions["tauri"] = tauriVersion;
    log(`  desktop/src-tauri/tauri.conf.json: ${tauriVersion}`);
  }

  // Find the reference version (from root package.json)
  const referenceVersion = versions["root"];
  if (!referenceVersion) {
    log("No version found in root package.json", "error");
    return false;
  }

  log(`\n📋 Reference version: ${referenceVersion}`);

  // Check for inconsistencies
  Object.entries(versions).forEach(([name, version]) => {
    if (version !== referenceVersion) {
      log(`  ❌ ${name}: ${version} (should be ${referenceVersion})`, "error");
      hasInconsistency = true;
    } else {
      log(`  ✅ ${name}: ${version}`, "success");
    }
  });

  return !hasInconsistency;
}

function listOutdatedDependencies() {
  log("\n🔍 Checking for outdated dependencies...");

  const { execSync } = require("child_process");

  try {
    // Check root dependencies
    log("  Root dependencies:");
    const rootOutdated = execSync("npm outdated --depth=0", {
      cwd: WORKSPACE_ROOT,
      encoding: "utf8",
      stdio: "pipe",
    }).trim();
    if (rootOutdated) {
      console.log(rootOutdated);
    } else {
      log("    All up to date ✅", "success");
    }

    // Check workspace dependencies
    ["client", "server", "shared", "desktop"].forEach((workspace) => {
      const workspacePath = path.join(WORKSPACE_ROOT, workspace);
      if (fs.existsSync(path.join(workspacePath, "package.json"))) {
        log(`  ${workspace} dependencies:`);
        try {
          const workspaceOutdated = execSync("npm outdated --depth=0", {
            cwd: workspacePath,
            encoding: "utf8",
            stdio: "pipe",
          }).trim();
          if (workspaceOutdated) {
            console.log(workspaceOutdated);
          } else {
            log("    All up to date ✅", "success");
          }
        } catch (error) {
          if (!error.stdout || error.stdout.trim() === "") {
            log("    All up to date ✅", "success");
          } else {
            console.log(error.stdout);
          }
        }
      }
    });
  } catch {
    log("Could not check outdated dependencies", "warning");
  }
}

function generateVersionReport() {
  log("\n📊 Generating version report...");

  const report = {
    timestamp: new Date().toISOString(),
    versions: {},
    dependencies: {},
  };

  // Collect all versions
  PACKAGES.forEach((pkg) => {
    const packageJson = readPackageJson(pkg.path);
    if (packageJson) {
      report.versions[pkg.name] = {
        version: packageJson.version,
        dependencies: Object.keys(packageJson.dependencies || {}),
        devDependencies: Object.keys(packageJson.devDependencies || {}),
      };
    }
  });

  // Add Rust versions
  const cargoVersion = readCargoToml(path.join(WORKSPACE_ROOT, "desktop/src-tauri/Cargo.toml"));
  if (cargoVersion) {
    report.versions.cargo = { version: cargoVersion };
  }

  const tauriVersion = readTauriConf(
    path.join(WORKSPACE_ROOT, "desktop/src-tauri/tauri.conf.json"),
  );
  if (tauriVersion) {
    report.versions.tauri = { version: tauriVersion };
  }

  const reportPath = path.join(WORKSPACE_ROOT, "version-report.json");
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  log(`Version report saved to: ${reportPath}`, "success");
}

function showHelp() {
  console.log(`
🔧 Version Synchronization Utility

Usage:
  node scripts/version-sync.js [command]

Commands:
  check       Check version consistency (default)
  report      Generate detailed version report
  outdated    Check for outdated dependencies
  help        Show this help message

Examples:
  node scripts/version-sync.js              # Check consistency
  node scripts/version-sync.js report       # Generate report
  node scripts/version-sync.js outdated     # Check outdated deps
`);
}

function main() {
  const command = process.argv[2] || "check";

  switch (command) {
    case "check": {
      const isConsistent = checkVersionConsistency();
      if (isConsistent) {
        log("\n🎉 All versions are consistent!", "success");
        process.exit(0);
      } else {
        log("\n❌ Version inconsistencies found!", "error");
        log("Run the release script to sync versions:", "info");
        log("  node scripts/release.js patch --dry-run", "info");
        process.exit(1);
      }
      break;
    }

    case "report":
      checkVersionConsistency();
      generateVersionReport();
      break;

    case "outdated":
      listOutdatedDependencies();
      break;

    case "help":
    default:
      showHelp();
      break;
  }
}

main();
