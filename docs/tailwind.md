Below is the complete, fully formatted note as requested:

--------------------------------------------------

Title: [[Tailwind CSS v4 Quick Reference Guide]]
Path: Tailwind CSS v4 Quick Reference Guide.md

# **Tailwind CSS v4: Comprehensive Quick Reference**

## **I. Introduction**

Tailwind CSS v4.0 marks a significant evolution of the popular utility-first CSS framework. It represents a ground-up rewrite, meticulously optimized for performance, developer experience, and leveraging the latest advancements in web platform capabilities. Key goals driving this release include dramatically faster build times, a simplified installation and configuration process, and native integration with modern CSS features like cascade layers, custom properties, and advanced color functions.
This document serves as a comprehensive quick reference guide for developers working with Tailwind CSS v4. It details the core concepts, outlines significant changes from previous versions, provides an extensive catalog of utility classes across various CSS property categories, explains the purpose and usage of v4 directives and functions, and covers the new CSS-first theme customization process. The aim is to provide a practical, accurate, and thorough resource to facilitate efficient development with Tailwind CSS v4.

## **II. Core Concepts**

Tailwind CSS v4 retains its foundational principles while introducing significant refinements and leveraging modern web standards.

* **A. Utility-First CSS:** The core philosophy remains unchanged. Tailwind provides a vast set of low-level, single-purpose utility classes (e.g., flex, pt-4, text-center) that are applied directly within the HTML markup to build custom designs without writing traditional CSS. This approach promotes consistency, reduces CSS bundle size by reusing classes, and speeds up development.
* **B. Performance Optimization:** A primary driver for v4 was performance. The entirely new engine, partially written in Rust, delivers substantial speed improvements. Full builds are reported to be up to 5-10x faster, and incremental builds can be over 100x faster, often completing in microseconds when no CSS changes are detected. This addresses a common pain point with large projects in previous versions. The installed footprint is also over 35% smaller.
* **C. Modern Web Integration:** v4 is explicitly designed to utilize cutting-edge CSS features natively. This includes:
  * **Native Cascade Layers (@layer):** Provides more granular control over style specificity and interaction between Tailwind's layers (theme, base, components, utilities) and custom styles. All Tailwind styles now reside within layers, meaning unlayered custom styles naturally have higher specificity.
  * **Registered Custom Properties (@property):** Used internally to define custom properties with types and constraints, enabling features like transitioning gradients and improving performance.
  * **color-mix():** Leveraged internally for features like opacity modifiers, allowing dynamic color adjustments.
  * **Logical Properties:** Used internally to simplify Right-to-Left (RTL) support and reduce CSS size.
* **D. CSS-First Configuration:** This represents a major paradigm shift. The traditional tailwind.config.js file is replaced by direct configuration within the main CSS file using the @theme directive. This approach aims to make configuration feel more native to CSS and reduces project boilerplate. Theme tokens like colors, fonts, and breakpoints are defined as CSS variables within @theme, which Tailwind then uses to generate utilities and variants. While JS config compatibility exists via the @config directive, it has limitations.
* **E. Simplified Developer Experience:** v4 streamlines the entire workflow:
  * **Installation:** Fewer dependencies are required.
  * **Setup:** Often requires zero configuration. Automatic content detection finds template files without needing explicit content paths, ignoring .gitignore entries and binary files. Explicit paths can be added via the @source directive if needed.
  * **CSS Pipeline:** A single @import "tailwindcss"; line replaces the old @tailwind directives. The framework now includes a unified toolchain with built-in @import handling (no postcss-import needed), vendor prefixing (no autoprefixer needed), and CSS nesting support, powered by Lightning CSS.
  * **Vite Plugin:** A first-party Vite plugin (@tailwindcss/vite) offers tighter integration and potentially better performance than the PostCSS plugin.

## **III. Utility Class Reference**

Tailwind CSS provides a comprehensive suite of utility classes mapped to CSS properties. v4 introduces new utilities, renames some existing ones, and enhances flexibility with dynamic value generation and arbitrary value support.

* **A. Layout** (Display, Position, Top/Right/Bottom/Left, Z-Index, Visibility, Container, Columns, Box Sizing, Float, Clear, Object Fit/Position, Overflow, Overscroll Behavior)
  * These utilities control the fundamental layout and positioning of elements.
  * Includes standard display values (block, inline-block, inline, flex, grid, hidden).
  * Positioning utilities (static, relative, absolute, fixed, sticky) and offset controls (top-*, inset-*).
  * z-index utilities (z-*) for stacking order.
  * Visibility (visible, invisible).
  * The container utility provides breakpoint-constrained max-width, but v4 removes the center and padding config options; centering is done via mx-auto, and padding via px-* utilities or extending via @utility.
  * Multi-column layout (columns-*).
  * Box sizing (box-border, box-content).
  * Legacy float (float-*) and clear (clear-*) utilities.
  * Object fitting/positioning (object-*).
  * Overflow control (overflow-*, overflow-x-*, overflow-y-*).
  * Overscroll behavior (overscroll-*).

**Table 1: Common Layout Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| block | display: block; | Displays element as a block. |
| flex | display: flex; | Displays element as a block-level flex container. |
| grid | display: grid; | Displays element as a block-level grid container. |
| hidden | display: none; | Hides element completely. |
| relative | position: relative; | Positions element relative to its normal position. |
| absolute | position: absolute; | Positions element relative to the nearest positioned ancestor. |
| fixed | position: fixed; | Positions element relative to the viewport. |
| sticky | position: sticky; | Positions element based on scroll position. |
| inset-0 | inset: 0px; | Sets top, right, bottom, left to 0\. |
| top-4 | top: 1rem; | Sets top offset (assuming default spacing). |
| z-10 | z-index: 10; | Sets stack order to 10\. |
| invisible | visibility: hidden; | Hides element but preserves space. |
| container | width: 100%; @media (...) { max-width:...; } | Constrains width based on breakpoints (use mx-auto to center). |
| columns-3 | column-count: 3; | Divides content into 3 columns. |
| box-border | box-sizing: border-box; | Includes padding/border in element's total width/height. |
| float-left | float: left; | Floats element to the left. |
| clear-both | clear: both; | Clears floats on both sides. |
| overflow-hidden | overflow: hidden; | Clips content that overflows the element's box. |
| object-cover | object-fit: cover; | Resizes content to maintain aspect ratio while filling container. |

* **B. Flexbox & Grid** (Flex Direction/Wrap/Basis/Grow/Shrink, Order, Grid Template Columns/Rows, Grid Column/Row Start/End, Grid Auto Flow/Columns/Rows, Gap, Justify Content/Items/Self, Align Content/Items/Self, Place Content/Items/Self)
  * Utilities for fine-grained control within flex and grid containers.
  * Flexbox: flex-row, flex-col, flex-wrap, flex-grow, flex-shrink, order-* (Note removal of deprecated flex-grow-* and flex-shrink-* in v4).
  * Grid: grid-cols-*, grid-rows-*, col-span-*, row-span-*, col-start-*, row-start-*, grid-flow-*.
  * A significant enhancement in v4 is that grid-cols-* and grid-rows-* utilities dynamically accept any integer value out-of-the-box, eliminating the need to configure custom grid sizes for common layouts. For example, grid-cols-13 now works without any setup.
  * Spacing within flex/grid: gap-*, gap-x-*, gap-y-*.
  * Alignment: justify-* (main axis), items-* (cross axis default), self-* (individual item cross axis), content-* (space between lines on cross axis). Grid-specific alignment includes justify-items-* (inline axis default) and justify-self-* (individual item inline axis). place-* utilities are shorthands for align and justify.

**Table 2: Common Flexbox & Grid Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| flex-row | flex-direction: row; | Arranges flex items horizontally. |
| flex-col | flex-direction: column; | Arranges flex items vertically. |
| flex-wrap | flex-wrap: wrap; | Allows flex items to wrap onto multiple lines. |
| flex-grow | flex-grow: 1; | Allows flex item to grow to fill available space. |
| flex-shrink | flex-shrink: 1; | Allows flex item to shrink if needed. |
| order-first | order: -9999; | Places flex item first. |
| grid-cols-3 | grid-template-columns: repeat(3, minmax(0, 1fr)); | Creates a grid with 3 equal-width columns. |
| col-span-2 | grid-column: span 2 / span 2; | Makes an item span across 2 grid columns. |
| row-start-1 | grid-row-start: 1; | Makes an item start on the first grid row line. |
| grid-flow-col | grid-auto-flow: column; | Fills the grid column by column. |
| gap-4 | gap: 1rem; | Sets a gap between grid/flex items (assuming default spacing). |
| justify-center | justify-content: center; | Centers items along the main axis. |
| items-start | align-items: flex-start; | Aligns items to the start of the cross axis. |
| self-end | align-self: flex-end; | Aligns a single item to the end of the cross axis. |
| place-content-center | place-content: center; | Centers content along both axes (shorthand). |

* **C. Spacing** (Padding, Margin, Space Between)
  * Fundamental utilities for controlling space inside (p-*) and outside (m-*) elements.
  * Uses a configurable spacing scale, typically based on rem units.
  * Includes utilities for individual sides (pt-*, pb-*, pl-*, pr-*, mt-*, etc.) and axes (px-*, py-*, mx-*, my-*).
  * Supports logical properties for direction-agnostic spacing: ps-* (padding-start), pe-* (padding-end), ms-* (margin-start), me-* (margin-end).
  * **Dynamic Values:** In v4, spacing utilities are dynamically derived. This means classes like p-1, p-1.5, p-2, etc., are generated based on the scale, but crucially, you can use arbitrary values directly without configuration. Use square bracket notation for any CSS length (p-[11px], m-[2.5rem], p-[3%]) or the shorthand parenthesis syntax for CSS variables (p-(--my-padding)).
  * space-x-* and space-y-* utilities add margins between child elements.
  * **Breaking Change:** The CSS selector used by space-x-* and space-y-* changed in v4 (from > :not([hidden]) ~ :not([hidden]) to > :not(:last-child)) to improve performance. This might affect layouts relying on the old behavior, especially with inline elements or additional margins. Flexbox/Grid with gap is often a more robust alternative.

**Table 3: Common Spacing Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| p-4 | padding: 1rem; | Padding on all sides (default scale). |
| pt-2 | padding-top: 0.5rem; | Padding on top (default scale). |
| px-6 | padding-inline: 1.5rem; | Horizontal padding (default scale). |
| m-8 | margin: 2rem; | Margin on all sides (default scale). |
| mb-4 | margin-bottom: 1rem; | Margin on bottom (default scale). |
| mx-auto | margin-left: auto; margin-right: auto; | Horizontal centering. |
| space-x-4 | > :not(:last-child) { margin-right: 1rem; } | Adds horizontal space between direct children (LTR). |
| space-y-2 | > :not(:last-child) { margin-bottom: 0.5rem; } | Adds vertical space between direct children. |
| ps-3 | padding-inline-start: 0.75rem; | Padding on the starting side (logical). |
| me-5 | margin-inline-end: 1.25rem; | Margin on the ending side (logical). |
| p-[11px] | padding: 11px; | Arbitrary padding value. |
| m-(--my-margin) | margin: var(--my-margin); | Margin using a CSS variable. |

* **D. Sizing** (Width, Height, Min-Width, Max-Width, Min-Height, Max-Height, Size)
  * Utilities for controlling element dimensions.
  * w-* (width) and h-* (height) utilities use the spacing scale, percentages (w-1/2, h-1/3), viewport units (w-screen, h-screen), keywords (w-auto, h-full, w-min, h-max, w-fit).
  * min-w-*, max-w-*, min-h-*, max-h-* utilities constrain element sizes using similar value types.
  * **New size-* Utility:** v4 promotes the size-* utility (introduced in v3.4 but now fully supported by tailwind-merge) as a shorthand for setting both width and height simultaneously (e.g., size-10 is equivalent to w-10 h-10).
  * Arbitrary values are supported for all sizing utilities (w-[300px], h-[50vh], max-w-[90ch]).

**Table 4: Common Sizing Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| w-full | width: 100%; | Sets width to 100% of parent. |
| w-1/2 | width: 50%; | Sets width to 50% of parent. |
| w-screen | width: 100vw; | Sets width to 100% of viewport width. |
| h-12 | height: 3rem; | Sets height (default scale). |
| h-screen | height: 100vh; | Sets height to 100% of viewport height. |
| min-w-0 | min-width: 0px; | Sets minimum width to 0\. |
| max-w-md | max-width: 28rem; | Sets maximum width (default theme value). |
| min-h-screen | min-height: 100vh; | Sets minimum height to viewport height. |
| max-h-full | max-height: 100%; | Sets maximum height to 100% of parent. |
| size-10 | width: 2.5rem; height: 2.5rem; | Sets width and height (default scale). |
| w-[300px] | width: 300px; | Arbitrary width value. |

* **E. Typography** (Font Family/Size/Smoothing/Style/Weight/Variant Numeric/Stretch, Letter Spacing, Line Clamp/Height, List Style Type/Position, Text Align/Color/Decoration/Decoration Color/Style/Thickness/Underline Offset/Transform/Overflow/Indent/Wrap)
  * A comprehensive set of utilities for styling text content.
  * Font Family: font-sans, font-serif, font-mono apply default font stacks. Custom fonts are added via @theme --font-{name}:...;.
  * Font Size: text-{size} utilities (text-xs, text-base, text-2xl, etc.). Arbitrary sizes like text-[14px] are supported. Line height can be set simultaneously using slash notation (text-lg/8).
  * Font Weight: font-{weight} utilities (font-light, font-normal, font-bold, font-black).
  * Font Style: italic, not-italic.
  * **New v4 font-stretch utilities:** Control the width of variable fonts.
  * Text Color: text-{color}-{shade} (e.g., text-red-500). Supports inherit, current, transparent, arbitrary hex/rgb/hsl values (text-[#aabbcc]), opacity modifiers (text-blue-500/75), and CSS variables (text-(--my-color)).
  * Text Alignment: text-left, text-center, text-right, text-justify.
  * Text Decoration: underline, overline, line-through, no-underline. Control color (decoration-{color}-{shade}), style (decoration-wavy), thickness (decoration-2), and offset (underline-offset-4).
  * Text Transform: uppercase, lowercase, capitalize, normal-case.
  * Line Height: leading-{size} utilities (leading-tight, leading-normal, leading-loose) or numeric scale (leading-6). Arbitrary values leading-[span_0](start_span)[span_0](end_span) supported.
  * Letter Spacing: tracking-{size} utilities (tracking-tighter, tracking-normal, tracking-widest).
  * Other: list-disc, list-inside, truncate (for text overflow), text-ellipsis, text-indent-*, text-wrap, text-nowrap.

**Table 5: Common Typography Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| font-sans | font-family: var(--font-sans); | Applies default sans-serif font stack. |
| text-lg | font-size: 1.125rem; line-height: 1.75rem; | Sets large font size and line height. |
| text-red-500 | color: var(--color-red-500); | Sets text color to red-500. |
| font-bold | font-weight: 700; | Sets font weight to bold. |
| italic | font-style: italic; | Applies italic style. |
| not-italic | font-style: normal; | Removes italic style. |
| text-center | text-align: center; | Centers text. |
| underline | text-decoration-line: underline; | Adds an underline. |
| line-through | text-decoration-line: line-through; | Adds a strikethrough. |
| uppercase | text-transform: uppercase; | Transforms text to uppercase. |
| truncate | overflow: hidden; text-overflow: ellipsis; white-space: nowrap; | Truncates overflowing text with an ellipsis. |
| leading-relaxed | line-height: 1.625; | Sets a relaxed line height. |
| tracking-wide | letter-spacing: 0.025em; | Sets wider letter spacing. |
| list-disc | list-style-type: disc; | Sets list marker to a disc. |
| indent-8 | text-indent: 2rem; | Indents text (default scale). |
| text-wrap | text-wrap: wrap; | Allows text wrapping (CSS standard). |

* **F. Backgrounds** (Attachment, Clip, Color, Opacity, Origin, Position, Repeat, Size, Image, Gradient Color Stops)
  * Utilities for controlling element backgrounds.
  * Background Color: bg-{color}-{shade} (e.g., bg-blue-500), bg-transparent, bg-current, bg-inherit. Supports arbitrary values (bg-[#fff], bg-[hsl(210,50%,50%)]) and CSS variables (bg-(--my-bg-color)). Opacity modifiers can be used (bg-blue-500/50).
  * Background Image: Set via arbitrary value bg-[url('/path.jpg')] or theme config. bg-none removes the image.
  * **Gradients:**
    * **Breaking Change:** v3's bg-gradient-* utilities are renamed to bg-linear-* in v4 to accommodate new gradient types.
    * Linear: bg-linear-to-{direction} (e.g., bg-linear-to-r).
    * **New v4:** Radial (bg-radial) and Conic (bg-conic) gradients are now supported.
    * Color Stops: from-{color}, via-{color}, to-{color} define gradient colors. Positions can be specified (from-10%, via-50%).
    * **New v4 Expanded APIs:**
      * Linear gradients support angles: bg-linear-{angle} (e.g., bg-linear-45).
      * Interpolation modes can be specified using modifiers: bg-linear-to-r/oklch, bg-radial/hsl.
  * Other Properties: bg-repeat, bg-no-repeat, bg-repeat-x, bg-repeat-y ; bg-cover, bg-contain, bg-auto ; bg-center, bg-top, bg-left-bottom ; bg-fixed, bg-local, bg-scroll; bg-clip-border, bg-clip-padding, bg-clip-content, bg-clip-text; bg-origin-border, bg-origin-padding, bg-origin-content.

**Table 6: Common Background Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| bg-blue-500 | background-color: var(--color-blue-500); | Sets background color to blue-500. |
| bg-transparent | background-color: transparent; | Sets background color to transparent. |
| bg-linear-to-r | background-image: linear-gradient(to right, var(--tw-gradient-stops)); | Sets up a linear gradient going right. |
| from-green-400 | --tw-gradient-from: var(--color-green-400) var(--tw-gradient-from-position); --tw-gradient-stops: var(--tw-gradient-from), var(--tw-gradient-to); | Sets the starting color of a gradient. |
| to-blue-500 | --tw-gradient-to: var(--color-blue-500) var(--tw-gradient-to-position); | Sets the ending color of a gradient. |
| bg-no-repeat | background-repeat: no-repeat; | Prevents background image from repeating. |
| bg-cover | background-size: cover; | Scales background image to cover container. |
| bg-center | background-position: center; | Centers background image. |
| bg-fixed | background-attachment: fixed; | Fixes background image relative to viewport. |
| bg-clip-text | background-clip: text; | Clips background to the shape of the text. |
| bg-origin-border | background-origin: border-box; | Positions background relative to the border box. |
| bg-linear-45 | background-image: linear-gradient(45deg, var(--tw-gradient-stops)); | Linear gradient at a 45-degree angle (New in v4). |

* **G. Borders** (Radius, Width, Color, Opacity, Style, Divide Width/Color/Opacity/Style, Outline Width/Color/Offset/Style, Ring Width/Color/Offset/Inset)
  * Utilities for element borders, outlines, and dividers between elements.
  * Border Width: border, border-{width} (e.g., border-2, border-4), border-{side}-{width} (e.g., border-t-2, border-x-4).
  * Border Style: border-solid, border-dashed, border-dotted, border-double, border-none.
  * Border Color: border-{color}-{shade} (e.g., border-red-500). Supports opacity (border-blue-500/50). **Breaking Change:** Default border color is now currentColor instead of gray-200.
  * Border Radius: rounded-{size} (e.g., rounded-sm, rounded-lg, rounded-full). Utilities for individual corners (rounded-t-lg, rounded-br-xl). **Breaking Change:** Default radius scale renamed (sm->xs, default->sm).
  * Divide Utilities: Add borders between child elements (divide-x, divide-y, divide-{color}-{shade}, divide-dashed).
  * Outline Utilities: outline-{width}, outline-{color}, outline-offset-*, outline-dashed. **Breaking Change:** outline-none renamed to outline-hidden. New outline-none sets outline-style: none. outline utility defaults changed.
  * Ring Utilities: Simulate outlines using box-shadow. ring-{width}, ring-{color}, ring-offset-{width}, ring-offset-{color}. **Breaking Change:** Default ring width changed from 3px to 1px. ring is now equivalent to ring-1. v3's default ring is now ring-3. Default color is currentColor instead of blue.
  * **New v4 inset-ring-* utility:** Creates an inner ring effect.

**Table 7: Common Border Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| border | border-width: 1px; border-style: solid; border-color: currentColor; | Adds a 1px solid border using current text color. |
| border-2 | border-width: 2px; | Sets border width to 2px. |
| border-dashed | border-style: dashed; | Sets border style to dashed. |
| border-red-500 | border-color: var(--color-red-500); | Sets border color to red-500. |
| rounded-lg | border-radius: 0.5rem; | Applies large border radius (default theme). |
| rounded-full | border-radius: 9999px; | Applies fully rounded corners. |
| divide-y | > :not(:last-child) { border-top-width: 0px; border-bottom-width: 1px; } | Adds 1px horizontal borders between children. |
| divide-gray-300 | > :not(:last-child) { border-color: var(--color-gray-300); } | Sets divider color. |
| outline-blue-500 | outline-color: var(--color-blue-500); | Sets outline color. |
| outline-offset-2 | outline-offset: 2px; | Offsets the outline by 2px. |
| ring-1 | box-shadow: var(--tw-ring-inset) 0 0 0 calc(1px + var(--tw-ring-offset-width, 0px)) var(--tw-ring-color); | Adds a 1px ring (new default). |
| ring-offset-4 | --tw-ring-offset-width: 4px; | Sets ring offset width. |
| inset-ring-1 | --tw-ring-inset: inset; (used with ring utilities) | Makes the ring appear inside the element (New in v4). |

* **H. Effects** (Box Shadow, Box Shadow Color, Opacity, Mix Blend Mode, Background Blend Mode)
  * Utilities for applying visual effects.
  * Box Shadow: shadow-{size} (e.g., shadow-md, shadow-xl). **Breaking Change:** Default shadow scale renamed (sm->xs, default->sm). Set shadow color with shadow-{color}-{shade} or shadow-{color}-{shade}/{opacity}.
  * **New v4 inset-shadow-* utility:** Creates inner shadow effects.
  * Opacity: opacity-{value} (e.g., opacity-0, opacity-75, opacity-100). Arbitrary values opacity-[.67] supported. Opacity can also be applied directly to colors (bg-blue-500/50).
  * Blend Modes: mix-blend-{mode} (e.g., mix-blend-multiply, mix-blend-screen) for how an element's content blends with content behind it. bg-blend-{mode} (e.g., bg-blend-overlay) for how an element's background image blends with its background color.

**Table 8: Common Effects Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| shadow-sm | box-shadow: var(--shadow-sm); /* 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1) */ | Applies small box shadow (v3 'shadow'). |
| shadow-lg | box-shadow: var(--shadow-lg); /* 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1) */ | Applies large box shadow. |
| inset-shadow-sm | box-shadow: var(--inset-shadow-sm); /* inset 0 2px 4px rgb(0 0 0 / 0.05) */ | Applies small inner shadow (New in v4). |
| opacity-75 | opacity: 0.75; | Sets element opacity to 75%. |
| opacity-100 | opacity: 1; | Sets element opacity to 100% (fully opaque). |
| mix-blend-multiply | mix-blend-mode: multiply; | Blends element by multiplying colors. |
| bg-blend-overlay | background-blend-mode: overlay; | Blends background image and color using overlay mode. |
| shadow-cyan-500/50 | --tw-shadow-color: var(--color-cyan-500); --tw-shadow: var(--tw-shadow-colored); --tw-shadow-colored: rgb(45 212 219 / 0.5); | Sets shadow color to cyan-500 with 50% opacity. |

* **I. Filters** (Blur, Brightness, Contrast, Drop Shadow, Grayscale, Hue Rotate, Invert, Saturate, Sepia, Backdrop Blur/Brightness/Contrast/Grayscale/Hue Rotate/Invert/Opacity/Saturate/Sepia)
  * Utilities for applying graphical filter effects directly to elements or their backdrops.
  * Element Filters: blur-*, brightness-*, contrast-*, drop-shadow-*, grayscale, hue-rotate-*, invert, saturate-*, sepia.
  * Backdrop Filters: Apply filters to the area behind an element (backdrop-blur-*, backdrop-brightness-*, etc.). Requires browser support.
  * **Breaking Change:** Default blur, shadow, and drop-shadow scales renamed (sm->xs, default->sm).
  * Arbitrary values are supported (blur-[2px], brightness-[1.2]).

**Table 9: Common Filter Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| blur-sm | filter: blur(var(--blur-sm)); /* 8px */ | Applies small blur (v3 'blur'). |
| brightness-125 | filter: brightness(1.25); | Increases brightness by 25%. |
| contrast-150 | filter: contrast(1.5); | Increases contrast by 50%. |
| drop-shadow-sm | filter: drop-shadow(var(--drop-shadow-sm)); /* 0 1px 1px rgb(0 0 0 / 0.05) */ | Applies small drop shadow (v3 'drop-shadow'). |
| grayscale | filter: grayscale(100%); | Converts element to grayscale. |
| hue-rotate-90 | filter: hue-rotate(90deg); | Rotates hues by 90 degrees. |
| invert | filter: invert(100%); | Inverts colors. |
| saturate-150 | filter: saturate(1.5); | Increases saturation by 50%. |
| sepia | filter: sepia(100%); | Applies sepia filter. |
| backdrop-blur-md | backdrop-filter: blur(var(--backdrop-blur-md)); /* 12px */ | Applies medium blur to the backdrop. |

* **J. Tables** (Border Collapse, Border Spacing, Table Layout, Caption Side)
  * Utilities specifically for styling HTML <table> elements.
  * Border Behavior: border-collapse (merge borders) or border-separate (individual borders). Use border-spacing-* utilities with border-separate.
  * Layout Algorithm: table-auto (content-based sizing) or table-fixed (fixed layout based on first row/widths).
  * Caption Position: caption-top, caption-bottom.

**Table 10: Common Table Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| border-collapse | border-collapse: collapse; | Merges adjacent table cell borders. |
| border-separate | border-collapse: separate; | Keeps table cell borders separate. |
| table-auto | table-layout: auto; | Browser sizes columns based on content (default). |
| table-fixed | table-layout: fixed; | Table/column widths based on first row/set widths. |
| caption-bottom | caption-side: bottom; | Positions table caption below the table. |

* **K. Transitions & Animation** (Transition Property/Duration/Timing Function/Delay, Animation)
  * Utilities for adding motion to elements.
  * Transitions: Apply smooth changes between states.
    * Property: transition (common properties), transition-all, transition-colors, transition-opacity, transition-shadow, transition-transform, transition-none. Arbitrary properties via transition-[property].
    * Duration: duration-{ms} (e.g., duration-300).
    * Timing Function: ease-linear, ease-in, ease-out, ease-in-out.
    * Delay: delay-{ms} (e.g., delay-100).
  * Animations: Apply pre-defined keyframe animations.
    * Utilities: animate-spin, animate-ping, animate-pulse, animate-bounce, animate-none.
    * Custom animations via animate-[name_duration_...] and defining @keyframes.
  * **New v4 starting Variant:** Enables CSS @starting-style for creating enter/exit transitions without JavaScript. Apply styles within the starting: variant that define the initial state before the element is rendered or the final state before it's removed.

**Table 11: Common Transition & Animation Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| transition | transition-property: color, background-color,...; transition-timing-function:...; transition-duration: 150ms; | Applies default transition to common properties. |
| duration-300 | transition-duration: 300ms; | Sets transition duration to 300ms. |
| ease-in-out | transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); | Applies ease-in-out timing function. |
| delay-100 | transition-delay: 100ms; | Delays transition start by 100ms. |
| animate-spin | animation: spin 1s linear infinite; | Applies a spinning animation. |
| animate-pulse | animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite; | Applies a gentle pulsing fade animation. |
| starting:opacity-0 | @starting-style { opacity: 0; } | Sets initial opacity to 0 for enter transitions (used with transition-opacity). |

* **L. Transforms** (Scale, Rotate, Translate, Skew, Transform Origin, Perspective, Perspective Origin, Transform Style)
  * Utilities for modifying an element's coordinate space. Requires the transform utility (or transform-gpu for hardware acceleration) to be applied first.
  * 2D Transforms: scale-*, scale-x-*, scale-y-*; rotate-*; translate-x-*, translate-y-*; skew-x-*, skew-y-*.
  * Transform Origin: origin-{position} (e.g., origin-center, origin-top-left).
  * **New v4 3D Transforms:**
    * rotate-x-*, rotate-y-*, rotate-z-* (same as rotate-*).
    * translate-z-*.
    * perspective-* (applied to parent element).
    * perspective-origin-* (applied to parent element).
    * transform-style: preserve-3d / flat (applied to parent element).
  * Arbitrary values supported (scale-[1.7], rotate-[25deg], translate-[10px, 5px]).

**Table 12: Common Transform Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| transform | --tw-translate-x: 0; --tw-translate-y: 0; ... transform: ...; | Enables transforms and sets defaults. |
| scale-110 | --tw-scale-x: 1.1; --tw-scale-y: 1.1; | Scales element up by 10% on both axes. |
| rotate-45 | --tw-rotate: 45deg; | Rotates element by 45 degrees. |
| translate-x-4 | --tw-translate-x: 1rem; | Translates element right by 1rem (default scale). |
| skew-y-6 | --tw-skew-y: 6deg; | Skews element along the y-axis by 6 degrees. |
| origin-center | transform-origin: center; | Sets transform origin to the center. |
| transform-gpu | transform: translate3d(var(--tw-translate-x), var(--tw-translate-y), 0) ...; | Forces hardware acceleration for transforms. |
| rotate-x-15 | --tw-rotate-x: 15deg; | Rotates element 15 degrees around the X-axis (New in v4). |
| perspective-1 | perspective: 1rem; | Applies perspective to child elements (New in v4). |

* **M. Interactivity** (Appearance, Cursor, Caret Color, Pointer Events, Resize, Scroll Behavior/Margin/Padding/Snap Align/Snap Stop/Snap Type, Touch Action, User Select, Will Change)
  * Utilities that affect how users interact with elements.
  * appearance-none: Resets native browser styling for form elements.
  * cursor-* : Changes the mouse cursor on hover (cursor-pointer, cursor-wait, cursor-not-allowed).
  * caret-{color}: Sets the color of the text input cursor.
  * pointer-events-none, pointer-events-auto: Controls if an element can be the target of mouse events.
  * resize, resize-x, resize-y, resize-none: Controls element resizability.
  * Scroll Behavior: scroll-smooth, scroll-auto.
  * Scroll Margin/Padding: scroll-m-*, scroll-p-* utilities add margin/padding relative to the scroll container, useful for offsetting fixed headers.
  * Scroll Snap: snap-x, snap-y, snap-both, snap-mandatory, snap-proximity, snap-start, snap-center, snap-end, snap-normal, snap-always.
  * touch-action-* : Controls how touch events are handled.
  * User Selection: select-none, select-text, select-all.
  * will-change-* : Hints to the browser about expected changes for optimization.
  * **New v4 inert variant:** Styles elements with the inert attribute, making them non-interactive.
  * **New v4 field-sizing utilities:** field-sizing-content allows textareas to automatically resize based on their content.

**Table 13: Common Interactivity Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| appearance-none | appearance: none; | Resets default browser appearance for form elements. |
| cursor-pointer | cursor: pointer; | Shows pointer cursor (indicates interactivity). |
| cursor-not-allowed | cursor: not-allowed; | Shows not-allowed cursor (e.g., for disabled elements). |
| pointer-events-none | pointer-events: none; | Element ignores pointer events. |
| resize-y | resize: vertical; | Allows vertical resizing only. |
| scroll-smooth | scroll-behavior: smooth; | Enables smooth scrolling. |
| snap-y | scroll-snap-type: y var(--tw-scroll-snap-strictness); | Enables vertical scroll snapping. |
| snap-center | scroll-snap-align: center; | Snaps element to the center of the scroll container. |
| select-none | user-select: none; | Prevents text selection. |
| inert:opacity-50 | :where([inert], [inert] *):not([inert] ~ *):not([inert] ~ * *) { opacity: 0.5; } | Applies 50% opacity when element is inert (New in v4). |
| field-sizing-content | field-sizing: content; | Allows form field (e.g., textarea) to auto-size to content (New in v4). |

* **N. SVG** (Fill, Stroke, Stroke Width)
  * Utilities specifically designed for styling SVG elements.
  * Fill Color: fill-{color}-{shade} (e.g., fill-blue-500), fill-current (uses text color), fill-none.
  * Stroke Color: stroke-{color}-{shade} (e.g., stroke-red-600), stroke-current (uses text color), stroke-none.
  * Stroke Width: stroke-{width} (e.g., stroke-0, stroke-1, stroke-2). Arbitrary values like stroke-[1.5px] are supported.

**Table 14: Common SVG Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| fill-current | fill: currentColor; | Sets SVG fill color to the current text color. |
| fill-blue-500 | fill: var(--color-blue-500); | Sets SVG fill color to blue-500. |
| stroke-current | stroke: currentColor; | Sets SVG stroke color to the current text color. |
| stroke-red-600 | stroke: var(--color-red-600); | Sets SVG stroke color to red-600. |
| stroke-2 | stroke-width: 2; | Sets SVG stroke width to 2 (unitless, scales with SVG). |

* **O. Accessibility** (Screen Readers)
  * Utilities primarily focused on controlling visibility for screen readers.
  * sr-only: Hides an element visually but keeps it accessible to screen readers.
  * not-sr-only: Reverses sr-only, making an element visually visible again.
  * It's important to note that many accessibility best practices, especially for interactive components (like dropdowns, dialogs), require JavaScript to manage focus, keyboard navigation, and ARIA attributes correctly. Relying solely on CSS utilities is often insufficient.

**Table 15: Common Accessibility Utilities & CSS Output**

| Utility Class | CSS Output | Description |
|:----|:----|:----|
| sr-only | position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border-width: 0; | Hides element visually, accessible to screen readers. |
| not-sr-only | position: static; width: auto; height: auto; padding: 0; margin: 0; overflow: visible; clip: auto; white-space: normal; | Reverses sr-only, makes element visible. |

* **P. Note on Dynamic Utilities and Arbitrary Values:**
  * A core theme in Tailwind v4 is increased dynamism and flexibility, reducing the need for configuration for common one-off styles.
  * **Dynamic Utilities:** Many utility sets, particularly spacing (p-*, m-*) and grid templates (grid-cols-*, grid-rows-*), are now generated dynamically based on the theme scale or accept any integer/value directly. You no longer need to explicitly define grid-cols-7 in your config; you can just use the class.
  * **Arbitrary Values:** The square bracket syntax […] allows using any valid CSS value directly within a utility class, bypassing the theme scale entirely (e.g., p-[11px], text-[#aabbcc], w-[33.3%], rotate-[17deg]).
  * **CSS Variable Shorthand:** The parenthesis syntax (...) is a shorthand for using CSS variables within arbitrary values (e.g., bg-(--my-var) is equivalent to bg-[var(--my-var)]). This makes leveraging theme variables defined in @theme very convenient.

## **IV. Directives Deep Dive**

Directives are custom, Tailwind-specific at-rules used within CSS to unlock special framework functionality, from importing styles and configuring the theme to defining custom utilities and variants.

* **A. @import:**
  * **Purpose:** Used to inline CSS files. In v4, it's the standard way to include Tailwind's core styles, replacing the v3 @tailwind directives.
  * **Usage:** Follows standard CSS @import syntax. Tailwind v4 includes built-in, optimized import processing, eliminating the need for external tools like postcss-import.
  * **Example:**
    /* Import Tailwind's core styles (theme, base, utilities) */
    @import "tailwindcss";

    /* Import additional custom CSS files */
    @import "./components/buttons.css";
    @import "./typography.css";

* **B. @theme:**
  * **Purpose:** The cornerstone of v4's CSS-first configuration. It defines custom design tokens (colors, fonts, spacing, breakpoints, etc.) directly within CSS, which Tailwind uses to generate corresponding utility classes and variants. It largely replaces the need for a tailwind.config.js file for theme customization.
  * **Usage:** CSS variables are defined within an @theme { ... } block using specific namespaces (e.g., --color-*, --font-*, --breakpoint-*, --spacing-*) that inform Tailwind how to generate utilities or variants. These variables are also made available as standard CSS variables for use with var().
  * **Example:**
    @import "tailwindcss";

    @theme {
      /* Define custom colors */
      --color-brand-primary: oklch(0.6 0.2 250);
      --color-brand-secondary: oklch(0.8 0.1 120);

      /* Define a custom font */
      --font-display: "Inter Variable", sans-serif;

      /* Define a custom breakpoint */
      --breakpoint-xl: 80rem; /* 1280px */

      /* Define custom spacing */
      --spacing-7: 1.75rem;
    }

* **C. @source:**
  * **Purpose:** Explicitly registers source files or directories for Tailwind to scan for class names. This is necessary when automatic content detection might miss files, such as those within node_modules or complex project structures.
  * **Usage:** @source "<path-to-file-or-directory>";
  * **Example:**
    @import "tailwindcss";

    /* Ensure Tailwind scans this library for classes */
    @source "../node_modules/@my-company/ui-lib/dist/**/*.js";

* **D. @utility:**
  * **Purpose:** Defines new, custom utility classes that behave like Tailwind's built-in utilities, including support for variants (hover:, md:, etc.). This is the recommended way to add custom utilities in v4, replacing the v3 practice of adding them within @layer utilities.
  * **Usage:** @utility <class-name> { <css-rules> }. Can define simple single-property utilities or more complex ones using nesting and functions like --value() to accept arguments (matching theme keys, bare types, literals, or arbitrary values).
  * **Example:**
    @import "tailwindcss";

    /* Simple utility */
    @utility content-auto {
      content-visibility: auto;
    }

    /* Utility with argument matching theme spacing */
    @utility custom-pad:--value(--spacing-*) {
      padding: var(--value);
    }

    /* Complex utility using nesting */
    @utility scrollbar-thin {
      &::-webkit-scrollbar { width: 8px; }
      &::-webkit-scrollbar-thumb { background-color: gray; }
    }

* **E. @variant:**
  * **Purpose:** Applies existing Tailwind variants (like hover, focus, dark, responsive breakpoints like md) to custom CSS rules. This is typically used within custom component styles defined in @layer components.
  * **Usage:** Inside a CSS rule, use @variant <variant-name> { <css-rules-for-variant> }. Can be nested for multiple variants.
  * **Example:**
    @import "tailwindcss";

    @layer components {
      .btn-custom {
        background-color: var(--color-brand-primary);
        color: white;
        padding: var(--spacing-2) var(--spacing-4);
        border-radius: var(--rounded-md);

        @variant hover {
          background-color: oklch(from var(--color-brand-primary) calc(l - 0.1) c h); /* Darken */
        }

        @variant focus {
          outline: 2px solid var(--color-brand-secondary);
          outline-offset: 2px;
        }

        @variant dark {
          background-color: var(--color-brand-secondary);
          @variant hover {
            background-color: oklch(from var(--color-brand-secondary) calc(l - 0.1) c h);
          }
        }
      }
    }

* **F. @custom-variant:**
  * **Purpose:** Defines entirely new, custom variants based on CSS selectors, such as data attributes, custom parent classes, or pseudo-classes not covered by default variants.
  * **Usage:** @custom-variant <name> (<selector-logic>) for simple cases, or a block syntax using @slot for more complex selectors or nesting. The @slot represents where the utility class being modified by the variant will be placed in the generated CSS.
  * **Example:**
    @import "tailwindcss";

    /* Variant for elements within a group that has data-loading attribute */
    @custom-variant group-loading (&:where(.group[data-loading] *));

    /* Variant for elements with aria-invalid="true" */
    @custom-variant invalid (&[aria-invalid="true"]);

    /* Variant for theme switching using data attribute */
    @custom-variant theme-coffee (&:where([data-theme="coffee"] *));
    Allows usage like: group-loading:opacity-50, invalid:border-red-500, theme-coffee:bg-amber-900.

* **G. @apply:**
  * **Purpose:** Allows inlining existing Tailwind utility classes into custom CSS rules. This is useful for abstracting common utility patterns into component classes or for styling elements where direct class application is difficult (e.g., third-party libraries, complex selectors).
  * **Usage:** Within a CSS rule definition, use @apply <list-of-utility-classes>;.
  * **Example:**
    @import "tailwindcss";

    @layer components {
      .card {
        @apply p-4 bg-white rounded-lg shadow-md border border-gray-200;
      }
      .button-primary {
        @apply px-4 py-2 bg-blue-600 text-white rounded font-semibold hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2;
      }
    }

    /* Styling a third-party component */
    .some-library-widget { @apply text-sm text-gray-700; }

  * While @apply remains a supported and useful feature, particularly for integrating with existing CSS or external libraries, the overall direction of v4, with its strong emphasis on CSS variables via @theme and the introduction of the @utility directive, suggests a potential shift in preferred patterns for creating *new* component abstractions within a pure Tailwind v4 project. Direct composition of utilities in HTML or leveraging CSS variables might be considered more idiomatic for certain use cases, aligning with the framework's enhanced CSS-native feel. Community discussions also note potential complexities when using @apply with CSS layers in v4.

* **H. @reference:**
  * **Purpose:** Specifically designed for scenarios involving scoped styles, such as Vue Single File Components (<style>), Svelte components (<style>), or CSS Modules. It imports theme variables, custom utilities, and custom variants defined in a main CSS file *for reference only*, making them available for use with @apply or @variant within the scoped context *without* duplicating the actual CSS output in the final bundle.
  * **Usage:** @reference "<path-to-main.css>";. If only default Tailwind styles are needed, @reference "tailwindcss"; can be used.
  * **Example (Vue SFC):**
    <template>
      <button class="my-button">Click Me</button>
    </template>

    <style scoped>
    /* Import theme and custom utilities/variants from app.css */
    @reference "../../styles/app.css";

    .my-button {
      /* Now we can use @apply with theme colors/spacing etc. */
      @apply px-3 py-1 bg-brand-primary text-white rounded-md;
      @variant hover { @apply bg-brand-secondary; }
    }
    </style>

* **I. @config:**
  * **Purpose:** Provides backward compatibility by allowing the loading of a traditional v3-style tailwind.config.js file. This can facilitate gradual migration from v3 to v4.
  * **Usage:** @config "<path-to-tailwind.config.js>";. This directive **must** be placed at the very top of the CSS file, before any @import statements.
  * **Limitations:** Not all tailwind.config.js options are supported in v4 when loaded via @config. Specifically, corePlugins, safelist, and separator are ignored. The primary use case is loading theme and plugins.
  * **Example:**
    /* Load legacy config first */
    @config "../../tailwind.config.js";

    /* Then import Tailwind */
    @import "tailwindcss";

    /* Further CSS... */

* **J. @layer:**
  * **Purpose:** Defines CSS cascade layers. Tailwind internally uses layers (theme, base, components, utilities) to manage style precedence. Developers can use @layer to inject custom styles into the appropriate layer, ensuring correct interaction with framework styles. Styles in base have the lowest precedence, followed by components, then utilities. Unlayered styles have the highest precedence over any layered styles.
  * **Usage:** @layer <layer-name> { <css-rules> }. Common layers for custom styles are base (for element defaults) and components (for component classes). Custom utilities should use @utility instead of @layer utilities.
  * **Example:**
    @import "tailwindcss";

    /* Add custom base styles */
    @layer base {
      body {
        @apply font-sans text-gray-800 bg-gray-100;
      }
      a {
        @apply text-blue-600 hover:underline;
      }
    }

    /* Add custom component styles */
    @layer components {
      .alert {
        @apply p-4 border rounded-md;
      }
      .alert-warning {
        @apply bg-yellow-100 border-yellow-300 text-yellow-800;
      }
    }

* **K. Removed Directives:**
  * **@tailwind:** The @tailwind base;, @tailwind components;, and @tailwind utilities; directives used in v3 are removed in v4. They are entirely replaced by the single @import "tailwindcss"; directive.

## **V. Functions Explained**

Tailwind v4 primarily relies on standard CSS functions, particularly var(), for accessing theme values, moving away from custom functions like theme(). It does introduce helper functions for specific tasks like opacity modification.

* **A. var():**
  * **Purpose:** This is the standard CSS function for accessing the value of a CSS custom property (variable). In Tailwind v4, it's the primary method for retrieving design tokens (colors, spacing, font sizes, etc.) defined within the @theme directive for use in custom CSS or inline styles.
  * **Usage:** var(--variable-name, <optional-fallback-value>).
  * **Example:**

  .custom-element {
    /* Using theme variables defined in @theme */
    background-color: var(--color-brand-primary);
    padding: var(--spacing-md);
    font-family: var(--font-display);
    /* Using a fallback value */
    border-color: var(--color-border-subtle, #cccccc);
  }

  * **Relation to theme():** The standard var() function effectively replaces the Tailwind-specific theme() function used in v3 (e.g., theme('colors.blue.500'), theme('spacing.4')). While theme() is still supported in v4 for backward compatibility, the recommended approach for new projects or migrated code is to use CSS variables directly via var(). This aligns v4 more closely with standard CSS practices.

* **B. --alpha():**
  * **Purpose:** A Tailwind-specific helper function processed at build time to easily adjust the opacity of a color defined by a CSS variable.
  * **Usage:** --alpha(var(--color-variable) / <opacity-value>). The opacity value can be a percentage (e.g., 50%) or a decimal (e.g., 0.5).
  * **Output:** Tailwind compiles this function into a standard CSS color-mix() function, ensuring browser compatibility. For example, color-mix(in oklab, var(--color-variable) <opacity-value>%, transparent).
  * **Example:**
    /* Input CSS */

    .element-with-opacity {
      background-color: --alpha(var(--color-brand-primary) / 75%);
      color: --alpha(var(--color-text-main) / 0.9);
    }
    /* Compiled CSS (approximate) */
    .element-with-opacity {
      background-color: color-mix(in oklab, var(--color-brand-primary) 75%, transparent);
      color: color-mix(in oklab, var(--color-text-main) 90%, transparent);
    }

* **C. Spacing Value Handling:**
  * Tailwind v4 does not provide a user-facing --spacing() function analogous to --alpha(). Instead, spacing values defined in @theme (e.g., --spacing-4: 1rem;) are accessed directly using var(--spacing-4) in custom CSS.
  * Built-in spacing utilities like p-4 or m-6 are compiled using calculations based on the theme's spacing scale, often involving calc() and potentially a base --spacing variable if defined, or default internal calculations. Arbitrary spacing values are handled directly (p-[11px]).

## **VI. Customizing Your Tailwind v4 Theme**

Tailwind v4 introduces a CSS-first approach to theme customization, primarily using the @theme directive within your main CSS file.

* **A. The @theme Directive Explained:**
  * This directive serves as the central configuration point for defining and modifying your project's design tokens directly in CSS, replacing the primary role of tailwind.config.js for theme adjustments.
  * It establishes a direct link between CSS variable definitions and the generation of Tailwind utilities and variants.
  * Theme variables are organized into **namespaces** (like --color-*, --font-*, --breakpoint-*, --spacing-*, --shadow-*, etc.) which dictate how Tailwind interprets the variable and which utilities or variants it affects. For example, --breakpoint-lg defines the lg: variant, while --color-primary generates bg-primary, text-primary, etc.

* **B. Defining and Using Theme Variables:**
  * Variables are defined using standard CSS custom property syntax (--namespace-key: value;) inside the @theme { ... } block.
  * Defining a variable in the correct namespace automatically generates the corresponding utility classes.
  * These theme variables are also output as standard CSS variables (typically within :root), making them accessible throughout your CSS using the var() function.
  * **Example:**
    @import "tailwindcss";

    @theme {
      /* Custom Color Palette */
      --color-primary: hsl(220, 80%, 55%);
      --color-secondary: hsl(160, 70%, 45%);
      --color-neutral-100: hsl(210, 20%, 98%);
      --color-neutral-900: hsl(210, 15%, 15%);

      /* Custom Font Stack */
      --font-body: "Lato", sans-serif;
      --font-heading: "Montserrat", sans-serif;

      /* Custom Breakpoint */
      --breakpoint-2xl: 96rem; /* 1536px */

      /* Custom Spacing Unit */
      --spacing-large: 4rem;
    }

    /* Usage in other CSS */

    .my-component {
      background-color: var(--color-neutral-100);
      padding: var(--spacing-large);
      font-family: var(--font-body);
    }

* **C. Extending vs. Overriding Default Theme Values:**
  * **Extending:** To add new values without affecting defaults, simply define new variables within @theme. They are merged with Tailwind's default theme.
    * Example:
      @theme {
        --color-accent: #ff00ff;
      }
      This adds bg-accent, text-accent, etc., alongside default colors like bg-red-500.
  * **Overriding Specific Values:** To change a default value, redefine the variable with the *same name* as the default within @theme.
    * Example:
      @theme {
        --breakpoint-sm: 30rem;
        --font-sans: "Roboto", sans-serif;
      }
      This changes the sm: breakpoint trigger point and the default sans-serif font stack.
  * **Overriding Entire Namespaces:** To remove all default values for a specific category (e.g., all default colors) and use only your custom ones, set the entire namespace to initial using the asterisk syntax (--namespace-*: initial;) before defining your custom values.
    * Example:
      @theme {
        /* Remove all default colors */
        --color-*: initial;

        /* Define custom colors */
        --color-brand: #1a2b3c;
        --color-highlight: #f0e68c;
        --color-white: #ffffff;
      }
      Now, utilities like bg-red-500 will not exist; only bg-brand, bg-highlight, etc., will be available.
  * **Disabling Default Theme Entirely:** To start from a completely blank slate without any default Tailwind theme values, set the global theme namespace to initial:
      @theme { --*: initial; }
    You would then need to define all necessary colors, spacing, breakpoints, etc.

* **D. Theme Customization Example (Light/Dark Mode):**
  * Implementing theme switching (like light/dark mode) in v4 typically involves combining CSS variables and custom variants.
  * **Step 1: Define Base Colors:** Define your core color palette variables (e.g., background, foreground, primary) within @theme. These will act as the default (usually light mode) theme.
    @theme {
      --color-background: hsl(0 0% 100%);
      --color-foreground: hsl(0 0% 3.9%);
      --color-primary: hsl(220 80% 55%);
      /*... other colors */
    }
  * **Step 2: Enable Class-Based Toggling:** Use @custom-variant to define a dark variant that activates based on a class (e.g., .dark) on a parent element (often <html> or <body>).
    @custom-variant dark (&:where(.dark,.dark *));
  * **Step 3: Define Dark Mode Overrides:** Define the CSS variable values for the dark theme within a standard CSS rule targeting the .dark class (usually applied to :root or body).
    :root {
      /* Light mode (or base) values */
      --background: hsl(0 0% 100%);
      --foreground: hsl(0 0% 3.9%);
      --primary: hsl(220 80% 55%);
    }

    .dark:root {
      /* Dark mode overrides */
      --background: hsl(0 0% 3.9%);
      --foreground: hsl(0 0% 98%);
      --primary: hsl(220 70% 65%);
    }

    /* Make theme variables available to Tailwind utilities */
    @theme inline {
      --color-background: var(--background);
      --color-foreground: var(--foreground);
      --color-primary: var(--primary);
    }
    (Note: The @theme inline approach shown here helps keep the variable definitions DRY by referencing the :root variables. Other approaches might involve defining dark mode colors directly within @variant dark inside component styles.)
  * **Step 4: Apply Colors:** Use the theme color utilities (e.g., bg-background, text-foreground, border-primary) in your HTML. Tailwind will automatically use the correct CSS variable value based on whether the .dark class is present.
  * **Step 5: Toggle Class:** Use JavaScript to add/remove the .dark class from the <html> or <body> element to switch themes.
  * Note: The CSS-first approach to theme switching in v4, while powerful, presents a different workflow compared to the simpler darkMode: 'class' configuration in v3's JavaScript config. The need to potentially manage variables in both :root (for runtime access) and @theme (for utility generation), or use @variant extensively, has led to some community discussion and exploration of best practices, indicating a potentially steeper learning curve for this specific common feature.

## **VII. What's New in Tailwind CSS v4?**

Tailwind CSS v4 introduces a host of significant changes, new features, and optimizations compared to v3.

* **A. Summary of Major Changes:**
  * **New Engine (Oxide):** A complete rewrite, incorporating Rust for key parts, resulting in dramatic improvements in build speed (up to 10x faster) and a smaller installation size.
  * **CSS-First Configuration:** The primary method for customization shifts from tailwind.config.js to the @theme directive within CSS, promoting a more CSS-native feel. Limited JS config support remains via @config.
  * **Simplified Setup:** Reduced dependencies, zero-configuration content detection (usually), and a single @import "tailwindcss"; directive streamline project initialization.
  * **Unified Toolchain:** Integrates Lightning CSS for built-in @import handling, vendor prefixing, and CSS nesting support, removing the need for separate PostCSS plugins like postcss-import and autoprefixer. A dedicated Vite plugin (@tailwindcss/vite) provides optimized integration.

* **B. Key New Features and Utilities:**
  * **Container Queries:** First-class support built into core using @container, @min-*, and @max-* variants, eliminating the need for a separate plugin.
  * **3D Transforms:** New utilities for transforming elements in 3D space (rotate-x-*, rotate-y-*, translate-z-*, scale-z-*, perspective, perspective-origin, transform-style).
  * **Expanded Gradient APIs:** Support for linear gradient angles (bg-linear-45), color interpolation modes (/oklch, /srgb), and new conic (bg-conic-*) and radial (bg-radial-*) gradient utilities.
  * **starting Variant:** Leverages the CSS @starting-style rule for creating enter and exit transitions without JavaScript.
  * **not-* Variant:** Implements the CSS :not() pseudo-class for conditional styling based on negation.
  * **Dynamic Values & Variants:** Increased ability for utilities (especially spacing, grid templates) to accept arbitrary values directly, reducing configuration needs. Boolean data attributes can also be targeted without prior definition.
  * **Modernized Color Palette:** Default color palette uses the oklch color space for wider gamut support on compatible displays, while maintaining similar balance to v3 colors for easier upgrades.
  * **CSS Theme Variables:** All design tokens defined via @theme are automatically exposed as native CSS variables, accessible via var().
  * **Other New Utilities/Variants:** inset-shadow-*, inset-ring-*; field-sizing; color-scheme; font-stretch; inert variant; nth-* variants; in-* variant (implicit groups); open variant support for :popover-open; descendant variant (*:).

* **C. Renamed/Removed Utilities & Breaking Changes:**
  * **Directives:** @tailwind base/components/utilities removed; use @import "tailwindcss";.
  * **Configuration:** tailwind.config.js largely replaced by @theme in CSS. @config provides limited compatibility. corePlugins option removed. resolveConfig function removed.
  * **Removed Utilities:** Long-deprecated v3 utilities (e.g., text-opacity-*, bg-opacity-*, flex-grow-*, flex-shrink-*, overflow-ellipsis) are removed.
  * **Renamed Utilities:**
    * Shadows/Blurs/Radii: sm -> xs, default -> sm (e.g., shadow is now shadow-sm).
    * Outline: outline-none -> outline-hidden.
    * Ring: ring (v3 default 3px) -> ring-3; new default ring is ring-1.
    * Gradients: bg-gradient-* -> bg-linear-*.
  * **Default Value Changes:**
    * Border Color: currentColor (was gray-200).
    * Ring Width/Color: 1px / currentColor (was 3px / blue-500).
    * Outline Utility: Defaults changed.
  * **Behavioral Changes:**
    * space-x/y selector logic updated (performance).
    * Gradient application with variants preserves other stops.
    * container utility center/padding config removed.
    * Preflight base styles updated (placeholder color, button cursor, dialog margin).
    * Prefix syntax changed (e.g., tw:flex).
    * Variant stacking order reversed (left-to-right applies first).
    * Arbitrary variable syntax uses parentheses (...) not brackets [ ... ].
    * hover variant behavior on touch devices changed.
    * transition property now includes outline-color.
  * **API/Integration Changes:**
    * Custom utilities added via @utility (not @layer utilities).
    * theme() function deprecated; use var().
    * Using @apply in scoped styles (Vue/Svelte/CSS Modules) requires @reference.

* **D. Browser Support:**
  * Tailwind CSS v4 explicitly targets modern browsers: **Safari 16.4+, Chrome 111+, and Firefox 128+**. Older browsers are not supported.
  * This decision allows v4 to leverage modern CSS features like cascade layers, @property, and color-mix() without complex fallbacks, contributing to its performance and smaller size. However, it signifies a potential barrier for projects needing to support older browser environments. Developers working in sectors with strict legacy browser requirements (e.g., certain government or enterprise contexts) may need to remain on v3 or invest in polyfills and testing if considering v4, as the baseline is significantly higher than previous versions. This trade-off prioritizes modern web capabilities over maximum backward compatibility.

## **VIII. Conclusion**

Tailwind CSS v4 represents a bold step forward, rebuilding the framework from the ground up to deliver exceptional performance and a developer experience deeply integrated with modern CSS standards. The shift to a CSS-first configuration model via the @theme directive streamlines customization, while the unified toolchain simplifies setup and reduces dependencies. New features like core container queries, 3D transforms, expanded gradient APIs, and the starting variant empower developers to build sophisticated interfaces more efficiently.
The framework's embrace of native CSS features like cascade layers and custom properties, coupled with its significantly faster engine, positions Tailwind v4 as a highly performant and future-focused tool. While the move away from JavaScript configuration and the adoption of a higher browser baseline require adaptation, the benefits in terms of speed, flexibility, and alignment with the web platform are substantial.
This quick reference guide provides a comprehensive overview of Tailwind CSS v4's utilities, directives, functions, and customization patterns. By consolidating key information, examples, and highlighting important changes, it serves as an essential resource for developers navigating this powerful new version of the framework, enabling them to leverage its full potential in their projects.

#### **Works cited**

1. Tailwind CSS v4.0, https://tailwindcss.com/blog/tailwindcss-v4
2. Open-sourcing our progress on Tailwind CSS v4.0, https://tailwindcss.com/blog/tailwindcss-v4-alpha
3. Tailwind CSS v4.0 Beta 1 - Tailwind CSS, https://tailwindcss.com/blog/tailwindcss-v4-beta
4. Theme variables - Core concepts - Tailwind CSS, https://tailwindcss.com/docs/theme
5. What is the purpose of the Tailwind @layer directive? - Stack Overflow, https://stackoverflow.com/questions/74429397/what-is-the-purpose-of-the-tailwind-layer-directive
6. CSS Variables + TailwindCSS - Hyvä Docs, https://docs.hyva.io/hyva-themes/working-with-tailwindcss/css-variables-plus-tailwindcss.html
7. [v4] Docs on tailwind.config.js and @config · tailwindlabs/tailwindcss · Discussion #16803, https://github.com/tailwindlabs/tailwindcss/discussions/16803
8. Functions and directives - Core concepts - Tailwind CSS, https://tailwindcss.com/docs/functions-and-directives
9. How to use custom color themes in TailwindCSS v4 - Stack Overflow, https://stackoverflow.com/questions/79499818/how-to-use-custom-color-themes-in-tailwindcss-v4
10. Upgrade guide - Getting started - Tailwind CSS, https://tailwindcss.com/docs/upgrade-guide
11. display - Layout - Tailwind CSS, https://tailwindcss.com/docs/display
12. max-width - Sizing - Tailwind CSS, https://tailwindcss.com/docs/container
13. flex-direction - Flexbox & Grid - Tailwind CSS, https://tailwindcss.com/docs/flex-direction
14. grid-template-columns - Flexbox & Grid - Tailwind CSS, https://tailwindcss.com/docs/grid-template-columns
15. gap - Flexbox & Grid - Tailwind CSS, https://tailwindcss.com/docs/gap
16. padding - Spacing - Tailwind CSS, https://tailwindcss.com/docs/padding
17. width - Sizing - Tailwind CSS, https://tailwindcss.com/docs/width
18. Tailwind v4 - Shadcn UI, https://ui.shadcn.com/docs/tailwind-v4
19. A First Look at Setting Up Tailwind CSS v4.0, https://bryananthonio.com/blog/configuring-tailwind-css-v4/
20. Tailwind CSS Theming - Flowbite, https://flowbite.com/docs/customize/theming/
21. How to Setup Tailwind css v4 and Customize Fonts, Colors and Styles - YouTube, https://www.youtube.com/watch?v=sX0x5CSky_k
22. font-family - Typography - Tailwind CSS, https://tailwindcss.com/docs/font-family
23. color - Typography - Tailwind CSS, https://tailwindcss.com/docs/text-color
24. line-height - Typography - Tailwind CSS, https://tailwindcss.com/docs/line-height
25. background-color - Backgrounds - Tailwind CSS, https://tailwindcss.com/docs/background-color
26. box-shadow - Effects - Tailwind CSS, https://tailwindcss.com/docs/box-shadow
27. background-image - Backgrounds - Tailwind CSS, https://tailwindcss.com/docs/background-image
28. border-width - Borders - Tailwind CSS, https://tailwindcss.com/docs/border-width
29. border-radius - Borders - Tailwind CSS, https://tailwindcss.com/docs/border-radius
30. opacity - Effects - Tailwind CSS, https://tailwindcss.com/docs/opacity
31. filter: blur() - Filters - Tailwind CSS, https://tailwindcss.com/docs/blur
32. table-layout - Tables - Tailwind CSS, https://tailwindcss.com/docs/table-layout
33. transition-property - Transitions & Animation - Tailwind CSS, https://tailwindcss.com/docs/transition-property
34. animation - Transitions & Animation - Tailwind CSS, https://tailwindcss.com/docs/animation
35. scale - Transforms - Tailwind CSS, https://tailwindcss.com/docs/scale
36. cursor - Interactivity - Tailwind CSS, https://tailwindcss.com/docs/cursor
37. fill - SVG - Tailwind CSS, https://tailwindcss.com/docs/fill
38. UI Blocks Documentation - Tailwind Plus, https://tailwindcss.com/plus/ui-blocks/documentation
39. Adding custom styles - Core concepts - Tailwind CSS, https://tailwindcss.com/docs/adding-custom-styles
40. Change CSS custom property value depending on theme in Tailwind v4 - Stack Overflow, https://stackoverflow.com/questions/79386725/change-css-custom-property-value-depending-on-theme-in-tailwind-v4
41. In Tailwind v4, how to define custom colors and use them in dark, light mode without using :dark? - Stack Overflow, https://stackoverflow.com/questions/79540647/in-tailwind-v4-how-to-define-custom-colors-and-use-them-in-dark-light-mode-wit
42. How to create a dark/light mode theme switcher on v4.0? · tailwindlabs/tailwindcss · Discussion #16925 - GitHub, https://github.com/tailwindlabs/tailwindcss/discussions/16925
43. How to set up custom utility classes with v4 and vite? : r/tailwindcss - Reddit, https://www.reddit.com/r/tailwindcss/comments/1irhtb1/how_to_set_custom_utility_classes_with_v4_and/
44. [v4] Cannot apply unknown utility class: xxx · Issue #15778 · tailwindlabs/tailwindcss, https://github.com/tailwindlabs/tailwindcss/issues/15778
45. v4: define all Tailwind CSS Variables using ":root, :host" selector for Shadow DOM compatibility · tailwindlabs/tailwindcss · Discussion #15556 · GitHub, https://github.com/tailwindlabs/tailwindcss/discussions/15556
46. How to Access Theme in Tailwind CSS v4? · tailwindlabs/tailwindcss · Discussion #16436 - GitHub, https://github.com/tailwindlabs/tailwindcss/discussions/16436
