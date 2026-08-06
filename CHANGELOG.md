# Changelog

## 2026-08-06

### Added

- Added native Windows service lifecycle support using `cmd.exe`, `netstat.exe`, PowerShell process-tree discovery, and `taskkill.exe`.
- Added per-platform `commandWindows`, `envPosix`, and `envWindows` registry fields while retaining the existing `command` and common `env` fields.
- Added PowerShell install and uninstall scripts that use `%LOCALAPPDATA%`, a current-user logon scheduled task, and a user PATH CLI wrapper without requiring administrator elevation.
- Added a Windows setup, configuration, validation, troubleshooting, upgrade, and uninstall guide.
- Added macOS and Windows GitHub Actions coverage with PowerShell syntax parsing plus a real Windows install, scheduled-task, CLI, API, and uninstall smoke test in a Unicode path.

### Changed

- Moved runtime-directory selection into a platform-aware helper while preserving the existing macOS Application Support path.
- Raised the package version to `1.1.0`.
- Updated the example registry with Windows commands and kept the fixed macOS Java 17 paths in `envPosix` only.
- Made `npm test` enumerate `*.test.mjs` files in JavaScript so the test command works in both POSIX shells and Windows PowerShell without treating fixture programs as tests.
- Made Windows `cmd.exe` launch quoting explicit and made runtime path construction independent of the operating system running the test.
- Bound installed Windows CLI and scheduled-task processes to the installed config and runtime directories, allowed for process-inspection latency, and made uninstall wait for scoped process handles to close.
- Added scheduled-task result, action, and control-log diagnostics when Windows installation cannot make the dashboard ready.

### Security

- Windows only treats listeners inside a recorded managed process tree as controllable; all other listeners are conflicts and cannot be stopped by the control centre.
- The Windows installer refuses to replace an unrelated process already listening on the configured control port.

### Validation

- `npm run check` completed successfully after the cross-platform changes.
- All 29 Node.js tests passed, including Windows command selection, runtime paths, listener parsing, process-tree identity, PID-reuse refusal, installer contracts, and the existing HTTP lifecycle integration.
- Reinstalled the macOS LaunchAgent from version `1.1.0` and confirmed 11 registered services report 8 running, 3 stopped, and no unhealthy or conflicting services.

### Documentation

- Added a detailed Chinese setup and migration guide for sharing the tool with users whose repository, workspace, runtime, and home-directory paths differ.
- Documented macOS and Node.js prerequisites, registry customization, secret environment files, LaunchAgent installation, CLI setup, verification, updates, diagnostics, safe uninstallation, and sharing checklists.
- Replaced the README's machine-specific source path and source-tree CLI examples with a portable path placeholder and the installed `kmcb-svc` command.

### Known Limitations

- `config/services.json` remains a Git-tracked machine-specific file and must be reconciled when multiple users keep different local paths.

## 2026-08-04

### Added

- Registered `kmcb-trace-web` as the standalone customer shipment Trace frontend on fixed local port `3300`.

### Repository

- Split the service control centre out of `kmcb-admin-api` into the standalone local repository `kmcb-service-control-centre`.
- Aligned the package name and installation documentation with the standalone repository name and path.

### Changed

- Relabeled `kmcb-customer-portal-web` as the customer account and sale-after portal while its historic Trace routes remain available during domain migration.

### Validation

- Added registry coverage for the Trace project name, working directory, protocol, and fixed port.
- Reinstalled the localhost LaunchAgent and confirmed `kmcb-svc status trace-web` reports the registered service as stopped on port `3300`.
- Re-ran the syntax checks and all 15 Node.js tests after extraction.

## 2026-08-03

### Changed

- Differentiated the CRM main application and customer gateway as `kj-crm-api / StartApp / :7110` and `kj-crm-gateway-api / StartAppGateWay / :7111` throughout the service dashboard.
- Added per-service mode-600 secret environment files under the control-center runtime directory, allowing managed services such as CRM Gateway to receive SMTP credentials without committing secrets or printing them in startup logs.

### Fixed

- Fixed CRM API and gateway startup by pinning their Maven and Java processes to the project's Temurin Java 17 runtime.
- Prevented the host Maven default JDK from disabling Lombok-generated constructors, accessors, and log fields during CRM builds.

### Validation

- Confirmed `kj-crm-common` compiles successfully with Temurin Java 17.
- Added registry coverage that requires both CRM services to use the Java 17 runtime.
- Added focused coverage for secret environment parsing, missing files, and unsafe file permissions.

## 2026-07-31

### Added

- Added a localhost-only live dashboard for KMCB frontend and backend services.
- Added a single service registry with fixed ports and launch commands.
- Added safe start, stop, restart, status, health, port-conflict, and log APIs.
- Added a CLI that routes agent-driven service operations through the control center.
- Added a macOS LaunchAgent installer for automatic local startup.

### Fixed

- Loaded the dashboard application as an ES module so its live status initialization runs in the browser.
- Made service cards use repository project names with short purpose labels.
- Added the Node runtime compatibility flag required by the BMS frontend startup command on macOS.
- Marked managed processes unhealthy when they exceed the configured startup timeout without listening on their port.
- Started `kmcb-admin-api` with the `dev` Spring profile used by the local macOS environment.

### Validation

- `npm run check` completed successfully.
- `npm test` completed successfully with registry, authorization, lifecycle, logging, and port-conflict coverage.
- Verified the macOS LaunchAgent remains running and serves the dashboard only on `127.0.0.1:17600`.
