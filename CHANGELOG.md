# Changelog

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
