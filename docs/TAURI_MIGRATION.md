# Tauri Migration Plan

> Convert 80m Agent Desktop from Electron to Tauri 2.x — smaller binaries, native performance, tighter OS integration, no bundled Chromium.

**Status:** Pre-planning. Not started.

---

## Why Tauri

| | Electron | Tauri 2.x |
|---|---|---|
| Binary size | ~150-250 MB | ~10-20 MB |
| Startup | Slower (full Chromium) | Near-instant |
| Security surface | Large (Chromium) | Minimal (WebView2/Safari) |
| Native APIs | Via Node.js | Direct Rust calls |
| Auto-update | electron-updater | Built-in (Tauri updater) |
| System tray | Manual | Built-in plugin |
| Notifications | Manual | Built-in plugin |

The 80m app is a chat + config UI — it doesn't need the full Chromium overhead. Tauri fits the use case better.

---

## Scope

### Out of scope for this migration
- Hermes Agent itself (stays as-is in `~/.hermes`)
- Backend API server (stays at `http://127.0.0.1:8642`)
- All React UI screens (kept as-is)
- All IPC handlers that talk to Hermes CLI

### In scope
1. Replace Electron main process + preload with Tauri Rust backend
2. Replace `electron-builder` packaging with `tauri build`
3. Port IPC handlers to Tauri commands
4. Port system tray, notifications, auto-updater to Tauri plugins
5. Replace `better-sqlite3` with `tauri-plugin-sql` (SQLite)
6. Rebuild all platform installers: Windows (.msi/.exe), macOS (.dmg/.app), Linux (.AppImage/.deb)

---

## Phase 1 — Foundation (1-2 weeks)

### 1.1 Scaffold Tauri project
```bash
npm create tauri-app@latest 80m-agent-desktop-tauri -- --template react-ts --manager npm
cd 80m-agent-desktop-tauri
```

Copy `src/renderer/` from the current repo. The Tauri template uses Vite + React so the frontend drops in cleanly.

### 1.2 Define Tauri commands (Rust side)
Map every current IPC handler to a `#[tauri::command]`:

| IPC channel | Tauri command | Notes |
|---|---|---|
| `hermes:install` | `install_hermes()` | Run `curl -fsSL https://hermes-agent.nousresearch.com/install.sh` |
| `hermes:status` | `hermes_status()` | Check `~/.hermes` exists + version |
| `hermes:chat` | `chat_stream()` | Spawn `hermes chat` subprocess, pipe SSE |
| `hermes:config:read` | `read_config()` | Read `~/.hermes/config.yaml` |
| `hermes:config:write` | `write_config()` | Write `~/.hermes/config.yaml` |
| `hermes:session:list` | `list_sessions()` | Query `~/.hermes/state.db` |
| `hermes:session:search` | `search_sessions()` | FTS5 query |
| `shell:exec` | `shell_exec()` | Run arbitrary shell (sandboxed to `~/.hermes`) |
| `app:backup` | `create_backup()` | Zip `~/.hermes` to Downloads |
| `app:open-url` | `open_url()` | Open link in system browser |

### 1.3 Migrate preload bridge
Replace `src/preload/` with `src-tauri/src/commands.rs`. Renderer calls become:
```ts
// Before (Electron)
const resp = await ipcRenderer.invoke('hermes:chat', { prompt, model })

// After (Tauri)
const resp = await invoke('chat_stream', { prompt, model })
```

### 1.4 Replace electron APIs
| Electron API | Tauri equivalent |
|---|---|
| `app.getPath('userData')` | `app.path().app_data_dir()` |
| `shell.openExternal()` | `shell.open()` |
| `app.setAboutPanelOptions()` | Native OS dialogs |
| `globalShortcut` | `tauri-plugin-global-shortcut` |
| `systemTray` | `tauri-plugin-tray` |
| `Notification` | `tauri-plugin-notification` |
| `autoUpdater` | `tauri-plugin-updater` |

---

## Phase 2 — Data Layer (1 week)

### 2.1 SQLite sessions
Current: `better-sqlite3` (Node.js native module)

Tauri option A — `tauri-plugin-sql`:
```rust
// Rust side
use tauri_plugin_sql::{Migration, Sql};
let migrations = vec![Migration {
    version: 1,
    sql: include_str!("migrations/001_sessions.sql"),
}];
Sql::new("sqlite:sessions.db", migrations).unwrap()
```

Option B — Keep `better-sqlite3` in a Node.js sidecar process (simpler but adds complexity).

Recommend Option A for cleaner Rust integration.

### 2.2 Credentials / .env
- Store API keys in the OS keychain via `tauri-plugin-store` (file-based encrypted store)
- Or use `tauri-plugin-secure-storage` for OS-native keyring (Keychain on macOS, Credential Manager on Windows)

---

## Phase 3 — Packaging (1 week)

### 3.1 Update `tauri.conf.json`
```json
{
  "productName": "80m Agent Desktop",
  "identifier": "com.80m.agent-desktop",
  "build": { "devtools": true },
  "bundle": {
    "active": true,
    "targets": ["nsis", "msi", "dmg", "app", "appimage", "deb"],
    "windows": { "nsis": { "installMode": "currentUser" } }
  },
  "plugins": {
    "updater": {
      "pubkey": "YOUR_UPSTREAM_PUBLIC_KEY",
      "endpoints": ["https://releases.80m.com/{{target}}/{{arch}}/{{current_version}}"]
    }
  }
}
```

### 3.2 Remove Electron-specific files
Delete after migration:
- `electron.vite.config.ts`
- `electron-builder.yml`
- `src/main/`
- `src/preload/`
- `src/main/`

### 3.3 App icons
Run `npm run tauri icon` — generates all sizes from `app-icon.png` in `src-tauri/icons/`.

---

## Phase 4 — Polish (3-5 days)

- [ ] System tray with context menu (Show/Hide, Quit)
- [ ] Native file dialogs for backup import/export
- [ ] Auto-updater with release notes
- [ ] Deep links (`80m://chat?session=xyz`)
- [ ] macOS: `app.handleAbout()` for About panel
- [ ] Windows: installer per-user vs per-machine option
- [ ] Linux: `.desktop` file with proper categories

---

## Build Commands

```bash
# Development
npm run tauri dev

# Build all platforms
npm run tauri build

# Platform-specific
npm run tauri build -- --bundles nsis
npm run tauri build -- --bundles msi
npm run tauri build -- --bundles dmg
npm run tauri build -- --bundles appimage
```

---

## Risks & Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| SSE streaming complexity in Rust | High | Use `tokio` async + `futures` stream; test with `curl` first |
| Hermes CLI compatibility | High | Current Hermes is Python — must remain `~/.hermes/hermes-agent` |
| `better-sqlite3` native module | Medium | Replace with `tauri-plugin-sql` (pure Rust SQLite) |
| IPC performance regression | Medium | Benchmark chat latency before/after |
| Auto-update key management | Low | Use GitHub Releases as update source (no signing key needed for OSS) |

---

## Timeline

| Phase | Effort | Duration |
|---|---|---|
| Phase 1 — Foundation | High | 1-2 weeks |
| Phase 2 — Data Layer | Medium | 1 week |
| Phase 3 — Packaging | Medium | 1 week |
| Phase 4 — Polish | Low | 3-5 days |
| **Total** | | **3-5 weeks** |

---

## Pre-requisites Before Starting

1. **Rust installed:** `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh`
2. **Tauri CLI:** `npm install -D @tauri-apps/cli`
3. **Tauri API package:** `npm install @tauri-apps/api`
4. **Remove Electron deps:** `npm uninstall electron electron-builder` (after migration)

---

## Useful Links

- [Tauri 2.x Docs](https://v2.tauri.app/)
- [Tauri Plugins](https://v2.tauri.app/plugin/)
- [Tauri Migration Guide (Electron → Tauri)](https://v2.tauri.app/start/migrate/from-electron/)
- [Tauri GitHub Actions template](https://github.com/tauri-apps/create-tauri-app)
