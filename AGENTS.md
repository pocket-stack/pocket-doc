# Pocket Doc

- Framework code belongs in the PocketJS repository; update the runtime pin here.
- Keep Mac IO, SQLite, layout and rasterization in the provider worker. Keep the
  guest's visible tree, queues, textures and source excerpt bounded.
- Import framework APIs from `@pocketjs/framework/*` and Solid from `solid-js`.
- Publish validated changes as a Draft PR with a Conventional Commits title.
- Run the explicitly named app tests. Do not recursively discover tests through
  the runtime submodule.
- Keep keys, generated documents and private host data out of Git.
