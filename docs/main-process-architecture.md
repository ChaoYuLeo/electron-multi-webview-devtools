# Main Process Architecture

This document explains the current Electron main-process architecture.

It is intended for maintainers who need to extend session management, embedded DevTools behavior, or viewport/layout orchestration.

## Design Goals

- Keep the main-process entry thin and explicit
- Separate state ownership from behavior orchestration
- Isolate Electron view lifecycle from Chrome DevTools Protocol logic
- Make session-related behavior easy to change without touching startup code
- Keep renderer-to-main contracts stable and narrow

## Module Layout

```text
src/main
├── index.ts               # Entry only, starts MainApp
├── app.ts                 # App bootstrap, window creation, IPC registration
├── state.ts               # In-memory state store for window, layout, sessions
├── session-manager.ts     # Session lifecycle, navigation, event binding
├── layout-manager.ts      # WebContentsView attach/detach and bounds sync
├── emulation-manager.ts   # Mobile metrics, touch mode, inspect mode
├── devtools-manager.ts    # DevTools initialization and frontend bridge injection
├── constants.ts           # Shared constants
└── types.ts               # Main-process internal types
```

## Layering

The current structure is intentionally split into four layers:

1. Entry layer
   `index.ts`
   Only starts the application.

2. Composition layer
   `app.ts`
   Wires modules together, owns Electron app startup, main window creation, and IPC registration.

3. Domain behavior layer
   `session-manager.ts`
   `layout-manager.ts`
   `emulation-manager.ts`
   `devtools-manager.ts`
   Each module owns one coherent behavior area.

4. State and contract layer
   `state.ts`
   `types.ts`
   `constants.ts`
   Holds shared state and internal data structures used by the domain modules.

## Responsibilities

### `index.ts`

- Creates `MainApp`
- Starts the app
- Must remain free of business logic

### `app.ts`

- Waits for `app.whenReady()`
- Sets the app model id
- Creates the main `BrowserWindow`
- Registers IPC handlers
- Connects module dependencies
- Emits session updates to the renderer

Rule:
`app.ts` can coordinate modules, but should not absorb session logic, protocol logic, or layout math.

### `state.ts`

- Stores:
  - main window reference
  - active session id
  - session map
  - session order counter
  - latest layout payload from renderer
- Provides read/write accessors
- Produces ordered session lists for renderer consumption

Rule:
`state.ts` should remain an in-memory state holder, not a behavior-heavy service.

### `session-manager.ts`

- Creates and destroys sessions
- Normalizes URLs
- Owns content/devtools `WebContentsView` instances per session
- Binds webContents events
- Updates navigation/loading metadata
- Delegates:
  - DevTools setup to `devtools-manager`
  - emulation and inspect mode to `emulation-manager`
  - view mounting/sizing to `layout-manager`

Rule:
If a change is about session lifecycle, navigation, or webContents event reactions, it belongs here first.

### `layout-manager.ts`

- Attaches and detaches views from the main window
- Applies bounds to the active content view and active DevTools view
- Builds stacked preview layout for background sessions
- Triggers emulation updates when viewport bounds change

Rule:
All `WebContentsView` bounds math stays here. Do not spread geometry calculations across other modules.

### `emulation-manager.ts`

- Attaches the debugger lazily
- Enables DOM/Overlay protocol domains
- Applies mobile metrics override
- Switches touch/mouse interaction mode
- Keeps inspect mode state synchronized with the hosted page

Rule:
Any Chrome DevTools Protocol calls related to emulation or inspect mode should live here.

### `devtools-manager.ts`

- Connects hosted page webContents to dedicated DevTools webContents
- Opens embedded DevTools
- Injects a small bridge script into the DevTools frontend
- Detects inspect-mode toggles initiated inside DevTools UI

Rule:
DevTools frontend-specific logic belongs here, not in `session-manager.ts`.

## Runtime Flow

### Startup

1. `index.ts` starts `MainApp`
2. `MainApp.start()` waits for Electron readiness
3. `MainApp` registers IPC handlers
4. `MainApp` creates the main window
5. The first default session is created
6. Renderer reports layout rectangles through `app:set-layout`
7. `layout-manager` mounts and sizes the active views

### Session Creation

1. Renderer requests `app:create-session`
2. `session-manager` creates one content view and one DevTools view
3. Session state is inserted into `state.ts`
4. If needed, the new session becomes active
5. `layout-manager` syncs attached views
6. The content view loads the requested URL
7. On `dom-ready` and `did-finish-load`, DevTools and emulation are applied

### Inspect Mode Synchronization

There are two possible inspect-mode entry points:

- Renderer explicitly toggles inspect mode through IPC
- DevTools frontend toggles inspect mode internally

Synchronization path:

1. Inspect mode change is detected
2. `emulation-manager` updates in-memory inspect state
3. Touch mode and cursor mode are switched accordingly
4. Overlay protocol mode is updated when necessary
5. Updated session list is emitted back to renderer

## State Ownership

Main-process state is intentionally centralized in `MainState`.

Ownership rules:

- `MainState` owns canonical session records
- `session-manager` mutates per-session navigation and lifecycle state
- `emulation-manager` mutates debugger/overlay/inspect-related session state
- `layout-manager` reads state but should not invent persistent session metadata
- `app.ts` should avoid storing parallel copies of session state

This prevents duplicated truth across modules.

## Dependency Direction

The dependency direction should remain:

```text
index.ts
  -> app.ts
     -> state.ts
     -> session-manager.ts
     -> layout-manager.ts
     -> emulation-manager.ts
     -> devtools-manager.ts
```

Important constraints:

- `state.ts` should not depend on managers
- `layout-manager.ts` should not know about IPC
- `emulation-manager.ts` should not create or destroy sessions
- `devtools-manager.ts` should not manage window layout
- `session-manager.ts` may coordinate managers, but should not replace them

## Extension Guide

When adding new capabilities, use these placement rules:

- Add session persistence:
  create a dedicated persistence module and let `app.ts` or `session-manager.ts` orchestrate it

- Add device presets:
  place preset definitions beside `emulation-manager.ts`, keep protocol application in `emulation-manager.ts`

- Add session grouping, pinning, or metadata:
  extend `state.ts` types and `session-manager.ts`

- Add alternative preview layout strategies:
  change `layout-manager.ts`

- Add more DevTools UI synchronization:
  extend `devtools-manager.ts`

- Add new renderer commands:
  register IPC in `app.ts`, route behavior to the relevant manager

## Guardrails

To keep the architecture stable, avoid the following:

- Reintroducing business logic into `index.ts`
- Letting `app.ts` grow into a second monolith
- Mixing protocol commands with window layout code
- Writing directly to session maps from multiple modules without going through clear ownership boundaries
- Coupling renderer-specific assumptions into every manager

## Quick Decision Rules

If you are unsure where code belongs:

- "Does it create, close, navigate, or react to a page event?"
  Put it in `session-manager.ts`

- "Does it compute bounds or mount/detach views?"
  Put it in `layout-manager.ts`

- "Does it call `webContents.debugger.sendCommand(...)` for emulation or inspect behavior?"
  Put it in `emulation-manager.ts`

- "Does it touch embedded DevTools frontend behavior?"
  Put it in `devtools-manager.ts`

- "Does it wire modules or IPC together?"
  Put it in `app.ts`
