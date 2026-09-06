# Shared resources and Solid 2

Pocket Doc now uses PocketJS resource collections for file pages, Markdown
geometry, rendered document bands and source-text textures. **The app declares
identity, demand and decoding; the framework owns admission, cancellation,
retry, cache eviction and texture disposal.** The Mac still owns files, SQLite,
Markdown layout, syntax highlighting and glyph rasterization.

## Read ownership

The previous store kept request maps, stale-response tickets, eviction loops
and texture handles for each read type. A row miss could trigger a request
from app-specific code. The replacement declares each collection once:

```ts
import { createResourceScheduler } from "@pocketjs/framework/resource-cache";
import { offloadResource } from "@pocketjs/framework/resource-offload";

const scheduler = createResourceScheduler({
  maxConcurrent: 4, startsPerFrame: 2, completionsPerFrame: 1,
  maxCollections: 4,
  available: () => io.connected() && io.pending() < 4,
});
const tiles = scheduler.createCache({
  key: p => `${p.id}/${p.revision}/${p.layout}/${p.row}/${p.x}`,
  maxEntries: 72, maxCost: 72 * 40960,
  maxResponseBytes: 5000, cost: () => 40960,
  load: offloadResource(io, "document.tile", JSON.stringify),
  materialize: decodeAndUploadOneTile,
  dispose: tile => ops.freeTexture(tile.handle),
  changed: p => notifyRow(p.row),
});
```

The example omits app-specific types and decoder definitions; the complete
implementation is [app/resources.ts](../app/resources.ts). Texture reservations
include both old and replacement RGBA handles plus bounded wire data. A
response can arrive between frames, but decoding/upload waits for `step()`.

Each frame replaces the bounded working set with `reconcile(demands)`, then
calls `scheduler.step()`. Reading `state(input)` never starts IO. The planner
pins visible rows and assigns lower priority to directional prefetch. Missing
or failed entries render the app's skeleton/error subtree through
`ResourceBoundary` or `ResourceImage`. Ready textures outside the working set
can remain cached until admission needs their space. Stale replies cannot
allocate textures after cancellation, invalidation or disposal.

| Collection | Entry bound | Identity |
| --- | ---: | --- |
| File pages | 8 | Query and page offset |
| Layout windows | 8 | Document ID, revision, layout and first row |
| Markdown bands | 72 | Document ID, revision, layout, row and horizontal offset |
| Source text | 20 | Text, inverse state and cell width |

The cache instance belongs to one app/provider session. Reconnection invalidates
its reads. Refresh and document changes invalidate the affected collections.
The store retains geometry, row-slot notifications, viewport planning and the
editable source window because these are document UI rules.

**Save, delete, create and draft commands bypass the read scheduler.** They keep
explicit operation IDs, acknowledgement handling and the provider's SQLite
journal. A resource retry does not replay a command or change its durability.
Local typing still updates the draft before a network reply; non-ASCII texture
refresh and fetching an unloaded source window still require the Mac.

## Solid 1 to Solid 2 patterns

The paired runtime pins Solid **2.0.0-rc.6**, universal renderer **2.0.0-rc.6**
and Babel preset **2.0.0-rc.2**. This is a release-candidate dependency upgrade.

| Concern | Solid 1 | Solid 2 |
| --- | --- | --- |
| Held caret effect | `createEffect(() => blink.setHeld(caretDragging()))` | `createEffect(caretDragging, held => blink.setHeld(held))` |
| Modal cleanup | Read state and register `onCleanup` inside one effect | Compute the blocked state; apply returns the touch-block release function |
| Reply application | `batch(() => receive(reply))` | Apply the reply; the framework commits staged writes before drawing |
| Memo initial value | `createMemo(previous => ..., initial)` | `createMemo<T>((previous = initial) => ...)` |
| Simulator action | Call setter then inspect state | Enter the guest's `latest(run); flush()` action boundary |
| Runtime imports | Solid 1 core and `solid-js/universal` | One compiler-owned Solid 2 dependency graph and `@solidjs/universal` |

Modal input ownership is now explicit:

```ts
import { createEffect } from "solid-js";
import { pushTouchBlock } from "@pocketjs/framework/gesture";

createEffect(
  () => !!store.menu() || store.mode() === "create",
  blocked => { if (blocked) return pushTouchBlock(); },
);
```

The framework runs input controllers inside `latest()` and commits with
`flush()` before the native frame is drawn. Controllers can observe preceding
writes within that frame without rendering after every setter. The app does
not implement a second timer or Promise-draining loop.

Solid 2 async memos and `Loading` are validated with the native renderer, but
Pocket Doc's borrowed texture handles continue to use explicit resource states.
A retained async branch must not keep drawing a handle after cache eviction
frees it. **Async graph scheduling does not replace cache ownership or upload
budgets.** Making each row fetch through its own async memo would lose request
sharing and admission limits.

## Benefits and costs

The resource refactor reduces duplicated app scheduling logic and gives all
four read types the same bounded delivery, retry and disposal rules. These
benefits exist independently of the Solid upgrade. Solid 2 adds split effects,
automatic write batching and supported async graph behavior in the native
renderer. The same interaction replay passes, including editing, reconnect,
modal cleanup and inertial scrolling.

The upgrade increases guest size and stack requirements. It does not establish
a frame-time speedup. The former 128 KiB QuickJS smoke limit fails with the
Solid 2 bundle; **192 KiB passes**, while the unchanged native 3DS host has a
384 KiB limit. See [validation receipts](VALIDATION.md) for separate baseline,
refactor and Solid 2 measurements. The new native binary has not replaced the
installed demo on the 3DS.
