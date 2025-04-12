export default {
  plugins: {
    "@tailwindcss/postcss": {
      // Enable nesting plugin for nested CSS syntax
      nesting: true,
      // Keep autoprefixer enabled for vendor prefixes
      autoprefixer: true
    }
  }
}
