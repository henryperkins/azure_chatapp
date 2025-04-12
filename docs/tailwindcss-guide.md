# Combined Documentation

## **Functions and Directives - Core Concepts**
Tailwind CSS provides custom functions and directives to enhance your CSS workflow.

**Directives**:
- **@import**: Inline import CSS files, including Tailwind itself.
- **@theme**: Define custom design tokens (fonts, colors, breakpoints).
  ```css
  @theme {
    --font-display: "Satoshi", "sans-serif";
    --breakpoint-3xl: 120rem;
    --color-avocado-100: oklch(0.99 0 0);
  }
  ```
- **@source**: Explicitly specify source files for Tailwind to scan.
  ```css
  @source "../node_modules/@my-company/ui-lib";
  ```
- **@utility**: Add custom utilities with variant support.
  ```css
  @utility tab-4 { tab-size: 4; }
  ```
- **@variant**: Apply Tailwind variants to custom CSS.
  ```css
  .my-element {
    background: white;
    @variant dark { background: black; }
  }
  ```
- **@custom-variant**: Define custom variants.
  ```css
  @custom-variant theme-midnight (&:where([data-theme="midnight"] *));
  ```
- **@apply**: Inline utility classes into custom CSS.
  ```css
  .select2-dropdown { @apply rounded-b-lg shadow-md; }
  ```
- **@reference**: Import stylesheets for reference without duplication.
  ```vue
  <style>
    @reference "../../app.css";
    h1 { @apply text-2xl font-bold text-red-500; }
  </style>
  ```

**Functions**:
- **--alpha()**: Adjust color opacity.
  ```css
  color: --alpha(var(--color-lime-300) / 50%);
  ```
- **--spacing()**: Generate spacing values from theme.
  ```css
  margin: --spacing(4);
  ```

---

## **Detecting Classes in Source Files - Core Concepts**
Tailwind scans source files for utility classes and generates corresponding CSS.

**How Classes Are Detected**:
- Treats files as plain text, looks for tokens matching class patterns.
- Example:
  ```jsx
  <button className="bg-black text-white rounded-full px-2 py-1.5"></button>
  ```

**Dynamic Class Names**:
- Avoid constructing class names dynamically. Always use complete class names.
  ```html
  <!-- Incorrect -->
  <div class="text-{{ error ? 'red' : 'green' }}-600"></div>
  <!-- Correct -->
  <div class="{{ error ? 'text-red-600' : 'text-green-600' }}"></div>
  ```

**Which Files Are Scanned**:
- Scans all files except `.gitignore`, binary files, CSS files, and lock files.
- Explicitly register sources if needed:
  ```css
  @source "../node_modules/@acmecorp/ui-lib";
  ```

**Setting Base Path**:
- Use `source()` to set the base path for scanning.
  ```css
  @import "tailwindcss" source("../src");
  ```

**Ignoring Paths**:
- Ignore specific paths with `@source not`.
  ```css
  @source not "../src/components/legacy";
  ```

**Disabling Automatic Detection**:
- Disable automatic detection and register sources manually.
  ```css
  @import "tailwindcss" source(none);
  @source "../admin";
  ```

**Safelisting Utilities**:
- Force generation of specific utilities.
  ```css
  @source inline("underline");
  ```
- Safelist variants and ranges.
  ```css
  @source inline("{hover:,}bg-red-{50,{100..900..100},950}");
  ```
- Exclude classes.
  ```css
  @source not inline("{hover:,focus:,}bg-red-{50,{100..900..100},950}");
  ```

---

## **Adding Custom Styles - Core Concepts**
Tailwind is extensible for custom styles.

**Customizing Your Theme**:
- Use `@theme` to add custom design tokens.
  ```css
  @theme {
    --font-display: "Satoshi", "sans-serif";
    --breakpoint-3xl: 120rem;
  }
  ```

**Using Arbitrary Values**:
- Break constraints with arbitrary values.
  ```html
  <div class="top-[117px] lg:top-[344px]"></div>
  ```
- Use arbitrary properties and variants.
  ```html
  <div class="[mask-type:luminance] hover:[mask-type:alpha]"></div>
  ```

**Using Custom CSS**:
- Add base styles, component classes, and third-party overrides.
  ```css
  @layer base { h1 { font-size: var(--text-2xl); } }
  ```

**Adding Custom Utilities**:
- Define simple and complex utilities.
  ```css
  @utility content-auto { content-visibility: auto; }
  ```
- Create functional utilities.
  ```css
  @utility tab-* { tab-size: --value(--tab-size-*); }
  ```

**Adding Custom Variants**:
- Define custom variants.
  ```css
  @custom-variant theme-midnight {
    &:where([data-theme="midnight"] *) { @slot; }
  }
  ```

---

## **Theme Variables - Core Concepts**
Tailwind uses CSS variables for theme customization.

Example:
```css
@theme {
  --font-sans: ui-sans-serif, system-ui, sans-serif;
  --color-red-50: oklch(0.971 0.013 17.38);
}
```

---

## **Dark Mode - Core Concepts**
Tailwind supports dark mode with the `dark` variant.

Example:
```html
<div class="bg-white dark:bg-gray-800"></div>
```

**Toggling Dark Mode Manually**:
- Override `dark` variant with custom selector.
  ```css
  @custom-variant dark (&:where(.dark, .dark *));
  ```

**Using Data Attribute**:
- Activate dark mode via data attribute.
  ```css
  @custom-variant dark (&:where([data-theme=dark], [data-theme=dark] *));
  ```

---

## **Responsive Design - Core Concepts**
Tailwind supports responsive design with breakpoints and container queries.

**Overview**:
- Use breakpoint prefixes for responsive utilities.
  ```html
  <img class="w-16 md:w-32 lg:w-48" src="..." />
  ```

**Working Mobile-First**:
- Target mobile with unprefixed utilities.
  ```html
  <div class="text-center sm:text-left"></div>
  ```

**Custom Breakpoints**:
- Customize breakpoints with `--breakpoint-*`.
  ```css
  @theme { --breakpoint-xs: 30rem; }
  ```

**Container Queries**:
- Use `@container` for container-based styles.
  ```html
  <div class="@container">
    <div class="flex flex-col @md:flex-row"></div>
  </div>
  ```

**Using Arbitrary Values**:
- Use one-off breakpoints.
  ```html
  <div class="max-[600px]:bg-sky-300"></div>
  ```

---

## **Upgrade Guide - Getting Started**
Upgrade from v3 to v4 with these steps.

**Changes from v3**:
- **Browser Requirements**: Targets modern browsers (Safari 16.4+, Chrome 111+, Firefox 128+).
- **Removed Directives**: Use `@import` instead of `@tailwind` directives.
- **Renamed Utilities**: Updated names for consistency (`shadow-sm` → `shadow-xs`).
- **Space-Between Selector**: Changed for performance.
- **Default Border Color**: Now `currentColor`.
- **Preflight Changes**: Updated placeholder color, button cursor, and dialog margins.
- **Using a Prefix**: Prefixes now look like variants.
- **Custom Utilities**: Use `@utility` instead of `@layer`.
- **Variant Stacking Order**: Applies left to right.
- **Hover Styles on Mobile**: Updated `hover` variant.
- **Disabling Core Plugins**: No longer supported.
- **Theme Values in JavaScript**: Use CSS variables instead.

**Upgrading Manually**:
- Update PostCSS configuration.
- Use Vite plugin for better performance.
- Update Tailwind CLI commands.

**Using the Upgrade Tool**:
Run `npx @tailwindcss/upgrade` to automate most changes.

---
