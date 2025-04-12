/** @type {import('tailwindcss').Config} */
export default {
  // Change from 'class' to 'data-theme' for DaisyUI compatibility
  darkMode: ['class', '[data-theme="dark"]'],
  content: [
    './static/js/**/*.js',
    './static/**/*.html',
    './templates/**/*.html'
  ],
  theme: {
    extend: {
      zIndex: {
        '60': '60',
        '70': '70',
        '80': '80',
        '90': '90',
        '100': '100',
        '999': '999',
        'modal': '1000',
        'dropdown': '1010',
        'tooltip': '1020',
        'notification': '1030'
      },
      transitionProperty: {
        'transform': 'transform',
        'slide': 'transform, opacity'
      },
      spacing: {
        'card-padding': '1rem',
        'card-spacing': '1rem',
        'touch-min': '44px',
      },
      screens: {
        'xs': '320px',
        '3xl': '1920px',
        '4xl': '2560px',
      },
      boxShadow: {
        '2xs': '0 1px 2px -1px rgb(0 0 0 / 0.1)',
        xs: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        sm: '0 4px 6px -1px rgb(0 0 0 / 0.1)',
        card: '0 1px 3px 0 rgb(0 0 0 / 0.1)',
        'card-hover': '0 4px 6px -1px rgb(0 0 0 / 0.1)',
      },
      borderWidth: {
        card: '1px',
      },
      borderRadius: {
        xs: '0.125rem',
        sm: '0.25rem',
        md: '0.375rem',
        lg: '0.5rem',
        xl: '0.75rem',
        '2xl': '1rem',
        '3xl': '1.5rem',
        '4xl': '2rem',
        card: '0.5rem',
        'empty-state': '0.75rem',
      }
    },
  },
  // Add DaisyUI to plugins
  plugins: [
    require('daisyui')
  ],
  // Add DaisyUI configuration
  daisyui: {
    themes: [
      {
        light: {
          ...require("daisyui/src/theming/themes")["light"],
          "color-scheme": "light",
          "primary": "oklch(62.3% 0.214 259.815)",
          "secondary": "oklch(58.5% 0.233 277.117)"
        }
      },
      "dark"
    ],
    darkTheme: "dark",
    logs: false,
    base: true,
    styled: true,
    utils: true
  }
};
