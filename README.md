# Pocket Doc

A Markdown library and source editor for the Nintendo 3DS, backed by a paired
Mac. The Mac owns files, SQLite full-text search and text layout. The 3DS owns
the two-screen interface, scrolling momentum, selection and the current draft.

The generated test library contains **1,000 files**, from **114,690 bytes** to
**1,049,446 bytes**, totalling **157,277,771 bytes**. Eight original synthetic
scenarios cover API handbooks, SQL cookbooks, design decisions, experiments,
meetings, recovery runbooks, interface guides and multilingual journals. Ten
files are approximately 1 MiB. `bun run seed` deterministically generates them
under the ignored `data/library-v2/` directory and never overwrites existing
files. The earlier `data/library/` fixture can remain beside it. Only bounded
pages and visible rows cross the network.

<img src="docs/read.png" width="400" alt="Pocket Doc reader and bottom-screen navigation" />
<img src="docs/edit.png" width="400" alt="Source editing with keyboard and trackpad together" />

## Run

Use the 3DS build prerequisites described by the pinned runtime's
`hosts/3ds/README.md` (Rust toolchain, QuickJS sources and devkitARM container).
The initial implementation is on `feat/markdown-library` while its PR is Draft.

```sh
git clone --branch feat/markdown-library --recursive https://github.com/pocket-stack/pocket-doc.git
cd pocket-doc
bun install --cwd runtime --frozen-lockfile
bun scripts/setup.ts
bun run seed
bun run 3ds
# With ftpd open on the selected 3DS:
bun scripts/deploy.ts <3ds-ip>
bun run host <3ds-ip>
```

Exit ftpd and launch Pocket Doc from HBL. `scripts/deploy.ts` transfers the
app-specific pairing key and `.3dsx`, then reads both back byte-for-byte. Keys,
generated documents, SQLite, build products and logs are ignored by Git.

## Controls

| State | Controls |
| --- | --- |
| Both panes | Left/right chooses focus; up/down navigates the focused pane |
| Library | Left touchpad/circle pad scrolls; tapping focuses Files; A opens; SELECT searches |
| Reader | Right touchpad scrolls/flings; tapping focuses Document; d-pad/circle pad scrolls |
| Editor | Hold SPACE for 350 ms, then drag to move caret; short tap inserts space; arrows also move caret |
| Editor | Right pad scrolls source; the Select touch button arms selection with held-space dragging; COPY copies it |
| Editor | Top Read returns to reading and retains the draft; Save / START saves; Resume reopens it |
| Editor | Discard opens a sheet; Keep Editing / B cancels; Discard Changes / A confirms |
| Host | L+R+START returns to Homebrew Launcher |

Hold **L** for a centered file-command list: Open, Search, Clear search,
Refresh and Focus files. Up/down chooses an item; A runs it. Hold **R** for a
centered three-column document panel: Edit, Read, Save; Undo, Redo, Select;
Previous heading, Next heading, Follow link; Copy, Paste, Discard. All four
directions navigate this grid. Unavailable commands are dimmed. B cancels;
releasing the shoulder closes the panel. After confirmation, the same held
shoulder must be released before its panel can open again. Menu navigation
leaves pane focus, scrolling and source text unchanged. ZL/ZR have no app commands.

After touch or circle-pad scrolling leaves the selected file offscreen, the
next up/down press selects the first visible file. Further presses move normally.

The 3DS panel supports one contact. All controls work with one stylus contact;
typing and relative caret movement share the same screen without hiding the
keyboard. The active pad has a blue header, and the bottom navigation bar names the focused pane.
Editing shows persistent Read, Discard and Save controls. The space key is
138px wide; the keyboard contains no duplicate Save button. The upper screen uses
an iOS 6 light palette, with a persistent 128-pixel file pane and 256-pixel
document pane. File labels are 12px. Body text remains 13px, headings 14px, source 12px and document
line spacing 20px. The book logo is a packed image, independent of font glyphs.

## Classic controls and source geometry

Buttons, keycaps, panel rims and selected rows use the shared
`@pocketjs/framework/classic` palette and components. A button depresses on touch,
activates on release inside, and cancels when the contact slides outside, the
button becomes disabled or a modal blocks its gesture. Select and Copy form
adjacent toolbar actions with one shared border; Select retains the blue state
while selection is active in the editor. Read clears this state; Select is
disabled in reading mode, and Edit/Resume is the explicit entry to source mode. File selection uses the same blue gradient with
white labels. Panel fills are inset so their header cannot cover the rounded rim.

The bevels and action-sheet arrangement reference Apple's archived
[iOS 6 controls](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/TransitionGuide/Controls.html)
and [temporary views](https://developer.apple.com/library/archive/documentation/UserExperience/Conceptual/TransitionGuide/TempViews.html).
The framework `ClassicSheet` presents the red confirmation and Keep Editing
buttons with a 4px gap. Its native slide/fade animations take 220ms to open and
180ms to close. Touch and hardware input remain blocked through closing.
Confirming drops the local draft without saving or changing the Mac document.

Source geometry uses the baked font's **measured 7px advance**, rather than its
8px atlas envelope. This measurement drives caret and selection positions and
travels with source-tile requests; the Mac places and clips fallback glyphs to
the same grid, with two cells for wide characters. The editor still wraps at
30 cells. This fixes the visible caret drift that made `This is|` appear to
insert before the final `s` even though the underlying UTF-16 insertion was local.

Shift has three states: off, one uppercase character, and caps lock. Two taps
within 350ms enable caps lock, shown by a second bar below the arrow. One tap
on the locked key unlocks it. Undo and Redo keep at most 32 local excerpt
snapshots; new input drops the redo branch, and save/discard/new-document loads
clear the history. Both operations work while offline.

## Code blocks

The Mac worker uses a retained [Shiki highlighter](https://shiki.style/guide/install)
with the GitHub Light theme. Supported grammars include TypeScript, JavaScript,
JSON, Python, Bash, SQL, Rust, C/C++, CSS, HTML, YAML and diff. Backtick and tilde
fences preserve multiline grammar state; unknown languages retain a plain
monospace fallback. Tabs advance to four-cell stops. Long lines wrap within
the document pane on a 7px fixed grid, with two cells for wide characters.

Coverage is unchanged at 1,024 bytes per row. Highlighted rows additionally
send 256 palette indices and at most sixteen RGB colors, within the existing
2,500-character reply limit. The framework colors the coverage in native code
using the same scratch buffer and one texture upload per frame. No grammar,
syntax tokens or HTML enter the handheld runtime.

<img src="docs/code.png" width="400" alt="Monospace TypeScript with streamed syntax colors" />
<img src="docs/commands.png" width="400" alt="Centered directional document commands" />

## Ownership and bounds

The app imports PocketJS APIs from `@pocketjs/framework/*`, and Solid primitives
from `solid-js`. The runtime is a pinned submodule. Framework changes belong to
PocketJS; Markdown, file revisions, editor state and controls belong here.

The Mac lays out each document revision and rasterizes individual **256×16**
text rows with its font fallback. A row is a **1,024-byte 2-bit alpha mask**,
encoded inside a bounded offload reply. The 3DS uploads it through the framework's
native coverage decoder and retains at most **72 document resources/textures**
plus **20 small text textures** and 96 file/row metadata entries per cache.
There are twelve mounted rows per pane. Each physical slot follows its row until
it leaves the viewport; crossing one row reassigns one slot. Per-slot notifications
keep arriving resources from invalidating the whole view. Row movement uses
paint transforms. Scrolling uses
PocketJS `createScroller`, the same kinetic state machine as the Contacts demo.

Cache misses use PocketJS `ResourceBoundary` / `ResourceImage` with
application-supplied, natively animated skeleton components. **Availability is
separate from transport**: a pending image or table band substitutes its own
subtree while input, scrolling and other content continue. The outer image
view reserves its size; it borrows a texture handle from the bounded cache.
The resource model supports already-uploaded images as well as text coverage;
this app does not yet fetch Markdown image attachments.

At most **four app requests** are outstanding. User commands can displace
speculative reads; document start/end jumps cancel local interest in reads for the old
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

The editor uses framework `createCaretBlink` from `@pocketjs/framework/animation`:
focus, typing and movement restart its visible phase, a held-space drag keeps it
visible, and losing focus hides it. One cancellable virtual-clock deadline
controls blinking; it adds no network dependency or per-frame UI writes.

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
bun scripts/scroll-replay.ts
# Install the QuickJS CLI once with: brew install quickjs
qjs --std --stack-size 131072 scripts/quickjs-smoke.js
```

The simulator writes images and behavioral/caching evidence under `dist/qa`.
It replays directional command panels and auxiliary touch hit facts with delayed provider
replies. **Mac simulation is not a 3DS performance result.** Native worker telemetry is written by
the running provider; installation readback, native rendering, live IO and
physical touch acceptance are separate receipts.

The QuickJS smoke check executes the compiled guest with a **128 KiB stack**
and stub host operations. It covers startup, pending/ready/error resources,
table textures, source editing, Unicode resources and disconnection. CI runs
this check because a Bun/Wasm replay does not exercise QuickJS's recursive
interpreter stack. Native ARM capture remains a separate validation gate.

See [validation receipts](docs/VALIDATION.md) for measured results and the
remaining device acceptance of the interaction revision.

Pocket Term informed the decision to rasterize missing glyphs on the Mac.
Pocket Shell informed the screen split, contextual controls and simultaneous
keyboard/trackpad. Their app code is not copied. Neither #360 nor Pocket Vault
is a dependency.
