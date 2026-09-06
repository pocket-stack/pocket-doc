# Shared resources

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

## Runtime and verification

This resource refactor runs on the main branch's **Solid 1.9.14** dependency.
Effects, `batch`, renderer ownership and host frame delivery keep their existing
contracts. The cache scheduler is independent of Solid and can be reused through
PocketJS's other framework entrypoints.

Read admission, retries and texture disposal now have one implementation. These
are resource ownership and work-budget changes; they do not establish faster
physical frame times. See [validation receipts](VALIDATION.md) for the current
application checks and bundle cost. The QuickJS smoke check uses **128 KiB**,
while the native 3DS host remains at 384 KiB.
