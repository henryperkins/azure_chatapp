# Comprehensive Tailwind CSS v4 Reference Guide

## I. Installation & Setup

**Installation Options:**
```bash
# PostCSS setup (recommended)
npm install -D tailwindcss @tailwindcss/postcss postcss

# Vite setup (best performance)
npm install -D @tailwindcss/vite
```

**PostCSS Configuration:**
```js
// postcss.config.js
module.exports = {
  plugins: {
    "@tailwindcss/postcss": {} // No need for autoprefixer or postcss-import
  }
}
```

**Importing Tailwind in CSS:**
```css
/* Single import now replaces all v3's @tailwind directives */
@import "tailwindcss";

/* Define custom theme variables */
@theme {
  --color-primary: #3b82f6;
  --font-display: "Inter", sans-serif;
  --breakpoint-3xl: 1920px;
}
```

**Build Commands:**
```bash
# Using PostCSS CLI
npx postcss input.css -o output.css --watch

# Using Tailwind CLI (now a separate package)
npx @tailwindcss/cli -i input.css -o output.css --watch
```

**HTML Usage:**
```html
<link href="/path/to/output.css" rel="stylesheet">

<!-- Example usage -->
<div class="bg-white dark:bg-slate-900 rounded-lg p-8 shadow-lg">
  <h1 class="text-3xl font-bold mb-4 text-primary">Welcome to Tailwind v4</h1>
  <p class="text-gray-600 dark:text-gray-300">Build faster than ever before.</p>
</div>
```

## II. Core Concepts & Features

### CSS-First Configuration
```css
/* Replace JS config with @theme directive */
@theme {
  /* Colors generate text-*, bg-*, border-*, etc. */
  --color-primary: #0ea5e9;
  --color-accent: #f59e0b;
  --color-danger: #ef4444;

  /* Fonts generate font-* utilities */
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --font-display: "Satoshi", sans-serif;

  /* Spacing controls p-*, m-*, gap-*, etc. */
  --spacing: 0.25rem;
  --spacing-md: 1rem;
  --spacing-xl: 3rem;

  /* Breakpoints control responsive variants */
  --breakpoint-xs: 480px;
  --breakpoint-3xl: 1920px;

  /* Custom shadows */
  --shadow-elevated: 0 10px 25px -5px rgb(0 0 0 / 0.1);
}
```

### Loading Legacy Config
```css
/* Must come before importing Tailwind */
@config "tailwind.config.js";
@import "tailwindcss";
```

### Content Detection
```css
/* Tailwind auto-detects files to scan (no content array needed) */
/* Explicitly include special paths if needed */
@source "../node_modules/@my-company/ui-lib/**/*.js";

/* Exclude paths */
@source not "../src/legacy-code/**/*";

/* Force generation of specific utilities regardless of usage */
@source inline("grid-cols-{1..12}");
@source inline("{hover:,focus:}underline");

/* Disable auto-detection entirely if needed */
@import "tailwindcss" source(none);
@source "./src/**/*.{html,js}";
```

## III. Directives Reference

| Directive | Purpose | Example |
|-----------|---------|---------|
| `@import` | Import Tailwind or other CSS files | `@import "tailwindcss";` |
| `@theme` | Define custom design tokens | `@theme { --color-brand: #ff0000; }` |
| `@source` | Control which files are scanned | `@source "../components/**/*.jsx";` |
| `@utility` | Create custom utilities | `@utility scrollbar-hide { scrollbar-width: none; }` |
| `@variant` | Add variant styles | `@variant dark { background-color: black; }` |
| `@custom-variant` | Define custom state variants | `@custom-variant expanded (&[aria-expanded="true"]);` |
| `@apply` | Use utilities in custom CSS | `.btn { @apply py-2 px-4 rounded; }` |
| `@reference` | Import for use with @apply only | `@reference "../../main.css";` |
| `@config` | Load JS config file | `@config "tailwind.config.js";` |
| `@layer` | Add to CSS cascade layers | `@layer components { .card { @apply p-4; }}` |
| `@plugin` | Import Tailwind plugins | `@plugin "@tailwindcss/typography";` |

### Example: Custom Utility with Arguments
```css
/* Basic utility */
@utility content-auto { content-visibility: auto; }

/* Utility that accepts spacing scale values */
@utility gap-x-* { column-gap: --value(--spacing-*); }

/* Complex utility with nesting */
@utility scrollable {
  overflow-y: auto;
  &::-webkit-scrollbar { width: 4px; }
  &::-webkit-scrollbar-thumb { background-color: var(--color-gray-300); }
}
```

### Example: Custom Variant
```css
/* Create a theme switching variant */
@custom-variant theme-blue (&:where([data-theme="blue"], [data-theme="blue"] *));

/* Usage: theme-blue:text-white */
```

## IV. Functions

| Function | Purpose | Example |
|----------|---------|---------|
| `--alpha()` | Adjust color opacity | `color: --alpha(var(--color-primary) / 50%);` |
| `var()` | Access CSS variables | `background: var(--color-accent);` |
| `--value()` | Get values for dynamic utilities | `@utility p-* { padding: --value(--spacing-*); }` |
| Arbitrary values | Use any CSS value | `w-[347px]`, `grid-cols-[1fr_2fr_1fr]` |
| CSS variable shorthand | Use variables with utilities | `text-(--my-text-color)` instead of `text-[var(--my-text-color)]` |

## V. Layout Utilities

### Display
```html
<div class="block">Full-width block</div>
<div class="inline-block">Inline-block</div>
<div class="inline">Inline text</div>
<div class="flex">Flex container</div>
<div class="inline-flex">Inline flex</div>
<div class="grid">Grid container</div>
<div class="contents">Contents</div>
<div class="hidden">Hidden element</div>
```

### Position
```html
<div class="static">Default positioning</div>
<div class="relative">Relative (reference for absolute)</div>
<div class="absolute inset-0">Cover parent</div>
<div class="absolute top-4 right-4">Top right corner</div>
<div class="fixed bottom-0 w-full">Fixed at bottom</div>
<div class="sticky top-0 z-10">Sticky header</div>
```

### Z-Index
```html
<div class="z-0">Base layer</div>
<div class="z-10">Above base</div>
<div class="z-50">Higher priority</div>
<div class="z-auto">Auto z-index</div>
<div class="z-[100]">Custom z-index</div>
```

### Box Sizing
```html
<div class="box-border">Border-box (standard)</div>
<div class="box-content">Content-box</div>
```

### Container & Object Fit
```html
<div class="container mx-auto px-4">Centered container with padding</div>

<img class="object-cover w-full h-48" src="image.jpg">
<img class="object-contain h-32 w-32" src="image.jpg">
<img class="object-fill" src="image.jpg">
<img class="object-scale-down" src="image.jpg">
<img class="object-none" src="image.jpg">
```

### Overflow
```html
<div class="overflow-auto">Scrollbars when needed</div>
<div class="overflow-hidden">Hide overflowing content</div>
<div class="overflow-visible">Show overflowing content</div>
<div class="overflow-x-auto overflow-y-hidden">Horizontal scroll only</div>
```

## VI. Flexbox & Grid

### Flexbox
```html
<!-- Basic Row (default) -->
<div class="flex flex-row space-x-4">
  <div>Item 1</div>
  <div>Item 2</div>
  <div>Item 3</div>
</div>

<!-- Column -->
<div class="flex flex-col space-y-4">
  <div>Top</div>
  <div>Middle</div>
  <div>Bottom</div>
</div>

<!-- Wrapping -->
<div class="flex flex-wrap">
  <!-- Items will wrap to next line when needed -->
</div>

<!-- Distribution -->
<div class="flex justify-between items-center">
  <div>Start</div>
  <div>Center item vertically</div>
  <div>End</div>
</div>

<!-- Grow & Shrink -->
<div class="flex">
  <div class="flex-none w-16">Fixed width</div>
  <div class="flex-1">Grows to fill space</div>
  <div class="flex-initial">Only shrinks if needed</div>
</div>

<!-- Alternative grow/shrink shorthand -->
<div class="flex">
  <div class="shrink-0">Won't shrink</div>
  <div class="grow">Will grow</div>
</div>

<!-- Order -->
<div class="flex">
  <div class="order-last">Appears last</div>
  <div class="order-first">Appears first</div>
  <div class="order-2">Second</div>
</div>
```

### Grid
```html
<!-- Basic Grid -->
<div class="grid grid-cols-3 gap-4">
  <div>1</div>
  <div>2</div>
  <div>3</div>
  <div>4</div>
  <div>5</div>
  <div>6</div>
</div>

<!-- Responsive Grid -->
<div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6">
  <!-- Columns change at breakpoints -->
</div>

<!-- Spanning Cells -->
<div class="grid grid-cols-3 gap-4">
  <div class="col-span-2">Spans 2 columns</div>
  <div>Regular cell</div>
  <div>Regular cell</div>
  <div class="col-span-3">Full width</div>
</div>

<!-- Grid Placement -->
<div class="grid grid-cols-3 grid-rows-3 gap-4">
  <div class="col-start-2 col-end-4 row-start-1 row-end-3">
    Custom placement area
  </div>
</div>

<!-- Auto Rows/Columns -->
<div class="grid grid-cols-3 auto-rows-min gap-4">
  <!-- Rows size to content -->
</div>

<!-- Custom Grid Layout -->
<div class="grid grid-cols-[1fr_500px_2fr] gap-4">
  <div>Flexible</div>
  <div>500px fixed width</div>
  <div>2x Flexible</div>
</div>
```

## VII. Spacing & Sizing

### Padding
```html
<div class="p-4">All sides</div>
<div class="px-4 py-2">Horizontal 4, vertical 2</div>
<div class="pt-2 pr-4 pb-8 pl-1">Individual sides</div>
<div class="p-[22px]">Custom padding</div>
```

### Margin
```html
<div class="m-4">All sides</div>
<div class="mx-auto">Center horizontally</div>
<div class="mt-6 mb-8">Top/bottom only</div>
<div class="mx-4 my-6">Horizontal/vertical</div>
<div class="m-(--my-custom-margin)">Using CSS variable</div>
```

### Space Between
```html
<div class="space-y-4">
  <div>Vertical spacing</div>
  <div>Between elements</div>
  <div>Without margins</div>
</div>

<div class="flex space-x-4">
  <div>Horizontal</div>
  <div>Space</div>
  <div>Between</div>
</div>
```

### Width & Height
```html
<div class="w-full">100% width</div>
<div class="w-1/2">50% width</div>
<div class="w-screen">Viewport width</div>
<div class="w-48">12rem width</div>
<div class="w-auto">Auto width</div>
<div class="w-min">Min-content width</div>
<div class="w-max">Max-content width</div>
<div class="w-fit">Fit-content width</div>
<div class="w-[425px]">Custom width</div>

<div class="h-screen">Full viewport height</div>
<div class="h-32">8rem height</div>
<div class="h-full">100% height (of parent)</div>

<!-- Width/height together -->
<div class="size-12">12 × 12 square</div>
<div class="size-[150px]">Custom square</div>
```

### Min/Max Width/Height
```html
<div class="min-w-0">Minimum width 0</div>
<div class="min-w-full">Minimum 100% width</div>
<div class="max-w-md">Max width (28rem)</div>
<div class="max-w-prose">Max width for comfortable reading</div>
<div class="max-h-screen">Maximum viewport height</div>
```

## VIII. Typography

### Font Family
```html
<p class="font-sans">System UI sans-serif font</p>
<p class="font-serif">Serif font</p>
<p class="font-mono">Monospace font</p>
<p class="font-display">Custom display font (if defined in theme)</p>
```

### Font Size
```html
<p class="text-xs">Extra small</p>
<p class="text-sm">Small</p>
<p class="text-base">Base size</p>
<p class="text-lg">Large</p>
<p class="text-xl">Extra large</p>
<p class="text-2xl">2X large</p>
<p class="text-[32px]">Custom size</p>

<!-- With line height -->
<p class="text-base/7">Base size with 1.75rem line height</p>
```

### Font Weight
```html
<p class="font-thin">Thin (100)</p>
<p class="font-normal">Normal (400)</p>
<p class="font-medium">Medium (500)</p>
<p class="font-semibold">Semibold (600)</p>
<p class="font-bold">Bold (700)</p>
<p class="font-black">Black (900)</p>
```

### Text Color
```html
<p class="text-black">Black text</p>
<p class="text-white">White text</p>
<p class="text-blue-500">Blue text</p>
<p class="text-primary">Theme color (from --color-primary)</p>
<p class="text-gray-500/50">Gray with 50% opacity</p>
<p class="text-[#ff6b6b]">Custom hex color</p>
<p class="text-(--my-variable)">From CSS variable</p>
```

### Text Alignment
```html
<p class="text-left">Left aligned</p>
<p class="text-center">Center aligned</p>
<p class="text-right">Right aligned</p>
<p class="text-justify">Justified text</p>
```

### Text Decoration
```html
<p class="underline">Underlined text</p>
<p class="underline decoration-blue-500">Blue underline</p>
<p class="underline decoration-2 decoration-wavy">Thick wavy underline</p>
<p class="overline">Overlined text</p>
<p class="line-through">Strikethrough</p>
<p class="no-underline">No underline</p>
```

### Text Transform
```html
<p class="uppercase">ALL CAPS</p>
<p class="lowercase">all lowercase</p>
<p class="capitalize">Capitalize Each Word</p>
<p class="normal-case">Normal case text</p>
```

### Line Height & Tracking
```html
<p class="leading-none">Tightest</p>
<p class="leading-tight">Tight</p>
<p class="leading-normal">Normal</p>
<p class="leading-relaxed">Relaxed</p>
<p class="leading-loose">Loose</p>
<p class="leading-[3.5rem]">Custom</p>

<p class="tracking-tighter">Tighter letter spacing</p>
<p class="tracking-normal">Normal letter spacing</p>
<p class="tracking-wider">Wider letter spacing</p>
<p class="tracking-[0.25em]">Custom tracking</p>
```

### Text Overflow & Indent
```html
<p class="truncate w-48">Very long text will be truncated...</p>
<p class="text-ellipsis overflow-hidden">Text ellipsis when overflowing</p>
<p class="text-wrap">Standard wrapping</p>
<p class="text-nowrap">Prevents wrapping</p>
<p class="indent-8">First-line indentation</p>
<p class="indent-[2em]">Custom indentation</p>
```

## IX. Backgrounds

### Background Color
```html
<div class="bg-white">White background</div>
<div class="bg-blue-500">Blue background</div>
<div class="bg-gradient-to-r from-cyan-500 to-blue-500">Gradient</div>
<div class="bg-transparent">Transparent background</div>
<div class="bg-black/25">Black with 25% opacity</div>
<div class="bg-[url('/img/pattern.jpg')]">Background image</div>
```

### Background Gradients
```html
<!-- Linear gradient (new bg-linear-* naming in v4) -->
<div class="bg-linear-to-r from-indigo-500 via-purple-500 to-pink-500">
  Right linear gradient with 3 stops
</div>

<!-- Radial gradient (new in v4) -->
<div class="bg-radial from-amber-200 to-yellow-400">
  Radial gradient
</div>

<!-- Conic gradient (new in v4) -->
<div class="bg-conic from-red-500 via-green-500 to-blue-500">
  Conic gradient
</div>

<!-- Gradient with angle (new in v4) -->
<div class="bg-linear-45 from-blue-600 to-purple-600">
  Linear at 45 degrees
</div>

<!-- Gradient with custom color interpolation (new in v4) -->
<div class="bg-linear-to-r/oklch from-blue-600 to-red-600">
  Using OKLCH interpolation
</div>
```

### Background Size & Position
```html
<div class="bg-auto">Natural size</div>
<div class="bg-cover">Cover container</div>
<div class="bg-contain">Contain in container</div>

<div class="bg-center">Centered</div>
<div class="bg-top">Top aligned</div>
<div class="bg-bottom">Bottom aligned</div>
<div class="bg-right-top">Top right corner</div>
```

### Background Repeat & Attachment
```html
<div class="bg-repeat">Repeating (default)</div>
<div class="bg-no-repeat">No repeat</div>
<div class="bg-repeat-x">Repeat horizontally only</div>
<div class="bg-repeat-y">Repeat vertically only</div>

<div class="bg-fixed">Fixed while scrolling</div>
<div class="bg-local">Scrolls with content</div>
<div class="bg-scroll">Scrolls with element</div>
```

## X. Borders & Outline

### Border Width
```html
<div class="border">Standard 1px border</div>
<div class="border-2">2px border</div>
<div class="border-4">4px border</div>
<div class="border-x">Left & right borders</div>
<div class="border-t-2">2px top border</div>
<div class="border-b-4">4px bottom border</div>
<div class="border-[3px]">Custom border width</div>
```

### Border Color
```html
<div class="border border-gray-300">Gray border</div>
<div class="border-2 border-blue-500">Blue border</div>
<div class="border border-red-500/50">Semi-transparent border</div>
<div class="border border-[#ffd700]">Custom gold border</div>
<div class="border border-(--my-border-color)">From CSS variable</div>
```

### Border Style
```html
<div class="border border-solid">Solid border (default)</div>
<div class="border-2 border-dashed">Dashed border</div>
<div class="border-4 border-dotted">Dotted border</div>
<div class="border border-double">Double border</div>
<div class="border-0">No border</div>
```

### Border Radius
```html
<div class="rounded-sm">Small radius</div>
<div class="rounded">Medium radius</div>
<div class="rounded-md">Medium-large radius</div>
<div class="rounded-lg">Large radius</div>
<div class="rounded-full">Fully rounded (circle/pill)</div>
<div class="rounded-t-lg">Top corners only</div>
<div class="rounded-r-lg">Right corners only</div>
<div class="rounded-tr-lg">Top-right corner only</div>
<div class="rounded-[12px]">Custom border radius</div>
```

### Divide (Borders Between Children)
```html
<div class="divide-y divide-gray-200">
  <div class="py-4">First item</div>
  <div class="py-4">Second item with border top</div>
  <div class="py-4">Third item with border top</div>
</div>

<div class="flex divide-x divide-blue-200">
  <div class="px-4">Left</div>
  <div class="px-4">Middle with left border</div>
  <div class="px-4">Right with left border</div>
</div>
```

### Outline
```html
<button class="outline outline-offset-2 outline-blue-500">
  Outlined button
</button>
<button class="outline-hidden focus:outline-2 focus:outline-blue-500">
  Outline hidden until focus (accessible)
</button>
<button class="outline-none">
  No outline (use with caution - less accessible)
</button>
```

### Ring
```html
<button class="ring">Default 1px ring (v4)</button>
<button class="ring-2">2px ring</button>
<button class="ring-4 ring-blue-500">Blue ring</button>
<button class="ring-offset-2 ring-2">Ring with offset</button>
<button class="inset-ring-2">Inner ring (new in v4)</button>
```

## XI. Effects (Shadows, Opacity)

### Box Shadow
```html
<div class="shadow-sm">Small shadow</div>
<div class="shadow">Standard shadow</div>
<div class="shadow-md">Medium shadow</div>
<div class="shadow-lg">Large shadow</div>
<div class="shadow-xl">Extra large shadow</div>
<div class="shadow-2xl">2x extra large shadow</div>
<div class="shadow-none">No shadow</div>
<div class="shadow-blue-500/50">Colored shadow</div>
<div class="inset-shadow-md">Inner shadow (new in v4)</div>
```

### Opacity
```html
<div class="opacity-0">Completely transparent</div>
<div class="opacity-25">25% opacity</div>
<div class="opacity-50">50% opacity</div>
<div class="opacity-75">75% opacity</div>
<div class="opacity-100">Fully visible</div>

<!-- Alternative opacity with color utilities -->
<div class="bg-black/25">Black background at 25% opacity</div>
<div class="text-blue-500/75">Blue text at 75% opacity</div>
```

### Mix Blend Mode
```html
<div class="bg-blue-500 mix-blend-multiply">
  Multiply blend mode
</div>

<div class="bg-gradient-to-r from-purple-500 to-pink-500 bg-blend-overlay">
  Background blend mode
</div>
```

## XII. Filters

### Blur
```html
<div class="blur-none">No blur</div>
<div class="blur-sm">Small blur</div>
<div class="blur">Medium blur</div>
<div class="blur-lg">Large blur</div>
<div class="blur-xl">Extra large blur</div>
<div class="blur-[12px]">Custom blur</div>
```

### Brightness, Contrast, Saturation
```html
<img class="brightness-50" src="...">
<img class="brightness-100" src="...">
<img class="brightness-125" src="...">

<img class="contrast-50" src="...">
<img class="contrast-100" src="...">
<img class="contrast-125" src="...">

<img class="saturate-0" src="...">
<img class="saturate-100" src="...">
<img class="saturate-150" src="...">
```

### Grayscale, Sepia, Hue, Invert
```html
<img class="grayscale" src="...">
<img class="sepia" src="...">
<img class="hue-rotate-90" src="...">
<img class="invert" src="...">
```

### Drop Shadow
```html
<div class="drop-shadow-sm">Small drop shadow</div>
<div class="drop-shadow">Default drop shadow</div>
<div class="drop-shadow-lg">Large drop shadow</div>
```

### Backdrop Filters
```html
<div class="backdrop-blur-lg">Blurred backdrop</div>
<div class="backdrop-brightness-150">Brighter backdrop</div>
<div class="backdrop-contrast-50">Lower contrast backdrop</div>
<div class="backdrop-grayscale">Grayscale backdrop</div>
<div class="backdrop-invert">Inverted backdrop</div>
```

## XIII. Transitions & Animation

### Transition Properties
```html
<div class="transition">Default transition</div>
<div class="transition-all">All properties</div>
<div class="transition-colors">Colors only</div>
<div class="transition-opacity">Opacity only</div>
<div class="transition-shadow">Shadow only</div>
<div class="transition-transform">Transforms only</div>
```

### Transition Duration & Timing
```html
<div class="duration-75">Very fast (75ms)</div>
<div class="duration-150">Fast (150ms)</div>
<div class="duration-300">Medium (300ms)</div>
<div class="duration-700">Slow (700ms)</div>

<div class="ease-linear">Linear timing</div>
<div class="ease-in">Ease in</div>
<div class="ease-out">Ease out</div>
<div class="ease-in-out">Ease in-out</div>
```

### Delay
```html
<div class="delay-150">150ms delay</div>
<div class="delay-300">300ms delay</div>
<div class="delay-700">700ms delay</div>
```

### Animation
```html
<div class="animate-spin">Spinning animation</div>
<div class="animate-ping">Ping animation</div>
<div class="animate-pulse">Pulsing animation</div>
<div class="animate-bounce">Bouncing animation</div>
<div class="animate-none">No animation</div>
```

### Starting Transitions (new in v4)
```html
<div class="starting:opacity-0 transition-opacity duration-700">
  This will fade in starting from opacity 0
</div>

<div class="starting:translate-y-4 transition-transform duration-300">
  This will slide up from 1rem below
</div>
```

## XIV. Transforms

### Scale
```html
<div class="transform scale-50">Half size</div>
<div class="transform scale-100">Normal size</div>
<div class="transform scale-150">1.5x size</div>

<div class="transform scale-x-50">Half width</div>
<div class="transform scale-y-150">1.5x height</div>
<div class="transform scale-[1.33]">Custom scale</div>
```

### Rotate
```html
<div class="transform rotate-45">45 degrees</div>
<div class="transform rotate-90">90 degrees</div>
<div class="transform -rotate-45">-45 degrees</div>
<div class="transform rotate-[17deg]">Custom rotation</div>
```

### Translate (Move)
```html
<div class="transform translate-x-4">Move right</div>
<div class="transform -translate-x-4">Move left</div>
<div class="transform translate-y-4">Move down</div>
<div class="transform translate-y-[-10px]">Move up custom</div>
```

### Skew
```html
<div class="transform skew-x-12">Skew horizontally</div>
<div class="transform skew-y-12">Skew vertically</div>
```

### Origin
```html
<div class="origin-center">Center origin (default)</div>
<div class="origin-top-left">Top-left origin</div>
<div class="origin-bottom-right">Bottom-right origin</div>
```

### 3D Transforms (new in v4)
```html
<div class="transform-style-3d perspective-1">
  <div class="transform rotate-x-15 rotate-y-30">
    3D rotated element
  </div>
</div>

<!-- 3D card flip -->
<div class="relative transform-style-3d h-64 w-44">
  <div class="absolute inset-0 backface-hidden transform rotate-y-0">Front</div>
  <div class="absolute inset-0 backface-hidden transform rotate-y-180">Back</div>
</div>
```

## XV. Responsive Design

### Breakpoints
```html
<!-- Mobile-first approach -->
<div class="text-sm sm:text-base md:text-lg lg:text-xl xl:text-2xl">
  Text size increases at each breakpoint
</div>

<div class="block md:flex lg:grid lg:grid-cols-3">
  Layout changes based on screen size
</div>

<!-- Max-width (upper-bound) constraints -->
<div class="md:max-xl:bg-red-100">
  Red only between md and xl breakpoints
</div>

<!-- Arbitrary breakpoints -->
<div class="min-[320px]:text-center max-[600px]:text-left">
  Centered between 320px and 600px
</div>
```

### Container Queries (new in v4)
```html
<div class="@container">
  <!-- This parent creates a container context -->
  <div class="@sm:columns-2 @lg:columns-3">
    <!-- Columns based on container width, not viewport -->
  </div>

  <h2 class="text-lg @md:text-xl @xl:text-2xl">
    <!-- Text size based on container width -->
  </h2>

  <div class="grid grid-cols-1 @md:grid-cols-2 @lg:grid-cols-3 gap-4">
    <!-- Grid based on container size -->
  </div>

  <!-- Max-width container queries -->
  <div class="block @max-md:hidden">
    <!-- Hidden when container is smaller than md breakpoint -->
  </div>
</div>
```

## XVI. Dark Mode

### Default Media Strategy
```html
<!-- Automatic dark based on system preference -->
<div class="bg-white text-gray-800 dark:bg-gray-900 dark:text-white">
  Auto dark mode based on system preference
</div>
```

### Manual Class Strategy
```css
/* In CSS (to override the media strategy) */
@custom-variant dark (&:where(.dark, .dark *));

/* Then toggle with JavaScript */
// document.documentElement.classList.toggle('dark');
```

```html
<!-- Via data attribute alternatively -->
<body data-theme="dark">
  <!-- Add to CSS: -->
  <!-- @custom-variant dark (&:where([data-theme="dark"], [data-theme="dark"] *)); -->
</body>
```

## XVII. Theme Customization (Light/Dark)

```css
/* Theme tokens in CSS variables */
:root {
  --text-color: #111827;
  --bg-color: #ffffff;
  --card-bg: #f9fafb;
  --btn-primary: #2563eb;
}

.dark:root {
  --text-color: #f9fafb;
  --bg-color: #1f2937;
  --card-bg: #111827;
  --btn-primary: #3b82f6;
}

/* Make theme variables available to Tailwind */
@theme inline {
  --color-text: var(--text-color);
  --color-bg: var(--bg-color);
  --color-card: var(--card-bg);
  --color-btn-primary: var(--btn-primary);
}
```

## XVIII. State Variants

### Interactive States
```html
<button class="bg-blue-500 hover:bg-blue-700 focus:ring-2">
  Button with hover and focus states
</button>

<input class="border focus:outline-none focus:border-blue-500 focus:ring-1"
  placeholder="Focus changes border">

<button class="active:bg-green-700">
  Background changes while pressed
</button>
```

### Group & Peer Hover
```html
<div class="group p-4 hover:bg-slate-100">
  Parent hover affects
  <span class="text-gray-400 group-hover:text-black">this child text</span>
</div>

<input id="toggle" type="checkbox" class="peer sr-only">
<label for="toggle" class="peer-checked:bg-green-200">
  Changes when checkbox is checked
</label>
```

### Form States
```html
<input class="disabled:opacity-50" disabled>
<input class="border-gray-300 valid:border-green-500 invalid:border-red-500"
  type="email" required>
<input class="checked:bg-blue-500" type="checkbox">
<input class="indeterminate:border-gray-300" type="checkbox">
```

### Combined Variants
```html
<button class="bg-blue-500 hover:bg-blue-700 md:hover:bg-green-600 dark:hover:bg-purple-800">
  Multiple variants stacked (responsive, state, theme)
</button>

<div class="group hover:[&>*]:underline">
  <p>Child underlines</p>
  <p>On parent hover</p>
</div>
```

## XIX. SVG

```html
<svg class="fill-blue-500 hover:fill-blue-700">...</svg>
<svg class="stroke-red-500 stroke-2">...</svg>
```

## XX. Migration Notes: v3 → v4

### Deprecated Utilities
| v3 Utility | v4 Replacement |
|------------|----------------|
| `bg-opacity-50` | `bg-black/50` |
| `text-opacity-75` | `text-blue-500/75` |
| `flex-grow` | `grow` |
| `flex-shrink-0` | `shrink-0` |

### Renamed Utilities (v3 → v4)
| v3 Utility | v4 Utility |
|------------|------------|
| `shadow-sm` | `shadow-xs` |
| `shadow` (base) | `shadow-sm` |
| `outline-none` | `outline-hidden` |
| `ring` | `ring-1` (default changed) |
| `rounded-sm` | `rounded-xs` |
| `rounded` | `rounded-sm` |
| `blur-sm` | `blur-xs` |
| `bg-gradient-to-r` | `bg-linear-to-r` |

### Default Value Changes
- Default border color changed from `gray-200` to `currentColor`
- Default ring color changed from `blue-500` to `currentColor`
- Default ring width changed from 3px to 1px

## XXI. Using Plugins

```css
/* Add the Typography plugin */
@import "tailwindcss";
@plugin "@tailwindcss/typography";

/* Use in HTML */
<article class="prose dark:prose-invert">
  <h1>My Article</h1>
  <p>This will be beautifully styled.</p>
</article>
```

## XXII. Best Practices

* **Mobile-first approach**: Start with mobile designs and add responsive variants for larger screens.
* **Consistent spacing**: Stick to the spacing scale to maintain rhythm.
* **Extract components**: For repeated patterns, use component abstraction in your framework.
* **Avoid conflicting utilities**: Don't add border-0 and border at the same time.
* **Accessibility**: Ensure sufficient color contrast and proper semantic HTML.
* **Performance**: Use container queries for deeply nested components.
* **Theme tokens**: Leverage CSS variables for maintainable design systems.

## XXIII. Resources

* **Official Docs**: [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
* **Playground**: [https://play.tailwindcss.com](https://play.tailwindcss.com)
* **UI Components**: [https://tailwindui.com](https://tailwindui.com)
* **Upgrade Guide**: [https://tailwindcss.com/docs/upgrade-guide](https://tailwindcss.com/docs/upgrade-guide)

---

This comprehensive reference guide covers all aspects of Tailwind CSS v4, from basic installation to advanced techniques. Use it to quickly implement clean, responsive interfaces and make the most of Tailwind's powerful utility-first approach to building modern web applications.
