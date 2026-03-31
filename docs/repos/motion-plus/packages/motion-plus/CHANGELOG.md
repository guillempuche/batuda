# Changelog

Motion+ adheres to [Semantic Versioning](http://semver.org/).

Undocumented APIs should be considered internal and may change without warning.

## [2.11.2] 2026-02-16

### Fixed

-   `splitText`: Ensure split text elements retain vertical positioning.
-   `Carousel`: Fix focus from breaking item reprojection.

## [2.11.1] 2026-02-16

### Fixed

-   `Ticker`: Improve accessibility attributes.
-   `Cursor`: Fix when using with browser-native drag gestures.
-   Updating `ref` type inference for `Typewriter`, `Ticker` and `ScrambleText`.

## [2.11.0] 2026-02-16

### Added

-   `Carousel`: New `wheelSwipeThreshold` prop configures the distance of wheel scroll before triggering a swipe.

## [2.10.0] 2026-02-16

### Added

-   `AnimateNumber`: `trend` prop to control digit spin direction.
    -   `trend={1}`: Digits always spin upward, wrapping 9 → 0.
    -   `trend={-1}`: Digits always spin downward, wrapping 0 → 9.
    -   `trend={(oldValue, newValue) => number}`: Function for custom logic.
    -   Default (no `trend`): Auto-detects direction based on value change.

### Changed

-   `AnimateNumber`: Now uses manual FLIP measurements instead of layout animations.

## [2.9.0] 2026-02-16

### Added

-   `useCarousel` and `useTicker`: Provides `offset` motion value, which contains the unwrapped offset of a `Carousel` or `Ticker`.

## [2.8.0] 2026-02-10

### Added

-   `AnimateView`: View animations for React.

## [2.7.2] 2026-01-30

### Changed

-   `ScrambleText`: Removing `span`.

## [2.7.1] 2026-01-30

### Fixed

-   `scrambleText`: Fixed `delay` handling.

## [2.7.0] 2026-01-30

### Added

-   `scrambleText`: Now supports string `MotionValue`.

## [2.6.2] 2026-01-29

### Added

-   `Typewriter`: `onChange` callback.

### Fixed

-   `ScrambleText`: Switch from `useEffect` to `useLayoutEffect`.

## [2.6.1] 2026-01-23

### Fixed

-   `scrambleText` and `ScrambleText`: Default `duration` is now `1`.

## [2.6.0] 2026-01-23

### Added

-   `scrambleText` and `ScrambleText`: Added scramble text for vanilla JS and React.

## [2.5.0] 2026-01-23

### Added

-   `Typewriter`: Added `cursorBlinkRepeat` option for capping the number of times a cursor blinks after typing stops.

## [2.4.0] 2026-01-23

### Added

-   `splitText`: Added `preserveHyphens` option.

## [2.3.1] 2026-01-20

### Fixed

-   `Carousel`: Removing `pageTransition` from generated types - use `transition` instead.

## [2.3.0] 2026-01-19

### Added

-   `animateLayout`: Vanilla layout animations.

## [2.2.0] 2026-01-09

### Added

-   `Carousel`: Added `page` prop for controlling the current page via props.

## [2.1.0] 2026-01-06

### Added

-   UMD bundle now published via GitHub.

## [2.0.2] 2025-11-24

### Fixed

-   `Carousel`: Ensure only on-axis wheel scrolls prevent native browser scrolling.

## [2.0.1] 2025-11-21

### Fixed

-   `Carousel`: Improved handling of pointer and wheel events in item gaps.

## [2.0.0] 2025-11-21

### Added

-   `Carousel`: Create accessible, performant, infinitely-scrolling carousels.
-   `useTickerItem`: Access item-relative offset within `Carousel` and `Ticker`, as well as item information like `itemIndex`, `cloneIndex`, layout `start` and `end`.
-   `Ticker`: Added `fade` and `safeMargin` options.

### Removed

-   `useItemOffset`. Replace `const offset = useItemOffset()` with `const { offset } = useTickerItem()`.

## [1.6.0] 2025-10-13

### Added

-   `Ticker`: RTL support.

## [1.5.1] 2025-07-23

### Changed

-   `Typewriter`: Adjusted natural typing variance calculations.

## [1.5.0] 2025-07-22

### Added

-   `Typewriter`

## [1.4.0] 2025-07-02

### Added

-   `Ticker`: `overflow` option for showing items outside the ticker layout boundaries.

### Fixed

-   `Ticker`: Fixing `layoutId` on repeated items.
-   `Ticker`: Reduce number of clones in tickers with padding.

## [1.3.2] 2025-06-23

### Changed

-   `Ticker`: Fixed sizing for emoji content.

## [1.3.1] 2025-06-23

### Changed

-   `Ticker`: Add `will-change: transform` to `ul` while animating.

### Fixed

-   `Ticker`: Disable animations when in background tab.

## [1.3.0] 2025-06-20

### Added

-   `Ticker`: Added `isStatic` mode.

## [1.2.1] 2025-06-19

### Fixed

-   `Ticker`: Prevent infinite cloning.

## [1.2.0] 2025-06-10

### Added

-   MCP server.

## [1.1.4] 2025-06-05

### Fixed

-   `Ticker`: Improve handling of clicks within `aria-hidden` elements.

## [1.1.3] 2025-06-04

### Fixed

-   `Ticker`: Correctly handling `padding` on container.

## [1.1.2] 2025-06-04

### Fixed

-   `Ticker`: Moving to layout effect to reduce offset desync when changing children.

## [1.1.1] 2025-06-04

### Fixed

-   `Ticker`: Ensure children are remeasured when ticker is remeasured.

## [1.1.0] 2025-06-04

### Added

-   `Ticker`: `useItemOffset`

## [1.0.0] 2025-06-03

### Added

-   `Ticker`

## [0.1.9] 2025-05-13

### Added

-   `Cursor`: Replacing `data-cursor-theme` with `data-cursor-zone` attribute.

## [0.1.8] 2025-05-13

### Added

-   `Cursor`: Support for `data-cursor-theme` attribute.

## [0.1.7] 2025-05-12

### Added

-   `Cursor`: Magnetic cursors.

## [0.1.6] 2025-03-20

### Fixed

-   Adding legacy `package.json` entry point.

## [0.1.5] 2025-03-03

### Added

-   Fixing global deps for UMD builds.

## [0.1.4] 2025-03-03

### Added

-   Adding global `MotionPlus` for UMD builds.

## [0.1.3] 2025-02-27

### Fixed

-   `AnimateNumber` now respects the `layoutDependency` prop and will only animate if it, or the provided value changes.

## [0.1.2] 2025-02-26

### Added

-   `splitText` now adds an `aria-label` to the container with the original text.

## [0.1.1] 2025-02-26

-   First release
