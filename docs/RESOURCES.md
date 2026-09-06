# Resources and views

Pocket Doc uses PocketJS resource collections for file pages, Markdown geometry,
rendered document bands and Unicode text textures. **The app declares identity,
demand and decoding; PocketJS owns scheduling, subscriptions and cleanup.** The
Mac owns files, SQLite, Markdown layout, syntax highlighting and rasterization.
Solid remains at **1.9.14**. No Solid 2 migration is included.

## Define once, consume from independent views

The application creates one resource runtime with four active requests, two
starts and one materialization per frame. The runtime registers its frame hook
on mount and disposes collections with its Solid owner. Texture collections
declare `materialize` and `dispose` once. `maxViews` bounds consumers and
`maxDemandsPerView` bounds each consumer's demand; entry and byte limits bound
resident values independently of that union.

| Collection | Entries | Views | Identity |
| --- | ---: | ---: | --- |
| File pages | 8 | 2 | Query and page offset |
| Layout windows | 8 | 2 | Document ID, revision, layout and first row |
| Markdown bands | 72 | 2 | Document ID, revision, layout, row and horizontal offset |
| Unicode text | 20 | 32 | Text, inverse state and cell width |

Each Unicode text component creates its own view with at most one demand:

```tsx
import { createResourceView } from "@pocketjs/framework/resource-view";
import { ResourceImage } from "@pocketjs/framework/resource";

const input = () => ({
  text: props.value(), inverse: !!props.inverse,
  cellWidth: props.store.sourceCellWidth,
});
const view = createResourceView(props.store.text, {
  demand: () => props.active() && unicode()
    ? [{ input: input(), priority: 2, pin: true }]
    : [],
});

<ResourceImage state={() => view.state(input())}
  fallback={() => <Skeleton />} />
```

The snippet abbreviates component props and layout. See
[app/app.tsx](../app/app.tsx) and [app/resources.ts](../app/resources.ts).
Identical labels in separate components share one value and request. Unmounting
one component removes only its demand. A mounted but clipped row returns empty
demand; the app retains its viewport and fixed rendering-slot rules.

Document and file views use the same API with a larger demand set. File pages
project to individual rows with `view.state(pageInput, page => page.rows[index])`;
page failures remain errors. `view.value(input)` supports optional geometry.
Document and text textures return the `ResourceImage` shape directly, removing
the previous handle-to-image state wrappers.

**Reads subscribe by key without initiating IO.** Demand is evaluated at the
frame boundary. Only consumers of a changed key are notified; changes to a
view's key set update its membership subscribers. A view reads pending for keys
outside its last planned demand. Queued responses hold shared concurrency credit
until bounded decoding/upload. Oversubscribed views remain pending within the
existing cache budgets. Texture reservations include old and replacement handles.

## Application code before and after

The first extraction moved request tickets and eviction into the framework but
retained manual notification maps and cache-shaped store wrappers:

```ts
// Before: definition, controller and reader each participate in notification.
changed: input => changes.tile(input.row)
tile: row => rowChanges.notify(row)
rowResource: row => {
  rowChanges.read(row);
  return resources.tiles.state(tileInput(row));
}
```

The scoped adapter removes that connection code:

```ts
const tiles = createResourceView(resources.tiles, {
  demand: () => tileDemand(doc(), firstRow(), rowCount(), direction(), x),
});
const rowResource = row => tiles.state(tileInput(row));
```

The snippets omit application-specific types and guard branches. The final
migration removes `createRowChanges`, manual version signals, the central scan
of Unicode text, `get/has` compatibility wrappers, explicit read reconciliation
and the store's scheduler step/disposal hook. Local draft editing, command
acknowledgement and viewport selection remain in the application.

| Affected application files, physical lines | Before extraction | First extraction | Scoped views |
| --- | ---: | ---: | ---: |
| `app.tsx`, `resources.ts`, `store.ts`, `window.ts` combined | 893 | 937 | 891 |

The scoped migration removes **46 net application lines** from the first
extraction (`8b42d0e`), including its new view declarations. Compared with main
before extraction (`8cae6a6`), these files contain two fewer lines while using
shared scheduling and owner cleanup. Other application files are unchanged.
This counts source lines, including comments and blank lines; it does not count
documentation, tests or the runtime submodule as application savings.

## Commands and recovery

**Save, delete, create and draft commands bypass the read scheduler.** They retain
operation IDs, acknowledgement handling and the provider's SQLite journal.
Resource retries never replay a command. Local typing still updates the draft
before a network reply. Fetching unloaded source and rasterizing Unicode text
still require the paired Mac.

Reconnection invalidates read collections; mutations retain their existing
recovery rules. Completion delivery follows arrival order across collections.
An admission refusal skips that key for the frame without resetting accumulated
failures or preventing healthy loaders from starting. See
[validation receipts](VALIDATION.md) for tests, build sizes and limits.
