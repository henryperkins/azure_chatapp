/**
 * Tailwind CSS configuration for DaisyUI-style CSS variable color mapping.
 * This enables Tailwind utilities like `ring-primary`, `border-base-300`, etc.
 */
const withOpacity = (cssVar) => ({ opacityValue }) =>
  opacityValue === undefined
    ? `rgb(var(${cssVar}) / 1)`
    : `rgb(var(${cssVar}) / ${opacityValue})`;

module.exports = {
  theme: {
    extend: {
      colors: {
        /* brand + UI palette ------------------------------------------- */
        primary            : withOpacity('--p'),
        'primary-content'  : withOpacity('--pc'),
        secondary          : withOpacity('--s'),
        'secondary-content': withOpacity('--sc'),
        accent             : withOpacity('--a'),

        /* neutral “base” greys ----------------------------------------- */
        'base-100': withOpacity('--b1'),
        'base-200': withOpacity('--b2'),
        'base-300': withOpacity('--b3'),

        /* semantic states ---------------------------------------------- */
        success : withOpacity('--su'),
        warning : withOpacity('--wa'),
        error   : withOpacity('--er'),
      },
    },
  },
  // ...add your content, plugins, etc. as needed
};
