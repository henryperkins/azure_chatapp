import daisyui from 'daisyui';

const withOpacity = (cssVar) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `rgb(var(${cssVar}) / 1)`
    : `rgb(var(${cssVar}) / ${opacityValue})`;

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
        primary            : withOpacity('--p'),
        'primary-content'  : withOpacity('--pc'),
        secondary          : withOpacity('--s'),
        'secondary-content': withOpacity('--sc'),
        accent             : withOpacity('--a'),

        'base-100': withOpacity('--b1'),
        'base-200': withOpacity('--b2'),
        'base-300': withOpacity('--b3'),

        success : withOpacity('--su'),
        warning : withOpacity('--wa'),
        error   : withOpacity('--er'),
      },
    },
  },

  /* v4 guideline ‑ plugin list must be an ARRAY */
  plugins: [daisyui],
};
