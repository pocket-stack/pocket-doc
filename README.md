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
| Library | D-pad selects; A opens; SELECT searches; L/R jump 100 entries |
| Reader | Touchpad drag/fling; d-pad/circle pad scroll; minimap jumps |
| Reader | A edits/resumes draft; B returns; L/R previous/next heading; Y follows first wiki link |
| Editor | Touch keyboard; trackpad and arrows move caret; A newline; B delete |
| Editor | START or SAVE saves; X or READ returns while retaining the draft |
| Editor | DISCARD then CONFIRM explicitly drops the draft |
| Host | L+R+START returns to Homebrew Launcher |

The 3DS panel supports one contact. All controls work with one stylus contact;
typing and relative caret movement share the same screen without hiding the
keyboard. The minimap uses sampled document line density and heading positions.

## Ownership and bounds

The app imports PocketJS APIs from `@pocketjs/framework/*`, and Solid primitives
from `solid-js`. The runtime is a pinned submodule. Framework changes belong to
PocketJS; Markdown, file revisions, editor state and controls belong here.

The Mac lays out each document revision and rasterizes individual **384×16**
text rows with its font fallback. A row is a **1,536-byte 2-bit alpha mask**,
encoded inside a bounded offload reply. The 3DS uploads it through the framework's
native coverage decoder and retains at most **72 document textures** plus **12
small text textures**. There are twelve mounted document rows. Scrolling uses
PocketJS `createScroller`, the same kinetic state machine as the Contacts demo.

Cache misses draw a quiet placeholder while loading. Network delay never stops
momentum; it can leave an uncovered region until the row arrives. The cache
prefetches ahead of motion and discards distant rows. Editing retains a source
excerpt of at most 384 original UTF-16 units, expandable to 768 units before
saving. Whole documents, directory scans, SQLite and Markdown layout stay off
the device's JS thread.

The renderer recognizes headings, paragraphs, quotes, lists and fenced code;
table-shaped lines remain text. Wiki links can open another indexed document. It is not a
complete CommonMark renderer or an Obsidian plugin runtime. Images, graph view,
multi-document editing and an IME are outside this version. Existing Unicode
text is rendered through Mac-generated coverage; the touch keyboard enters
Latin text and Markdown punctuation.

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
bun scripts/sim.ts
```

The simulator writes images and frame/caching evidence under `dist/qa`. Its
provider work executes outside the timed UI transaction. **Mac simulation
timing is not a 3DS performance result.** Native worker telemetry is written by
the running provider; installation readback, native rendering, live IO and
physical touch acceptance are separate receipts.

See [validation receipts](docs/VALIDATION.md) for measured results and the
remaining optimized-build device acceptance.

Pocket Term informed the decision to rasterize missing glyphs on the Mac.
Pocket Shell informed the screen split, contextual controls and simultaneous
keyboard/trackpad. Their app code is not copied. Neither #360 nor Pocket Vault
is a dependency.
