# kmcb-service-control-centre

- This repository is the standalone source of truth for the KMCB local service control centre.
- This tool is the single control path for starting, stopping, restarting, and checking registered local development services.
- Bind only to `127.0.0.1`.
- Never expose process-control APIs through a public host, reverse proxy, tunnel, or deployment.
- Keep service IDs and ports unique in `config/services.json`.
- Do not terminate a process when its listening port belongs to a different working directory.
- Prefer `node bin/svc.mjs <action> <service-id>` over direct service commands for agent-driven operations.
- The only bootstrap exception is starting this control center itself.
- Update `CHANGELOG.md` after substantive behavior or registry changes.
- Validate with `npm run check` and `npm test`.
