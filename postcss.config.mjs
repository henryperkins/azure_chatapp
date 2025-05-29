// postcss.config.mjs
import tailwindcss   from '@tailwindcss/postcss';
import autoprefixer  from 'autoprefixer';

export default {
  plugins: [
    tailwindcss,        // ← Tailwind first (v4 guideline)
    autoprefixer,
  ],
};
