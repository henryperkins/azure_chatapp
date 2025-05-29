import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  // Content paths needed for DaisyUI component scanning
  content: [
    './static/**/*.html',
    './static/js/**/*.{js,jsx,ts,tsx}',
    './static/css/**/*.css',
    './templates/**/*.{html,jinja}',
  ],
  // Theme tokens moved to CSS with @theme directive
  plugins: [daisyui],
};
