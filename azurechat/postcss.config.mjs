// postcss.config.mjs
export default {
  plugins: {
    "@tailwindcss/postcss": {},   // Tailwind CSS v4’s PostCSS integration :contentReference[oaicite:1]{index=1}
    "autoprefixer": {}            // Autoprefixer, still supported for wider browser coverage :contentReference[oaicite:2]{index=2}
  }
};
