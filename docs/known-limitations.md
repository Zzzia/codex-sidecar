# Known Limitations

## P1

### Frontend paint cost without GPU acceleration

When Chrome (or another browser) runs without usable GPU compositing, `backdrop-filter: blur(...)` becomes a CPU-side paint tax. The app detects a weak/software WebGL path at startup and adds `html.soft-paint`, which disables those blurs. Shadow and large Markdown/Diff layouts can still feel heavier than on a GPU path; further work (viewport-deferred Diff, streaming Markdown throttle) is tracked as follow-up, not a product bug.

### Timeline still rebuilds all turn cards on each event batch

`Timeline` memoizes `buildTurnCards(events)` by the `events` array reference, so unchanged snapshots are free. Incremental SSE still produces a new `events` array, so long histories re-scan on every append. An incremental turn builder would lower CPU further but needs careful identity stability for memoized cards.

## P2

### Patch blocks default to expanded DiffView

Product rule: patches are first-class and expanded by default. Large multi-file patches in the visible turn window remain expensive (DOM + layout). Viewport-deferred mounting of `DiffView` is a possible future optimization that must preserve the default-expanded reading experience.
