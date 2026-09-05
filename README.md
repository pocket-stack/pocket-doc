# Pocket Folio

A Markdown library and source editor for the Nintendo 3DS, backed by a paired
Mac. The Mac owns files, SQLite full-text search and text layout. The 3DS owns
the two-screen interface, scrolling momentum, selection and the current draft.

The test library contains **1,000 files, each at least 114,722 bytes**, totalling
114,872,771 bytes before edits. Only bounded pages and visible text rows cross
the network.

<img src="docs/read.png" width="400" alt="Pocket Folio reader and bottom-screen navigation" />
<img src="docs/edit.png" width="400" alt="Source editing with keyboard and trackpad together" />

## Run

Use the 3DS build prerequisites described by the pinned runtime's
`hosts/3ds/README.md` (Rust toolchain, QuickJS sources and devkitARM container).
The initial implementation is on `feat/markdown-library` while its PR is Draft.

```sh
git clone --branch feat/markdown-library --recursive https://github.com/pocket-stack/pocket-folio.git
cd pocket-folio
bun install --cwd runtime --frozen-lockfile
bun scripts/setup.ts
bun run seed
bun run 3ds
# With ftpd open on the selected 3DS:
bun scripts/deploy.ts <3ds-ip>
bun run host <3ds-ip>
```

Exit ftpd and launch Pocket Folio from HBL. `scripts/deploy.ts` transfers the
app-specific pairing key and `.3dsx`, then reads both back byte-for-byte. Keys,
generated documents, SQLite, build products and logs are ignored by Git.

## Controls

| State | Controls |
| --- | --- |
| Both panes | Left/right chooses focus; up/down navigates the focused pane |
| Library | Left touchpad scrolls/flings; its inset minimap jumps; A opens; SELECT searches |
| Reader | Right touchpad scrolls/flings; its inset minimap jumps; d-pad/circle pad scrolls |
| Editor | Keyboard and both pads remain visible; right pad/arrows move caret; A newline; B delete |
| Editor | SELECT inside the right pad arms drag-selection; EDIT/READ enters or leaves source editing |
| Editor | START or keyboard DONE saves; X returns to reading while retaining the draft |
| Host | L+R+START returns to Homebrew Launcher |

Holding a shoulder opens its menu on the corresponding side of the upper
screen. Labels and dispatch use the **same command table**. The shoulder itself
does not move either viewport. During editing, hold a shoulder with left/right
to switch pane focus; plain left/right moves the caret.

| Hold | A | B | X | Y |
| --- | --- | --- | --- | --- |
| L | Open selected | Focus list | Search | Refresh list |
| R | Edit / resume | Read / retain draft | Save | Follow first wiki link |
| ZL | Toggle selection | Copy | Paste | Discard, then confirm |
| ZR | Focus document | Document start | Next heading | Document end |

On a model without ZL/ZR, use **L+SELECT / R+SELECT** for those banks. After
touch scrolling or a minimap jump leaves the selected file offscreen, the next
up/down press selects the first visible file. Further presses move normally.

The 3DS panel supports one contact. All controls work with one stylus contact;
typing and relative caret movement share the same screen without hiding the
keyboard. Each touchpad has a minimap on its left edge. The upper screen uses
an iOS 6 light palette, with a persistent 128-pixel file pane and 256-pixel
document pane. Body text remains 13px, headings 14px, source 12px and document
line spacing 20px. The book logo is a packed image, independent of font glyphs.

## Ownership and bounds

The app imports PocketJS APIs from `@pocketjs/framework/*`, and Solid primitives
from `solid-js`. The runtime is a pinned submodule. Framework changes belong to
PocketJS; Markdown, file revisions, editor state and controls belong here.

The Mac lays out each document revision and rasterizes individual **256×16**
text rows with its font fallback. A row is a **1,024-byte 2-bit alpha mask**,
encoded inside a bounded offload reply. The 3DS uploads it through the framework's
native coverage decoder and retains at most **72 document resources/textures**
plus **20 small text textures** and 96 file/row metadata entries per cache.
There are twelve mounted rows per pane. Scrolling uses
PocketJS `createScroller`, the same kinetic state machine as the Contacts demo.

Cache misses use PocketJS `ResourceBoundary` / `ResourceImage` with
application-supplied, natively animated skeleton components. **Availability is
separate from transport**: a pending image or table band substitutes its own
subtree while input, scrolling and other content continue. The outer image
view reserves its size; it borrows a texture handle from the bounded cache.
The resource model supports already-uploaded images as well as text coverage;
this app does not yet fetch Markdown image attachments.

At most **four app requests** are outstanding. User commands can displace
speculative reads; minimap jumps cancel local interest in reads for the old
region. Already executing host work may finish, but stale replies do not update
the new view. The cache prefetches ahead of motion and discards distant rows.
Network delay can leave visible skeletons while momentum continues.
Editing retains a source
excerpt of at most 384 original UTF-16 units, expandable to 768 units before
saving. Whole documents, directory scans, SQLite and Markdown layout stay off
the device's JS thread.

The renderer recognizes headings, paragraphs, quotes, lists, fenced code and
pipe tables. The host sends bounded table geometry separately from text tiles.
The device draws the grid and column-shaped skeletons; wrapped cell bands keep
the original Markdown source offsets for editing. Wiki links can open another indexed document. It is not a
complete CommonMark renderer or an Obsidian plugin runtime. Images, graph view,
multi-document editing and an IME are outside this version. Existing Unicode
text is rendered through Mac-generated coverage; the touch keyboard enters
Latin text and Markdown punctuation.

Keystrokes update the draft and caret locally. ASCII source lines also render
locally; changed lines containing non-ASCII text require a new Mac-rendered
texture, so their visual echo still depends on the network. The current editor
pauses text input while a save is pending.

## Saving and disconnection

Save requests include the source revision and a unique operation identity.
The provider verifies the current file hash, writes and fsyncs a temporary file,
records the operation in SQLite, atomically replaces the document, then records
completion. Startup reconciles prepared operations. Repeating the same operation
returns its previous result; reusing its identity for different content fails.

A detected external edit produces a conflict and leaves the draft on the 3DS.
An unacknowledged save has an unknown outcome; pressing SAVE again reuses its
identity. No sent mutation is automatically retried. Do not open another file
while a dirty draft remains. Drafts survive network loss, not application exit
or device power loss. Other Mac editors do not participate in the save protocol;
the hash check detects changes before replacement but cannot lock out an
uncooperative writer racing the rename.

The granted library is a flat directory of Markdown files, up to 4 MiB each.
Requests use database IDs, not device-supplied paths. The LAN transport is paired
but unencrypted; use it on the trusted local network.

## Check

```sh
bun run check
bun runtime/node_modules/typescript/bin/tsc --noEmit
bun run 3ds --pocket-only
bun runtime/tools/wasm.ts
bun scripts/sim.ts
```

The simulator writes images and behavioral/caching evidence under `dist/qa`.
It replays button chords and auxiliary touch hit facts with delayed provider
replies. **Mac simulation is not a 3DS performance result.** Native worker telemetry is written by
the running provider; installation readback, native rendering, live IO and
physical touch acceptance are separate receipts.

See [validation receipts](docs/VALIDATION.md) for measured results and the
remaining device acceptance of the interaction revision.

Pocket Term informed the decision to rasterize missing glyphs on the Mac.
Pocket Shell informed the screen split, contextual controls and simultaneous
keyboard/trackpad. Their app code is not copied. Neither #360 nor Pocket Vault
is a dependency.
