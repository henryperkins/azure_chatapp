import daisyui from 'daisyui';

export default {
  /* Files Tailwind should scan for class-names ---------------------- */
  content: [
    './static/**/*.html',
    './static/js/**/*.{js,jsx,ts,tsx}',
    './static/css/**/*.css',
    './templates/**/*.{html,jinja}',
  ],

  theme: {
    extend: {
      colors: {
        primary             : 'rgb(var(--p)  / <alpha-value>)',
        'primary-content'   : 'rgb(var(--pc) / <alpha-value>)',
        secondary           : 'rgb(var(--s)  / <alpha-value>)',
        'secondary-content' : 'rgb(var(--sc) / <alpha-value>)',
        accent              : 'rgb(var(--a)  / <alpha-value>)',

        'base-100': 'rgb(var(--b1) / <alpha-value>)',
        'base-200': 'rgb(var(--b2) / <alpha-value>)',
        'base-300': 'rgb(var(--b3) / <alpha-value>)',

        success : 'rgb(var(--su) / <alpha-value>)',
        warning : 'rgb(var(--wa) / <alpha-value>)',
        error   : 'rgb(var(--er) / <alpha-value>)',
      },
    },
  },

  /* v4 guideline ‑ plugin list must be an ARRAY */
  plugins: [daisyui],
};
