# Validation receipts

The initial library has **1,000 Markdown files**, at least **114,722 bytes** each,
totalling **114,872,771 bytes** before editing. The generated files are excluded
from Git; `bun run seed` recreates the fixture without overwriting existing files.

## Automated checks

- Six application tests pass: SQLite paging/search, Unicode coverage, source
  ranges, atomic saves, operation identity, restart recovery, external-edit
  conflicts, path confinement, real TCP-to-Worker dispatch and caret boundaries.
- TypeScript and the production guest build pass against the pinned runtime.
- The native ARM build produces a production `.3dsx`.
- The Wasm simulation runs 478 frames against the full library, with replies
  delayed four frames. After disconnecting during a fling, its offset advances
  from 100 to 489 pixels. Its texture cache stays within 72 document rows and
  a locally edited draft survives disconnection. This is **behavioral evidence
  on Mac**, not a measurement of 3DS frame time.

`read.png` and `edit.png` are simulation captures of the compiled app. Run
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
The current build uses native bounded coverage decoding and precreated keyboard
and source rows. **The optimized build has not yet been installed or measured
on the device**; ftpd is unavailable while the initial application is running.

To complete acceptance, return with L+R+START, open ftpd, deploy the current
binary, restart the provider and launch Pocket Folio. Exercise flings, rapid
minimap jumps, heading navigation, source editing, save and reconnect while
recording frame-count deltas and CPU maxima. Inertial movement, arriving text,
touch responsiveness and persistence each require observation.
