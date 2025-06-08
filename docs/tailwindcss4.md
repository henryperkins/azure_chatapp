# Tailwind CSS v4 Quick Start & Reference (PostCSS + JavaScript)

## Quick Start: Tailwind CSS v4 with PostCSS (No Framework)

1. **Install Tailwind CSS and PostCSS**: Run npm to install Tailwind v4 and the PostCSS plugin. For example:

    ```bash
    npm install -D tailwindcss @tailwindcss/postcss postcss
    ```

    This installs the Tailwind CSS framework, the Tailwind PostCSS plugin, and PostCSS itself ([Installing Tailwind CSS with PostCSS - Tailwind CSS](https://tailwindcss.com/docs/installation/using-postcss#:~:text=)). (Tailwind v4 has built-in support for CSS imports and autoprefixing via Lightning CSS, so you **do not** need `postcss-import` or `autoprefixer` plugins ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=In%20v3%2C%20the%20,package)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Additionally%2C%20in%20v4%20imports%20and,they%20are%20in%20your%20project)).)

2. **Add Tailwind to PostCSS Config**: Create or update your `postcss.config.js` (or `.cjs`/`.mjs`) to use the Tailwind plugin. For example:

    ```js
    // postcss.config.js
    module.exports = {
      plugins: {
        "@tailwindcss/postcss": {},  // Tailwind CSS v4 PostCSS plugin
      }
    }
    ```

    This replaces the older `tailwindcss` plugin entry used in v3. Ensure any `postcss-import` or `autoprefixer` are removed, as Tailwind v4 handles imports and vendor prefixes internally ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=In%20v3%2C%20the%20,package)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Additionally%2C%20in%20v4%20imports%20and,they%20are%20in%20your%20project)).

3. **Import Tailwind in CSS**: In your main CSS file (e.g. `input.css`), import Tailwind’s styles:

    ```css
    @import "tailwindcss";
    ```

    This single import replaces the three `@tailwind base;`, `@tailwind components;`, `@tailwind utilities;`directives from v3 ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Removed%20%40tailwind%20directives)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%40tailwind%20base%3B)). It pulls in Tailwind’s base, components, and utilities layers automatically.

4. **Build the CSS**: Run PostCSS to compile your CSS with Tailwind. For example, add an npm script to your `package.json`:

    ```json
    "build:css": "postcss input.css -o output.css"
    ```

    Then run `npm run build:css` (add `--watch` for development). This will scan your HTML/JS files for classes and generate `output.css` with Tailwind styles. _Alternatively_, you can use Tailwind’s CLI (now a separate package in v4): `npx @tailwindcss/cli -i input.css -o output.css --watch` ([Getting started with Tailwind v4 - DEV Community](https://dev.to/plainsailing/getting-started-with-tailwind-v4-3cip#:~:text=7)).

5. **Include CSS in HTML**: Link the generated CSS in your HTML head:

    ```html
    <link href="/path/to/output.css" rel="stylesheet">
    ```

    Now you can use Tailwind utility classes in your HTML. For example:

    ```html
    <h1 class="text-3xl font-bold underline">Hello, world!</h1>
    ```

    This will produce a large, bold, underlined heading ([Installing Tailwind CSS with PostCSS - Tailwind CSS](https://tailwindcss.com/docs/installation/using-postcss#:~:text=,your%20HTML)) ([Installing Tailwind CSS with PostCSS - Tailwind CSS](https://tailwindcss.com/docs/installation/using-postcss#:~:text=%3Cmeta%20name%3D%22viewport%22%20content%3D%22width%3Ddevice)). (Make sure your output CSS is updated whenever you change your HTML classes, or run the watcher for live reload.)


## Tailwind CSS v4 Core Concepts: Quick Reference

### Utility-First Classes

Tailwind CSS is a utility-first framework – you style elements by mixing tiny single-purpose classes in your markup ([Styling with utility classes - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/styling-with-utility-classes#:~:text=Overview)). Each class corresponds to a CSS declaration (e.g. `text-center` sets `text-align: center`). This approach allows rapid building of designs without writing custom CSS. Common examples include: `p-4` (padding), `mt-8` (margin-top), `text-xl` (font-size), `bg-blue-500` (background color), etc. Tailwind v4 continues this philosophy and introduces **dynamic utility values**, so many classes accept arbitrary numbers or values without needing configuration. For example, you can now use spacing utilities like `mt-8`, `w-17`, or `pr-29` directly – Tailwind will multiply these by a base spacing unit automatically ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=Even%20spacing%20utilities%20like%20%60px,value%20out%20of%20the%20box)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=.mt)). For any value not covered by a predefined class, you can still use _arbitrary values_ by wrapping in square brackets (e.g. `bg-[#1e90ff]` for a custom color).

### Configuration Structure (Theme & Settings)

Tailwind’s configuration defines your design system (colors, spacing scale, breakpoints, etc.) and optional features. In **Tailwind v3**, this was done in a JavaScript file `tailwind.config.js` with keys like `theme`, `darkMode`, `plugins`, and a `content` array for purge. In **Tailwind v4**, configuration is now **CSS-first** – you can define everything in your CSS file via special at-rules, eliminating the need for a JS config in many cases ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=CSS)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=)). Key config concepts:

- **Content (Purge)**: In v3 you listed template paths under `content: [...]` to purge unused CSS. In v4, this is automatic – Tailwind scans all files in your project by default, ignoring `node_modules` and other irrelevant files (even reading your `.gitignore` for hints) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=You%20know%20how%20you%20always,to%20configure%20it%20at%20all)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=For%20example%2C%20we%20automatically%20ignore,that%20aren%E2%80%99t%20under%20version%20control)). No `content` config is required, though you can manually include additional sources with the `@source "<path>"` directive in CSS if needed ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=And%20if%20you%20ever%20need,right%20in%20your%20CSS%20file)).

- **Theme Customization**: In v3, you extended the default theme via `module.exports = { theme: { extend: { colors: {...}, spacing: {...}, screens: {...} } } }`. In v4, you use the `@theme { ... }` at-rule in your CSS to define theme variables. For example:

    ```css
    @import "tailwindcss";
    @theme {
      --color-brand: #b4d455;
      --font-display: "Inter", sans-serif;
      --breakpoint-3xl: 1920px;
      /* ... */
    }
    ```

    This defines a custom color `brand`, a font family, and adds a `3xl` breakpoint. Tailwind will generate classes like `bg-brand` or `text-brand` for the new color, use the font for `font-display`, and you can use `3xl:` as a responsive prefix. All theme values become CSS variables (e.g. `--color-brand`) so you can also use them directly in CSS or inline styles ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=Tailwind%20CSS%20v4,time%20using%20just%20CSS)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=%3Aroot%20)). _(You can still use a JS config file if desired, but it is no longer auto-loaded; you must import it with `@config "tailwind.config.js";` in your CSS ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Using%20a%20JavaScript%20config%20file)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%40config%20)). Also note some old config options like `corePlugins`, `safelist`, and `separator` are not supported in v4 ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%40config%20)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=The%20,0)).)_

- **Dark Mode Strategy**: Previously configured via `darkMode: 'media'` or `'class'` in `tailwind.config.js`. In v4, if using CSS-first config, the default is the media strategy (uses `prefers-color-scheme: dark`) ([Dark mode - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/dark-mode#:~:text=)). You can override it to a class or attribute-based strategy by defining a custom dark variant. For example, you could use `@custom-variant dark "[data-theme='dark'] &";` to use a data attribute instead of the media query (or simply continue using the default and add a `.dark` class on `<html>` to manually toggle, as in v3). By default, utilities with `dark:` prefix will apply when OS dark mode is on ([Dark mode - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/dark-mode#:~:text=)), but you can still opt into class-driven dark mode if needed (see **Dark Mode** below).


### Responsive Design

Tailwind is mobile-first. Unprefixed utilities apply to **all screen sizes** by default, and prefixing with a breakpoint makes them apply at _min-width_ of that size. The default breakpoints in Tailwind v4 are:

|Prefix|Min-Width|Example Utility|
|---|---|---|
|`sm:`|640px (40rem) ([Responsive design - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/responsive-design#:~:text=%60sm%20%6040rem%20%28640px%29%60%40media%20%28width%20,...))|`.sm:text-left` – apply left-aligned text on ≥640px screens|
|`md:`|768px (48rem) ([Responsive design - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/responsive-design#:~:text=%60sm%20%6040rem%20%28640px%29%60%40media%20%28width%20,...))|`.md:p-8` – apply padding on medium (tablet) and up|
|`lg:`|1024px (64rem) ([Responsive design - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/responsive-design#:~:text=%60sm%20%6040rem%20%28640px%29%60%40media%20%28width%20,...))|`.lg:grid-cols-3` – 3 columns on large (desktop) screens|
|`xl:`|1280px (80rem) ([Responsive design - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/responsive-design#:~:text=%60sm%20%6040rem%20%28640px%29%60%40media%20%28width%20,...))|`.xl:text-4xl` – larger text on extra-large screens|
|`2xl:`|1536px (96rem) ([Responsive design - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/responsive-design#:~:text=%60sm%20%6040rem%20%28640px%29%60%40media%20%28width%20,...))|`.2xl:max-w-6xl` – max-width on wide screens|

These act as **min-width media queries**. For example, `class="text-center sm:text-left"` centers text on mobile, and left-aligns it once the viewport is ≥640px ([Responsive design - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/responsive-design#:~:text=%3C%21,not%20on%20small%20screens)). Tailwind v4 also introduces **Container Queries** as a first-class feature. By adding an `@container` rule to a parent element (e.g. `<div class="@container">`), you can use similar prefixes that respond to the **container's width** instead of the viewport ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=Container%20queries)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=)). Container query prefixes use `@sm:` for container >= _sm_ size, and `@max-<breakpoint>:` for container <= that size. For example:

```html
<div class="@container">
  <div class="grid grid-cols-3 @max-md:grid-cols-1">...</div>
</div>
```

This will show 3 columns by default, but switch to 1 column when the container’s width is at most the `md` breakpoint ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=)). (You no longer need the `@tailwindcss/container-queries` plugin – it’s built-in.)

### Dark Mode

Tailwind’s dark mode support lets you style elements differently when a dark theme is active. You use the `dark:` **variant**to prefix utilities that should apply in dark mode. For example:

```html
<div class="bg-white text-black dark:bg-gray-800 dark:text-white">...</div>
```

This will use a white background with black text normally (light mode), but switch to a gray-800 background with white text if dark mode is enabled ([Dark mode - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/dark-mode#:~:text=%3Cdiv%20class%3D%22bg,900%2F5)) ([Dark mode - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/dark-mode#:~:text=)).

By default, Tailwind v4 uses the **media strategy**, meaning it will automatically apply `dark:*` classes if the user’s OS prefers dark mode ([Dark mode - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/dark-mode#:~:text=)). If you want to toggle dark mode manually (e.g. with a button), you can switch to a **class strategy**. In v3, you’d set `darkMode: 'class'` in the config and add a `class="dark"`on a parent (like `<html>`). In v4’s CSS-first approach, you achieve the same by overriding the dark variant. One simple method is to add a `class="dark"` on the `<html>` element (this still works – it overrides the media query) ([Dark Mode - Tailwind CSS](https://v2.tailwindcss.com/docs/dark-mode#:~:text=Now%20instead%20of%20%60dark%3A,earlier%20in%20the%20HTML%20tree)) ([Dark Mode - Tailwind CSS](https://v2.tailwindcss.com/docs/dark-mode#:~:text=%3C%21,%3C%2Fdiv%3E%20%3C%2Fbody%3E%20%3C%2Fhtml)). Alternatively, you can define a custom variant to use a different selector (for example, using a data attribute or specific class). The key idea: **use the `dark:` prefix** on utilities, and ensure your site has either the system dark mode or a custom way to add the `dark` class so those styles take effect.

### Plugins & Customization

Tailwind’s functionality can be extended with official or community plugins, as well as custom utilities/variants:

- **Official Plugins**: Tailwind offers plugins for common needs like **Forms**, **Typography**, and **Line Clamp**. In Tailwind v3, you installed these and added them in the `plugins` array of your config (`require('@tailwindcss/typography')`, etc.). In v4, with CSS-first config, you load plugins via the `@plugin`directive in your CSS. For example, to include the Typography plugin:

    ```css
    @import "tailwindcss";
    @plugin "@tailwindcss/typography";
    ```

    This will include the plugin’s utilities (e.g. prose classes for rich text) ([Functions and directives - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/functions-and-directives#:~:text=Use%20the%20,based%20plugin)) ([Functions and directives - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/functions-and-directives#:~:text=%40plugin%20)). You can specify a package name or a local plugin file with `@plugin "<path-or-package>"`. _(You can still use the old method if using a JS config via `@config`.)_

- **Custom Utilities & Components**: Tailwind allows adding custom CSS that plays nicely with its variants. Use the `@utility` directive to define new utility classes that support prefixes like responsive or hover ([Functions and directives - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/functions-and-directives#:~:text=%40utility)). For example:

    ```css
    @utility no-scrollbar {
      /* hide scrollbars */
      scrollbar-width: none;
      -ms-overflow-style: none;
    }
    @utility no-scrollbar::-webkit-scrollbar {
      display: none;
    }
    ```

    Now you can use `class="no-scrollbar overflow-auto"` and it will work on all breakpoints, or add `sm:no-scrollbar` to apply it responsively. Similarly, `@variant` can create custom variants (though most state variants like `hover:`, `focus:` are pre-defined) ([Functions and directives - Core concepts - Tailwind CSS](https://tailwindcss.com/docs/functions-and-directives#:~:text=%40variant%20dark%20)). You can also still use `@layer base`, `@layer components`, or `@apply` to inject custom styles or compose utilities if needed, just like v3 – Tailwind v4 retains these features for customization.


## Migrating from Tailwind CSS v3 to v4

Tailwind CSS v4 brings huge improvements (performance, new features) while maintaining _mostly_ backwards compatibility. However, there are important breaking changes and deprecations to address when upgrading from v3 ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=It%27s%20also%20a%20good%20idea,the%20upgrade%20tool%20doesn%27t%20catch)). Below is a summary of what to update:

### Removed and Deprecated Utilities

Tailwind v4 removes all utilities that were previously deprecated (and hidden in docs). Replace these with their modern equivalents:

|**Deprecated v3 Utility**|**Replacement in v4**|
|---|---|
|`bg-opacity-{N}`|Use color opacity via slash syntax, e.g. `bg-black/50` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Deprecated%20Replacement%20%60bg,grow))|
|`text-opacity-{N}`|Use slash opacity, e.g. `text-black/50` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Deprecated%20Replacement%20%60bg,grow))|
|`border-opacity-{N}`|Use slash opacity, e.g. `border-black/50` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60bg,ellipsis))|
|`divide-opacity-{N}`|Use slash opacity, e.g. `divide-black/50` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60text,black%2F50))|
|`ring-opacity-{N}`|Use slash opacity, e.g. `ring-black/50` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60border,black%2F50))|
|`placeholder-opacity-{N}`|Use slash opacity, e.g. `placeholder-black/50` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60divide,black%2F50))|
|`flex-shrink-0` / `flex-shrink`|Use the new shorthand `shrink-0` / `shrink` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60ring,grow))|
|`flex-grow-0` / `flex-grow`|Use the new shorthand `grow-0` / `grow` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60ring,grow))|
|`overflow-ellipsis`|Renamed to `text-ellipsis` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60flex))|
|`decoration-slice`|Renamed to `box-decoration-slice` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60flex,slice))|
|`decoration-clone`|Renamed to `box-decoration-clone` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60overflow,clone))|

If you have any of these older classes in your markup, update them to the replacement classes. Most involve using the new opacity modifiers (Tailwind’s `{color}/{opacity}` syntax) or the newer utility names.

### Renamed Utility Classes

Several utility classes have been **renamed for consistency** in v4. The old names might still work (in most cases the “bare” versions are aliased for backward compat), but they map to different values, so you should update them for accuracy ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=,blur%20scales)):

|**v3 Class**|**v4 Class (rename)**|
|---|---|
|`shadow-sm`|`shadow-xs` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=v3%20v4%20%60shadow,xs)) (small shadow is now `xs`)|
|`shadow` (base)|`shadow-sm` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=v3%20v4%20%60shadow,sm)) (the default shadow now uses the `sm`name)|
|`drop-shadow-sm`|`drop-shadow-xs` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60shadow,xs))|
|`drop-shadow`|`drop-shadow-sm` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60shadow%20%60%60shadow,sm))|
|`blur-sm`|`blur-xs` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60drop,sm))|
|`blur` (base)|`blur-sm` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60drop,xs))|
|`backdrop-blur-sm`|`backdrop-blur-xs` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60blur,sm))|
|`backdrop-blur`|`backdrop-blur-sm` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60blur%20%60%60blur,xs))|
|`rounded-sm`|`rounded-xs` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60backdrop,xs))|
|`rounded` (base)|`rounded-sm` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%60backdrop,sm))|

Additionally, the **outline** and **ring** utilities have changed:

- **`outline-none`** (v3) is now called **`outline-hidden`** in v4 ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=The%20%60outline,colors%20mode%20for%20accessibility%20reasons)). This utility hides focus outlines (without disabling them in high-contrast mode). In v4, a new `outline-none` utility has been introduced that truly sets `outline: none` (which may be less accessible) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=The%20%60outline,colors%20mode%20for%20accessibility%20reasons)). If you used `outline-none` in v3 (for removing default focus styles), update those to `outline-hidden` to maintain the same behavior ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=HTML)).

- The unprefixed **`ring`** utility (v3) used to create a 3px ring. In v4, `ring` by itself now produces a 1px ring (to match border/outline defaults) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=)). To get the old 3px ring, use **`ring-3`**. For example, replace `<div class="ring ...">` with `<div class="ring-3 ...">` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=In%20v3%2C%20the%20,consistent%20with%20borders%20and%20outlines)). Also note the **default ring color** changed from blue (`ring-blue-500`) to `currentColor` in v4 ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Default%20ring%20width%20and%20color)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%3C%21)). So if you relied on the default, you should explicitly add the old color class (e.g. `ring-3 ring-blue-500`) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%3C%21)) for the same appearance, or define a custom theme variable to globally set ring color.


### Configuration & Build Changes

- **Tailwind Config File**: Tailwind CSS v4 no longer automatically reads `tailwind.config.js`. If you upgrade and keep this file, Tailwind will _ignore it unless you explicitly import it_. The new recommended approach is to use the CSS-based config (`@theme`, etc.). However, you can still use your JS config by adding an import at the top of your CSS:

    ```css
    @config "tailwind.config.js";
    @import "tailwindcss";
    ```

    This will load your config values into Tailwind ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Using%20a%20JavaScript%20config%20file)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%40config%20)). Be aware that some config options were removed: **`corePlugins`**, **`safelist`**, and **`separator`** keys are not supported in v4 ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%40config%20)). If you used these, you’ll need to adjust (for corePlugins, you can use `@layer` or custom CSS to disable features; safelist is less needed due to automatic content detection; separator for variants is fixed to `:` now). Also, the `darkMode` setting in config is effectively superseded by the default media strategy (see Dark Mode above for how to override if needed).

- **Content Scanning**: Remove the `content` array from your config (if present) or know that it’s ignored. Tailwind v4 auto-detects templates in your project ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=You%20know%20how%20you%20always,to%20configure%20it%20at%20all)). By default it scans all HTML, JS/TS, JSX/TSX, PHP, etc., except those in `node_modules` or other ignored folders. If you have unusual file types (e.g. `.blade.php` or others), you can include them via `@source` directives ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=And%20if%20you%20ever%20need,right%20in%20your%20CSS%20file)). This greatly simplifies setup – no more forgetting to update the content paths.

- **Build Tooling**: If you were using the Tailwind CLI in v3 (via `npx tailwindcss`), note that in v4 the CLI has moved to a separate package. Update your build scripts to use **`@tailwindcss/cli`**. For example:

    ```bash
    npx @tailwindcss/cli -i src/input.css -o dist/output.css --watch
    ```

    The PostCSS plugin is also separate (`@tailwindcss/postcss` as installed above). If using a bundler (Webpack, etc.) with PostCSS, ensure you switch to the new plugin. If using **Vite**, consider using the new first-party Vite plugin (`@tailwindcss/vite`) for better performance ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Using%20Vite)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=import%20tailwindcss%20from%20)).


### Other Notable Breaking Changes

- **Default Border Color**: In v3, border (and divide) utilities defaulted to a light gray (`gray-200`). In v4, the default border color is now `currentColor` (inheriting the element’s text color) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Default%20border%20color)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=We%27ve%20changed%20the%20width%20of,utilities)). This makes borders less opinionated. If you relied on the old default, add an explicit class like `border-gray-200` to your elements ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=In%20v3%2C%20the%20%60border,opinionated%20and%20match%20browser%20defaults)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=To%20update%20your%20project%20for,3)). To globally revert to the old behavior, you could add a base layer CSS rule setting `border-color` to `var(--color-gray-200)` for all elements ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Alternatively%2C%20add%20these%20base%20styles,to%20preserve%20the%20v3%20behavior)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%3A%3Aafter%2C)).

- **Spacing Utilities Selector**: The implementation of the `space-x-*` and `space-y-*` utilities has changed for better performance. Instead of using the sibling selector with `:not([hidden]) ~ :not([hidden])`, v4 uses `:not(:last-child)` for `space-y` and similar for `space-x` ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=We%27ve%20changed%20the%20selector%20used,performance%20issues%20on%20large%20pages)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=.space)). This could slightly affect layouts in edge cases (e.g. if you had additional margins on the last child or used them on inline elements). If you encounter issues, consider switching to using Flexbox/Grid with `gap-x-*`/`gap-y-*` which is more reliable ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=If%20this%20change%20causes%20any,instead)).

- **Gradient Color Stops**: Tailwind v4 fixes how variant prefixes interact with gradients. In v3, adding a dark-mode override for a gradient’s start color would unintentionally reset the end color to default (transparent) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Using%20variants%20with%20gradients)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=)). In v4, gradient color stops are preserved correctly ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=In%20v4%2C%20these%20values%20are,other%20utilities%20in%20Tailwind%20work)). As a result, if you _intended_ to remove a middle color in a gradient on a variant, you now should explicitly use `via-none` to cancel it ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=In%20v4%2C%20these%20values%20are,other%20utilities%20in%20Tailwind%20work)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=This%20means%20you%20may%20need,gradient%20in%20a%20specific%20state)). This is only relevant if you manipulate multi-color gradients with variants.

- **Container Class & Plugin**: The old `.container` utility in v3 had config options like `center: true` or custom padding. Tailwind v4’s new engine does not support these options – by default, `.container` is a fixed-width element at each breakpoint (as before), but it won’t auto-center or add side padding. To achieve centering or padding, you can manually extend it with CSS. For example:

    ```css
    @utility container {
      margin-inline: auto;    /* center horizontally */
      padding-inline: 2rem;   /* custom horizontal padding */
    }
    ```

    ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Container%20configuration)) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=%40utility%20container%20))This will apply to the container class at all sizes. Also, if you previously used the container-queries plugin, note that it is **no longer needed** – container queries are built into core (use `@container` as described in Responsive Design above) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=Container%20queries)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=)).

- **Performance & Engine Changes**: Tailwind v4 is rebuilt on a new Rust-based engine (“Oxide”). While this doesn’t require any code changes, you might notice dramatically faster build times and a slightly different build process. The new engine uses Lightning CSS under the hood ([Tailwind CSS 4.0: Everything you need to know in one place](https://daily.dev/blog/tailwind-css-40-everything-you-need-to-know-in-one-place#:~:text=,CSS%20over%20JavaScript%20for%20configurations)), so it automatically handles CSS nesting, autoprefixing, and imports. This means you should remove any redundant PostCSS plugins (as mentioned) and be aware that Tailwind v4 targets only modern browsers (Safari 16.4+, Chrome 111+, Firefox 128+) ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=Browser%20requirements)). If you need to support older browsers, you might have to stick to v3 or wait for a compatibility mode.


**Migration Tip:** The Tailwind team provides an official **upgrade tool** ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=Start%20using%20Tailwind%20CSS%20v4,the%20browser%20on%20Tailwind%20Play)) that can automate many of these changes (class renames, etc.). It’s a good idea to run it and then manually verify the above points. Also review the [Tailwind v4 Upgrade Guide](https://tailwindcss.com/docs/upgrade-guide) for any edge-case changes specific to your project ([Upgrade guide - Getting started - Tailwind CSS](https://tailwindcss.com/docs/upgrade-guide#:~:text=It%27s%20also%20a%20good%20idea,the%20upgrade%20tool%20doesn%27t%20catch)). Once migrated, you can fully enjoy Tailwind CSS v4’s new features (like more vivid colors with the Oklch color space, built-in container queries, 3D transforms, etc. ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=%2A%20New%20high,maximum%20performance%20and%20minimum%20configuration)) ([Tailwind CSS v4.0 - Tailwind CSS](https://tailwindcss.com/blog/tailwindcss-v4#:~:text=takes%20full%20advantage%20of%20modern,without%20the%20need%20for%20JavaScript))) along with its improved build performance.
