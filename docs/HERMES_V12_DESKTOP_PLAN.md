# Hermes v0.12 Desktop Feature Plan

Date checked: 2026-05-04

## Current Baseline

- Local desktop source repo: `/home/falcon/Apps/code/80m-agent-desktop`.
- Packaged runtime folder: `/home/falcon/Apps/80m-agent-desktop/80mAgentControl-linux-x64`.
- Installed Hermes: `Hermes Agent v0.11.0 (2026.4.23)`.
- Upstream current release checked from GitHub: `Hermes Agent v0.12.0 (v2026.4.30)`.
- Local gateway is running and `/health`, `/v1/capabilities`, and `/v1/models` respond.
- API capabilities currently exposed locally include Chat Completions, Responses API, streaming, Runs API, run events SSE, run stop, tool progress events, and `X-Hermes-Session-Id`.
- Desktop bridge surface is broad: Electron preload, preload types, and Tauri bridge currently expose the same 118 `window.hermesAPI` methods.

## Implementation Status

- Done: desktop capability API for Hermes version, `/v1/capabilities`, `/v1/models`, Tool Gateway status, v0.12 gates, and update availability.
- Done: safe upgrade API that creates a Hermes backup, runs `hermes update --check`, then runs `hermes update`.
- Done: Curator command API for status, dry run, run, pause/resume, backup/rollback, pin/unpin, restore, plus report reading.
- Done: Runs API client methods for start, status, and stop.
- Done: Settings health UI for v0.12 readiness, API surface, Runs support, Tool Gateway eligibility, and backup-plus-upgrade.
- Done: Settings Curator tab with status, actions, skill pin/unpin/restore, and latest output/report.
- Done: Tools screen Tool Gateway eligibility banner.
- Remaining: switch primary chat streaming from Chat Completions/SSE to Runs events once the local install is upgraded to v0.12 and real event payloads can be verified.
- Remaining: native Tauri command implementations for the new APIs. The Tauri renderer bridge currently returns safe fallbacks for these new calls.

## Verification Baseline

Run these before and after feature work:

```bash
npm run typecheck
npm run test
npm run lint
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
npm run smoke:hermes
```

`npm run lint` is configured as a warning-first cleanup gate so active UI work is visible without blocking builds.

## Hermes v0.12 Features To Surface

- Curator: `hermes curator status`, dry run, run, backup, rollback, pause/resume, pin/unpin, restore.
- Self-improvement visibility: show memory/skill update activity and curator reports without letting the UI silently mutate protected skills.
- Tool Gateway: detect Nous Portal subscription status and expose managed web, image generation, TTS, and browser automation only when available.
- Model/provider upgrades: first-class LM Studio, GMI Cloud, Azure AI Foundry, MiniMax OAuth, Tencent Tokenhub, and remote model catalogs for Nous Portal/OpenRouter.
- API server upgrades: prefer Responses/Runs for long jobs and structured progress; keep Chat Completions as fallback.
- Media and creative tools: Piper/local TTS, Spotify, Google Meet plugin, ComfyUI, TouchDesigner-MCP, and native multimodal image routing.
- Gateway/platform expansion: plugin-hosted messaging adapters, Yuanbao, and Teams plugin support.

## Implementation Phases

### Phase 0 - Upgrade And Capability Gate

1. Done: Add a `getHermesCapabilities` desktop API that calls `/v1/capabilities`, `hermes --version`, and `hermes status`.
2. Done: Add version/capability gates in the renderer so v0.12-only controls are hidden or marked unavailable on v0.11.
3. Done: Add a safe upgrade flow: run `hermes backup`, `hermes update --check`, then `hermes update`, with post-update doctor/smoke checks.

### Phase 1 - Health Dashboard

1. In progress: Create a single health model for install, gateway, API server, model/provider, Tool Gateway, toolsets, skills hub, and optional integrations.
2. In progress: Surface actionable issues from `hermes doctor`: missing Tool Gateway subscription, optional tool keys, WhatsApp bridge audit, tinker-atropos, Skills Hub init.
3. Keep secrets masked and never render raw `.env` values.

### Phase 2 - Runs API Chat Runtime

1. Done: Keep current SSE chat path working.
2. In progress: Add a Runs API client for long-running tasks: start run, stream `/events`, stop run, resume by run/session id.
3. Remaining: Render structured tool progress events instead of flattening everything into assistant text.
4. Persist request ids and session ids so switching sessions never cross-wires streaming output.

### Phase 3 - Curator And Skills Control

1. Done: Add a Curator screen or Skills subtab with status, dry run, run now, pause/resume, backup/rollback, pin/unpin, restore.
2. Done: Show `logs/curator/run.json` and `REPORT.md` in the desktop UI.
3. Done: Protect hand-authored skills by making pinning explicit before enabling mutating curator workflows.

### Phase 4 - Tool Gateway And Toolsets

1. Done: Show Nous Tool Gateway eligibility from `hermes status`.
2. In progress: Add per-tool toggles for managed web, image generation, TTS, and browser automation.
3. Done: Keep direct API-key providers visible as fallbacks when Tool Gateway is unavailable.
4. Add browser private-url routing status so local dashboard testing and public browsing are understandable.

### Phase 5 - Second Brain And Memory

1. Treat Hermes built-in memory as small, curated working memory.
2. Put large knowledge into Obsidian, session search, and external memory providers instead of bloating `MEMORY.md`.
3. Turn the current desktop memory-limit override into an explicit "Long Memory experimental mode" with warnings, or restore upstream-sized limits.
4. Add provider setup/status flows for Honcho, OpenViking, Mem0, Hindsight, Holographic, RetainDB, ByteRover, and Supermemory.

### Phase 6 - Schedules And Gateway Automations

1. Let users schedule from an existing session or prompt, preserving model/provider/session metadata.
2. Add delivery-target health checks for Discord and configured gateway platforms.
3. Add job run history, last output, and retry/disable controls.

### Phase 7 - Performance And Packaging

1. Reduce renderer bundle cost from syntax highlighting by importing a light highlighter and registering only common languages.
2. Keep Tauri and Electron bridge coverage tests strict.
3. Move remaining Tauri fallback/stub commands to native implementations before making Tauri the default build.
4. Rebuild packaged artifacts only after source, build, smoke, and packaged launch checks pass.

## Key Risks

- Upstream Hermes memory limits are intentionally small; bypassing them in the desktop can cause prompt bloat or upstream rejection.
- Tool Gateway is subscription-gated, so the UI must distinguish "not configured" from "not included in account".
- v0.12 controls must be capability-gated because the current local install is still v0.11.
- The repo currently has substantial uncommitted feature work; stage narrowly and avoid bundling unrelated edits.

## Primary References

- https://github.com/NousResearch/hermes-agent/releases/tag/v2026.4.30
- https://hermes-agent.nousresearch.com/docs/user-guide/features/tools/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/api-server/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/curator/
- https://hermes-agent.nousresearch.com/docs/user-guide/features/memory/
