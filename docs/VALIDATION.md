# Validation receipts

The initial library has **1,000 Markdown files**, at least **114,722 bytes** each,
totalling **114,872,771 bytes** before editing. The generated files are excluded
from Git; `bun run seed` recreates the fixture without overwriting existing files.

## Automated checks

- Eleven application tests pass: SQLite paging/search, Unicode coverage, source
  ranges, atomic saves, operation identity, restart recovery, external-edit
  conflicts, path confinement, real TCP-to-Worker dispatch, table wrapping and
  source offsets, shoulder command banks, viewport selection and caret boundaries.
- TypeScript and the production guest build pass against the pinned runtime.
- The native ARM build produces a production `.3dsx`.
- The compiled guest Wasm simulation runs **830 frames and 19 behavioral checks**
  against the full library, with replies delayed four frames. It exercises
  actual auxiliary touch hit facts for both pads, minimap, keyboard and selection;
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
provider has been restarted and is waiting for Pocket Folio to launch.
Physical interaction acceptance remains pending. Performance testing is
deferred until the interaction review is accepted. Prior save receipts do not
validate this new interface.

The review build is **1,640,516 bytes**, SHA-256
`508e8cb2eacbc0c960693ddf4ae678a276dd9fe71d793bafbb60c78b9a7edfcd`.
Its runtime pin is `7659028790d0a92b6bef7d74c45ede75fa73e28a`.
