const postcssImport = require('postcss-import');
const postcssNesting = require('postcss-nesting');
const tailwindcss = require('@tailwindcss/postcss');
const autoprefixer = require('autoprefixer');
const daisyui = require('daisyui');

module.exports = {
  plugins: [
    postcssImport(),
    postcssNesting(),
    tailwindcss(),
    autoprefixer(),
  ]
}