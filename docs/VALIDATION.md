# Validation receipts

The current generated corpus has **1,000 Markdown files**, from **114,690** to
**1,049,446 bytes**, totalling **157,277,771 bytes**. It is ignored by Git.
The interaction replay copies that corpus into `dist/qa/replay-library/`; its
create and save checks never write the paired Mac's live library.

## Current automated checks

- **24 application tests** pass, including full-source staging, cross-window
  undo/redo, idempotent retries, restart/save recovery, external-edit conflicts,
  exclusive file creation and recovery of an orphaned create staging file.
- **110 framework tests** pass for rendering, DevTools, 3DS profiles and platform
  runtime contracts. They cover recording/replaying the optional right stick,
  deadzones and centering when a host or older tape omits it. TypeScript and
  generated contract checks pass.
- TypeScript and the compiled production guest pass with runtime **6bbb4a92**.
  **731 QuickJS frames at a 128 KiB stack** cover startup, resource errors and
  retry, Unicode input, discard cancellation and filename-dialog creation.
- **2,516 compiled-guest frames and 80 behavioral checks** pass with four-frame
  provider latency. They exercise code horizontal scrolling, auxiliary hit
  facts, compact keyboard/pads, selection, right-stick caret movement, whole
  source navigation, typing during a delayed seek, lost-reply recovery,
  boundary input/Backspace, save at the document end and create-to-editor.
  Requests stay within four and document textures/resource slots within 72.
- The ARM capture completes both upper and lower screen readbacks. The 3DS
  QuickJS stack limit remains **192 KiB**. The production build excludes capture
  code. Capture proves native startup; it does not prove physical interactions
  or frame-time performance.

The images beside this file are compiled-app simulation captures. Run
`bun scripts/sim.ts` to refresh them and `dist/qa/sim.json` after building the
guest and the runtime Wasm artifact. Only the QA directory is replaced.

## Current deployment

The whole-document revision is built and awaiting ftpd at 172.20.12.37:5000.
Its production binary is **1,688,560 bytes**, SHA-256
`124c2dfe190525b0b9d425e1123cc4397c5cbb2256985cc03d607864d6a4cc9a`.
Application and framework PR checks pass.
It has not yet been installed or physically accepted. The device receipts
below describe earlier builds, including the user's accepted UX improvements.

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
possible JS, layout or GPU stalls. This revision still needs physical scrolling / touch acceptance.

The revised native ARM capture completes and produces both screen readbacks;
no startup exception is recorded. The production build excludes capture code,
is **1,649,684 bytes**, and has SHA-256
`b9df569877d74033f2bdc03e5b184bfe396e9890abf228de4d844f50aa27ce95`.
**This usability revision and its app-scoped pairing key are installed** at
172.20.12.37:5000 with byte-exact FTP readback. The matching Mac provider is
running and waiting for the device to relaunch. The local receipt is
`dist/qa/deploy.json`; physical relaunch and interaction acceptance remain pending.


## Caret and classic-controls revision

The user reported that the installed usability revision felt more intuitive,
then identified cursor drift and control styling issues. A font probe confirmed
that the source font advances 7px per ASCII character while the prior caret used
its 8px atlas envelope. The revision measures the font advance, uses it for caret
and selection geometry, and sends the same cell width to the source rasterizer.
The shared classic controls are supplied by runtime **3db4c2a9**.

The 42-check replay opens the actual note 513, positions the caret after `This is`,
compares the emitted caret transform with the native font measurement, and taps
the widened space key. It verifies the exact inserted text and one-position
caret advance. It also checks button-down feedback before release, slide-out
cancellation, discard-sheet modality, cancellation and offline draft removal.
No save is issued to the real test library. Coverage-pixel tests verify 7px
whitespace advances and 14px CJK/emoji cells in streamed source text.

All 14 application tests pass. The strict QuickJS check now runs **603 frames**,
including discard cancellation, with a 128 KiB stack. Framework renderer,
gesture and caret checks pass (85 tests), as do TypeScript and contract checks.
The continuous-scroll replay remains at **1,540 UI mutation calls across 360
frames**, with four requests and 72 document textures/resources as its bounds.

The revised ARM capture completes with both screen readbacks and no startup
exception. The production binary is **1,658,228 bytes**, SHA-256
`73d16cf762440e43fefd8824a249856f2ae9fbaaab9b1d958f57674e8b58243a`.
**This revision and its app-scoped pairing key are installed** at
172.20.12.37:5000 with byte-exact FTP readback. The matching Mac provider has
been restarted with the source cell-width rules above. The local receipt is
`dist/qa/deploy.json`; physical relaunch and interaction acceptance of this
revision remain pending.


## Pocket Doc, command panels and syntax colors

The application, manifest ID, output names, assets, host index directory and
repository are renamed to Pocket Doc. The generated fixture now lives in
`data/library-v2/`; the previous directory is retained. A deterministic generator
creates 1,000 original documents in eight scenarios, with a minimum of 114,690
bytes, a maximum of 1,049,446 bytes and a total of 157,277,771 bytes. Generated
Markdown and databases are ignored by Git. Seeding preserves existing edits.

L opens a centered file list; R opens a three-column document-command panel.
Direction keys select commands, A confirms and B or shoulder release dismisses.
Undo/Redo operate on at most 32 local excerpt snapshots. Select is disabled in
reading mode, and Read clears selection. Shift distinguishes one-shot and locked
capitalization. The framework ClassicSheet retains touch and hardware modality
through its native closing animation and uses a 4px action gap.

Shiki runs in the provider worker, preserving multiline syntax state. Code bands
use fixed 7px cells, tab stops and two cells for wide glyphs. Unknown languages
remain plain monospace. Each row retains its source offsets, 1,024-byte coverage
mask and one texture handle. Optional palette columns stay below the unchanged
2,500-character reply limit; native coloring uses the existing scratch buffer
and one upload credit per frame.

All 17 application tests, TypeScript and the production guest build pass.
The 1,423-frame compiled-guest replay passes 58 checks with four-frame latency,
including directional commands, disabled Read-mode Select, offline undo/redo,
Shift one-shot/lock behavior, animated modal transitions and highlighted text.
The 3DS QuickJS check executes 616 frames at a stricter 128 KiB stack. Framework
renderer and offload tests pass (61 tests), including ASan/UBSan palette decoding
and modal close/reopen lifetime. The contract and TypeScript checks pass.

The continuous circle-pad replay on the new, more varied corpus records 1,773
UI mutations over 360 frames (888 down / 885 up, peak 57), with constant settled
motion and the same four-request / 72-resource bounds. This corpus differs from
the older 1,540-call result. **These are Mac behavioral measurements, not physical
frame-time results.**

The native ARM capture produces both screen readbacks and its completion marker,
with no startup exception. The 3DS stack remains 192 KiB. The production build
uses runtime `d7826c29` and contains no capture code.
It is **1,668,520 bytes**, SHA-256
`5fbf92b5eee9d91919af1f0eb759c064eb02a640249f8ce386f403feff1e8356`.
**Installed at 172.20.12.37:5000 with byte-exact FTP readback** on 2026-09-05.
The new app-scoped pairing key also verifies. The known previous launcher was
archived under `/pocketjs/migrations/pocket-doc/` after its hash was checked;
an FTP directory check confirms that `/3DS/pocketdoc-main.3dsx` is present and
the old launcher is absent. The matching Mac provider is running against
`data/library-v2/`. The local receipt is `dist/qa/deploy.json`. Physical relaunch
and interaction acceptance of this revision remain pending.
