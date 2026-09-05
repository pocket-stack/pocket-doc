# Validation receipts

The initial library has **1,000 Markdown files**, at least **114,722 bytes** each,
totalling **114,872,771 bytes** before editing. The generated files are excluded
from Git; `bun run seed` recreates the fixture without overwriting existing files.

## Automated checks

- Thirteen application tests pass: SQLite paging/search, Unicode coverage, source
  ranges, atomic saves, operation identity, restart recovery, external-edit
  conflicts, path confinement, real TCP-to-Worker dispatch, table wrapping and
  source offsets, shoulder command banks, viewport selection and caret boundaries.
- TypeScript and the production guest build pass against the pinned runtime.
- The native ARM build produces a production `.3dsx`.
- The compiled guest Wasm simulation runs **922 frames and 31 behavioral checks**
  against the full library, with replies delayed four frames. It exercises
  actual auxiliary touch hit facts for both pads, keyboard, held-space caret movement and selection;
  verifies shoulder menus do not jump or leak ordinary A/B actions; and checks
  animated offline skeletons and table fallback replacement without viewport movement.
  After disconnecting during a fling, its offset advances from 106.82 to 687.53
  pixels. At every sampled frame, document textures and resource slots stay
  within 72 and pending app requests within four. A locally edited draft survives
  disconnection. This is **behavioral evidence
  on Mac**, not a measurement of 3DS frame time.

`read.png`, `edit.png`, `table.png`, `table-loading.png` and `menu.png` are
simulation captures of the compiled app. Run
`bun scripts/sim.ts` after building the guest and the runtime Wasm artifact to
refresh captures and `dist/qa/sim.json`.

## Physical device

The initial production build and app-scoped pairing key were transferred to
172.20.12.37 over ftpd and read back byte-for-byte. The application connected
to the Mac provider. **One device-originated save completed**: document ID 7
has 115,287 bytes, and its current SHA-256 matches the acknowledged revision
in SQLite. The complete library now has 114,872,765 bytes.

Initial telemetry exposed slow frames during loading and interaction, including
a maximum CPU measurement of 141,004 microseconds. That build expanded coverage
pixels in guest JavaScript and mounted the keyboard when entering the editor.
The subsequent build uses native bounded coverage decoding and precreated keyboard
and source rows. **That build was installed and verified by byte-exact
FTP readback**: 1,614,116 bytes, SHA-256
`78358713fa5507f498961c44bc290bad4de1a883191ecbb43dd1211c556a2b57`.
After its relaunch, telemetry still reported long frames, including a maximum
CPU measurement of 151,856 microseconds. **It has not established a smooth
frame-time result.**

The new interaction revision adds the light dual-pane layout, four shoulder
command banks, split pads, resource fallbacks and tables. Its production native
build passes. **The interaction build and app-scoped pairing key are installed
and verified by byte-exact FTP readback** at 172.20.12.37:5000. The matching Mac
provider was restarted. On launch, the user reported **FAILED: stack overflow**;
the provider stayed at zero frames. A native ARM capture reproduced the same
exception before the first frame. The Bun/Wasm replay had missed this failure.

The review build is **1,640,516 bytes**, SHA-256
`508e8cb2eacbc0c960693ddf4ae678a276dd9fe71d793bafbb60c78b9a7edfcd`.
Its runtime pin is `7659028790d0a92b6bef7d74c45ede75fa73e28a`.

## Startup stack regression

Nested resource fallbacks and pane wrappers retained a deep chain of synchronous
children/effect construction. The fix constructs fixed row/menu subtrees before
inserting them into their parent panes. The framework creates image containers
before constructing their deferred content and removes an unnecessary conditional
component wrapper. **The 3DS QuickJS stack limit remains 192 KiB.**

The compiled guest now passes **601 frames in QuickJS with a 128 KiB stack**,
including offline startup, table texture reveal, error fallback, retry, editor
entry, Unicode text and draft retention. This check runs in application CI.
The original bundle failed even its offline startup at that limit. Stack use
depends on the CPU/compiler; the Mac check complements the native ARM gate.
The compiled-guest Wasm interaction replay and application tests also pass.

The fixed ARM capture boots successfully and writes both the 400×240 upper
screen and 320×240 lower screen plus its completion marker. The captures show
the light interface and animated-resource placeholders. The **fixed production
build and pairing key are installed with byte-exact FTP readback**. The binary
is **1,639,940 bytes**, SHA-256
`7c70bae6c0f5e3d5d296378fd8e09aa7afa1419455b2b0bc64bdf53ed125160e`,
using runtime `08b20a4a` with the original 192 KiB stack limit. **The user confirmed
that this build launches from HBL.** They subsequently reported uneven continuous
circle-pad scrolling and requested the usability changes below.

## Usability revision

The upper focus stripe and both minimaps are removed. Bottom pad headers and
navigation text identify pane focus. Editing has persistent READ / EDITING / SAVE
navigation, a source-scrolling pad, a packed Shift arrow, and held-space relative
caret movement with selection. File labels use 12px text. The runtime pin is
`d2f69aab`; its caret controller has four tests covering 30/60 Hz, input reset,
held drags, focus, disposal and reentrant callbacks.

`bun scripts/scroll-replay.ts` replays 180 full-deflection downward circle-pad
frames followed by 180 upward frames, with actual host replies delayed four
frames. The previous bundle made **7,817 UI mutation calls** (3,922 down / 3,895
up); this revision makes **1,540** (747 / 793), a **80.3% reduction**. The sampled
peak falls from 83 to 56 calls. Calls counted are setProp, setStyle, setText,
setImage, createNode, destroyNode, insertBefore and removeChild. This excludes
texture upload cost and host computation. At constant full deflection, after
30 settling frames, scroll deltas remain within 0.01px of one another. The
same replay checks the four-request and 72-resource limits.

The changes reuse row slots cyclically, notify only the relevant row lane,
use paint transforms for row positions and prefetch in the direction of actual
movement, including circle-pad movement. These are **bounded-work and behavioral
measurements on Mac**. They do not prove physical frame time or eliminate all
possible JS, layout or GPU stalls. This revision still needs installation and
physical scrolling / touch acceptance.

The revised native ARM capture completes and produces both screen readbacks;
no startup exception is recorded. The production build excludes capture code,
is **1,649,684 bytes**, and has SHA-256
`b9df569877d74033f2bdc03e5b184bfe396e9890abf228de4d844f50aa27ce95`.
Installation of this usability revision is pending ftpd availability.
