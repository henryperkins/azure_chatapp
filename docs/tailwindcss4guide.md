## Tailwind CSS Comprehensive Reference Guide: Expanded Edition

This guide combines a quickstart to set up Tailwind CSS v4 with a deep reference covering core concepts, advanced techniques, and best practices. Whether you're new to Tailwind or upgrading/migrating, use this guide to quickly get started and as a lasting reference.

---

## I. Quickstart & Setup

### 1. Installation and Build Setup (Tailwind CSS v4 with PostCSS)
- **Install Tailwind CSS and PostCSS plugin:**
  ```bash
  npm install -D tailwindcss @tailwindcss/postcss postcss
  ```
- **Create or update your `postcss.config.js`:**
  ```js
  module.exports = {
    plugins: {
      "@tailwindcss/postcss": {}
    }
  }
  ```
- **Import Tailwind in your main CSS file (e.g., `input.css`):**
  ```css
  @import "tailwindcss";
  ```
- **Build your CSS:**
  - Using npm script:
    ```bash
    npm run build:css
    ```
  - Or via CLI:
    ```bash
    npx @tailwindcss/cli -i input.css -o output.css --watch
    ```
- **Link the generated CSS in your HTML file:**
  ```html
  <link href="/path/to/output.css" rel="stylesheet">
  ```
- **Start using Tailwind classes in your HTML markup.**

### 2. Migrating from v3 to v4
- **Configuration Changes:**
  - Replace deprecated directives (e.g., use `@import` instead of `@tailwind`).
  - Shift from JavaScript-based configuration to CSS-based configuration using `@theme`.
- **Utility Renames:**
  - Update renamed utilities (eg. `shadow-sm` → `shadow-xs`, `outline-none` → `outline-hidden`).
- **Content Detection:**
  - No need for an explicit `content` array—Tailwind auto-detects files.
  - Use `@source` if you need explicit control.
- **Upgrade Tool:**
  - Run:
    ```bash
    npx @tailwindcss/upgrade
    ```
  - Adjust custom settings to conform to the new CSS-first configuration.

---

## II. Core Concepts: Functions, Directives & Theme Customization

### 1. Functions and Directives

#### Directives
- **`@import`:**
  - **Purpose:** Imports external CSS files into your Tailwind project.
  - **Example:**
    ```css
    @import "tailwindcss";
    @import "./custom.css";
    ```
  - **Use Case:** Import Tailwind's core styles and any additional custom CSS.

- **`@theme`:**
  - **Purpose:** Defines custom design tokens (variables) for your project's theme.
  - **Syntax:**
    ```css
    @theme { --variable-name: value; }
    ```
  - **Example:**
    ```css
    @theme {
      --color-primary: #3b82f6;
      --font-family-base: 'Helvetica Neue', sans-serif;
    }
    ```
  - **Use Case:** Customize colors, fonts, spacing, breakpoints, and more.

- **`@source`:**
  - **Purpose:** Tells Tailwind which files to scan for utility classes.
  - **Syntax:**
    ```css
    @source "path/to/file.js";
    ```
  - **Example:**
    ```css
    @source "../components/**/*.jsx";
    ```
  - **Use Case:** Ensure Tailwind processes specific files (useful in complex projects).

- **`@utility`:**
  - **Purpose:** Creates custom utility classes with Tailwind’s variant support.
  - **Syntax:**
    ```css
    @utility custom-utility { property: value; }
    ```
  - **Example:**
    ```css
    @utility custom-border {
      border: 2px solid var(--color-primary);
    }
    ```
  - **Use Case:** Define project-specific utilities.

- **`@variant`:**
  - **Purpose:** Applies a Tailwind variant to custom CSS styles.
  - **Syntax:**
    ```css
    @variant variant-name { styles }
    ```
  - **Example:**
    ```css
    .button {
      background-color: white;
      @variant dark {
        background-color: black;
      }
    }
    ```
  - **Use Case:** Conditionally style elements based on variant (e.g., dark mode).

- **`@custom-variant`:**
  - **Purpose:** Defines custom variants for Tailwind.
  - **Syntax:**
    ```css
    @custom-variant custom-variant-name (&selector { @slot; })
    ```
  - **Example:**
    ```css
    @custom-variant custom-hover (&:hover:not(:focus))
    ```
  - **Use Case:** Create new variants for specific styling conditions.

- **`@apply`:**
  - **Purpose:** Inlines existing Tailwind utility classes into custom CSS.
  - **Syntax:**
    ```css
    @apply utility-classes;
    ```
  - **Example:**
    ```css
    .custom-button {
      @apply bg-blue-500 text-white px-4 py-2 rounded-lg;
    }
    ```
  - **Use Case:** Reuse utility classes in your custom styles.

- **`@reference`:**
  - **Purpose:** Imports a stylesheet for reference without including its styles.
  - **Syntax:**
    ```css
    @reference "path/to/stylesheet.css";
    ```
  - **Example:**
    ```css
    @reference "../../app.css";
    ```
  - **Use Case:** Access variables and utilities without duplicating styles.

#### Functions
- **`--alpha()`:**
  - **Purpose:** Adjusts the opacity of a color.
  - **Syntax:**
    ```css
    --alpha(color / opacity)
    ```
  - **Example:**
    ```css
    color: --alpha(var(--color-primary) / 50%);
    ```
  - **Use Case:** Create transparent versions of colors.

- **`--spacing()`:**
  - **Purpose:** Generates spacing values based on the theme's scale.
  - **Syntax:**
    ```css
    --spacing(value)
    ```
  - **Example:**
    ```css
    margin: --spacing(4);
    ```
  - **Use Case:** Maintain consistent spacing across your project.

### 2. Hover, Focus, and Other States (Expanded)

#### Pseudo-classes
- **Interaction States:**
  - `:hover` – Mouse hover
  - `:focus` – Keyboard focus
  - `:active` – Mouse click or touch
  - `:visited` – Visited links
  - `:focus-within` – Element or descendant has focus
  - `:focus-visible` – Keyboard focus (visible indicator)

- **Structural States:**
  - `:first-child`, `:last-child`, `:nth-child`, `:only-child` – Position within parent
  - `:first-of-type`, `:last-of-type`, `:nth-of-type`, `:only-of-type` – Position among siblings
  - `:empty` – No content

- **Form States:**
  - `:disabled`, `:enabled` – Form element state
  - `:checked`, `:indeterminate` – Checkbox/radio states
  - `:default`, `:optional`, `:required` – Form field requirements
  - `:valid`, `:invalid` – Form validation states
  - `:user-valid`, `:user-invalid` – User interaction with form validation

- **Other:**
  - `:target` – Element matching the URL fragment
  - `:details-content` – Content in a `<details>` element
  - `:autofill` – Browser autofill state
  - `:read-only` – Read-only form element

#### Pseudo-elements
- `::before`, `::after` – Generated content before/after an element
- `::placeholder` – Placeholder text in inputs
- `::selection` – Currently selected text
- `::first-line`, `::first-letter` – The first line/letter of a block
- `::backdrop` – Backdrop of a dialog
- `::marker` – List item marker
- `::file` – File input button

#### Media and Feature Queries
- **Responsive Breakpoints:** `sm`, `md`, `lg`, `xl`, `2xl` (configurable with `--breakpoint-*`)
- **Container Queries:** Use `@container` with variants like `@sm`, `@md`, etc. (customizable with `--container-*`)
- **Color Scheme:** `dark`, `light`
- **Motion Preferences:** `motion-safe`, `motion-reduce`
- **Contrast Preferences:** `contrast-more`, `contrast-less`
- **Forced Colors:** `forced-colors`
- **Pointer Devices:** `pointer-fine`, `pointer-coarse`, `any-pointer-fine`, `any-pointer-coarse`
- **Orientation:** `portrait`, `landscape`
- **Scripting:** `noscript`
- **Print:** `print`
- **Feature Detection:** `supports-[feature]`

#### Attribute Selectors
- **ARIA States:** `aria-*` (e.g., `aria-checked`, `aria-expanded`)
- **Data Attributes:** `data-*`
- **Directionality:** `rtl`, `ltr`
- **Open/Closed State:** `open`
- **Inert Elements:** `inert`

#### Child Selectors
- `*` – Direct children
- `**` – All descendants

### 3. Upgrade Guide (Getting Started) - Expanded
- **Key Changes from v3 to v4:**
  - **Configuration:** Shift from JavaScript config to CSS-based config using `@theme`.
  - **Theme Variables:** Now implemented as CSS variables.
  - **Content Detection:** Improved with automatic scanning and explicit control via `@source`.
  - **Variants:** Enhanced with the introduction of custom variants (`@custom-variant`).
  - **Functions:** New functions added, such as `--alpha()` and `--spacing()`.

### 4. Detecting Classes in Source Files - Expanded
- **Automatic Detection:**
  - Scans all files except those in `.gitignore`, binary files, CSS files, and package manager lock files.
  - Uses a character-based approach to identify potential utility class names.
- **Explicit Registration:**
  - Use `@source` to register specific files or directories.
  - Set a base path with `source()` when importing Tailwind.
- **Ignoring Paths:**
  - Use `@source not` to exclude certain paths.
- **Disabling Automatic Detection:**
  - Use `source(none)` to rely solely on explicit registration.
- **Safelisting:**
  - Use `@source inline()` to force the generation of specific utilities.
  - Safelist utilities with variants (e.g., `{hover:,}underline`) and ranges (e.g., `bg-red-{50,{100..900..100},950}`).
- **Excluding Classes:**
  - Use `@source not inline()` to prevent specific classes from being generated.

### 5. Adding Custom Styles - Expanded
- **Arbitrary Values:**
  - **Syntax:** `[property:value]`
  - **Examples:**
    - `text-[22px]`
    - `bg-[#bada55]`
    - `before:content-['Festivus']`
  - **CSS Variables:** Use `var(--variable-name)` or shorthand `(variable-name)`.
- **Arbitrary Properties:**
  - **Syntax:** `[property:value]`
  - **Example:** `[mask-type:luminance]`
- **Arbitrary Variants:**
  - **Syntax:** `[&selector:modifier]`
  - **Example:** `[&.is-dragging]:cursor-grabbing`
- **Whitespace Handling:**
  - Use underscores (`_`) in place of spaces; underscores are converted to spaces unless part of a URL or escaped.
- **Resolving Ambiguities:**
  - Use CSS data types to hint the underlying type, e.g., `text-(length:--my-var)`.

### 6. Theme Variables - Expanded
- **Customization:**
  Define your theme variables using `@theme`:
  ```css
  @theme {
    --color-primary: #3b82f6;
    --font-family-base: 'Helvetica Neue', sans-serif;
    --spacing: 0.25rem;
    --breakpoint-sm: 40rem;
  }
  ```
- **Usage:**
  Access variables in utilities:
  - `text-(--color-primary)`
  - `font-family-(--font-family-base)`
- **Default Theme:**
  Tailwind provides a comprehensive default theme with colors, fonts, spacing, breakpoints, etc.
- **Removing Defaults:**
  Reset default values if needed:
  ```css
  @theme {
    --breakpoint-2xl: initial;
  }
  ```

### 7. Responsive Design - Expanded
- **Mobile-First:**
  Unprefixed utilities apply to all screen sizes; prefixed utilities (e.g., `sm:text-center`) apply at and above their breakpoint.
- **Breakpoint Ranges:**
  Use `max-*` variants to target ranges (e.g., `md:max-xl:flex`).
- **Single Breakpoints:**
  Combine a breakpoint variant with the next `max-*` variant (e.g., `md:max-lg:flex`).
- **Custom Breakpoints:**
  Define additional breakpoints using `--breakpoint-*`:
  ```css
  @theme {
    --breakpoint-xs: 30rem;
    --breakpoint-3xl: 120rem;
  }
  ```
- **Arbitrary Values:**
  Use `min-[value]` and `max-[value]` for one-off breakpoints.
- **Container Queries:**
  - Mark an element as a container using `@container`.
  - Use container variants (e.g., `@sm`, `@md`) for container-based styling.
  - Define custom container sizes using `--container-*`.

### 8. Styling with Utility Classes - Expanded
- **Class Composition:**
  Combine multiple utilities for complex styles:
  ```html
  <div class="flex items-center justify-between p-4 bg-gray-100 rounded-lg">
  ```
- **Complex Selectors:**
  Use variants to handle complex conditions:
  ```html
  <button class="dark:lg:data-current:hover:bg-indigo-600">
  ```
- **Group Selectors:**
  Style elements based on a parent state:
  ```html
  <div class="group">
    <span class="group-hover:underline">Hover me</span>
  </div>
  ```
- **Arbitrary Variants:**
  Create custom selectors:
  ```html
  <div class="[&>[data-active]+span]:text-blue-600">
  ```
- **Inline Styles:**
  Use inline styles for dynamic values:
  ```html
  <div style="--custom-color: red;">
  ```

---

## III. Advanced Techniques & Best Practices

### 1. Managing Duplication - Expanded
- **Loops:**
  Render items dynamically to avoid repeated class lists:
  ```javascript
  {items.map(item => (
    <li class="py-2 px-4 bg-gray-100">{item.name}</li>
  ))}
  ```
- **Multi-Cursor Editing:**
  Use your code editor’s multi-cursor feature to edit multiple class lists simultaneously.
- **Components:**
  Create reusable components with encapsulated Tailwind styles:
  ```javascript
  const Button = ({ children }) => (
    <button class="bg-blue-500 text-white px-4 py-2 rounded-lg">
      {children}
    </button>
  );
  ```
- **Custom CSS:**
  Use additional custom CSS for complex styles or third-party integrations:
  ```css
  .custom-component {
    /* Custom styles */
  }
  ```

### 2. Managing Style Conflicts - Expanded
- **Avoid Conflicting Utilities:**
  Do not apply conflicting utilities to the same element. Use conditional rendering or component props to switch styles.
- **Important Modifier:**
  Force a utility to take precedence using an exclamation mark:
  ```html
  <div class="bg-teal-500 bg-red-500!">
  ```
- **Important Flag:**
  Mark all utilities as `!important` if necessary:
  ```css
  @import "tailwindcss" important;
  ```
- **Prefix Option:**
  Use a prefix to avoid clashes with other styles:
  ```css
  @import "tailwindcss" prefix(tw);
  ```

---

## IV. Reference Tables (Expanded)

### Pseudo-Class Variants (Expanded)
| Variant         | Description                 | CSS Equivalent  |
|-----------------|-----------------------------|-----------------|
| `:hover`        | Mouse hover                 | `&:hover`       |
| `:focus`        | Keyboard focus              | `&:focus`       |
| `:active`       | Mouse click or touch        | `&:active`      |
| `:visited`      | Link visited                | `&:visited`     |
| `:focus-within` | Element or descendant focus | `&:focus-within` |
| `:focus-visible`| Keyboard focus (visible)    | `&:focus-visible`|
| `:first-child`  | First child of parent       | `&:first-child` |
| ...             | ...                         | ...             |

### Pseudo-Element Variants (Expanded)
| Variant        | Description                     | CSS Equivalent  |
|----------------|---------------------------------|-----------------|
| `::before`     | Generated content before element | `&::before`     |
| `::after`      | Generated content after element  | `&::after`      |
| `::placeholder`| Placeholder text in inputs      | `&::placeholder` |
| ...            | ...                             | ...             |

### Media and Feature Query Variants (Expanded)
| Variant | Description                                   | CSS Equivalent                  |
|---------|-----------------------------------------------|---------------------------------|
| `sm`    | Styles at the `sm` breakpoint (≥ 40rem)       | `@media (min-width: 40rem)`      |
| `md`    | Styles at the `md` breakpoint (≥ 48rem)       | `@media (min-width: 48rem)`      |
| `dark`  | Styles applied in dark mode                   | `@media (prefers-color-scheme: dark)` |
| ...     | ...                                           | ...                             |

### Attribute Selector Variants (Expanded)
| Variant       | Description                                  | CSS Equivalent             |
|---------------|----------------------------------------------|----------------------------|
| `aria-checked`| Element with `aria-checked="true"`           | `&[aria-checked="true"]`    |
| `data-active` | Element with a `data-active` attribute       | `&[data-active]`            |
| ...           | ...                                          | ...                        |

---

## V. Best Practices (Expanded)

- **Mobile-First Approach:**
  Start with mobile styles and add breakpoints for larger screens. Use unprefixed utilities for mobile.
- **Class Composition:**
  Combine utilities to avoid repetitious code. Use arbitrary values only for one-off cases.
- **Components:**
  Create reusable components to maintain consistent styling.
- **Custom CSS:**
  Rely on custom CSS when Tailwind utilities are insufficient or for third-party integrations.
- **Performance:**
  Optimize by minimizing utility clutter and using purging tools to remove unused CSS.
- **Accessibility:**
  Use semantic HTML, ensure sufficient color contrast, and provide alternative text for images.

---

## VI. Resources (Expanded)

- **Official Documentation:** [https://tailwindcss.com/docs](https://tailwindcss.com/docs)
- **GitHub Repository:** [https://github.com/tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss)
- **Tailwind UI:** [https://tailwindui.com/](https://tailwindui.com/) (Pre-built UI components)
- **Tailwind Play:** [https://play.tailwindcss.com/](https://play.tailwindcss.com/) (Interactive sandbox)
- **Community Forum:** [https://tailwindcss.com/community](https://tailwindcss.com/community)

---

This expanded guide provides a comprehensive quickstart and reference for Tailwind CSS. It covers essential setup, core concepts, styling with utilities, responsive design techniques, advanced methods, and best practices to help you work efficiently with Tailwind CSS. For the latest updates and more detailed examples, consult the [official documentation](https://tailwindcss.com/docs).

Happy styling!
```
