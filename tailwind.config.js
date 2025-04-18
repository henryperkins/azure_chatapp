module.exports = {
  content: [
    "./static/html/**/*.html",
    "./static/js/**/*.js",
    "./templates/**/*.html"  // (if using server-side templates)
  ],
  theme: {
    extend: {}
  },
  plugins: [
    require("daisyui")
  ],
  daisyui: {
    themes: ["light", "dark"],
    logs: false
  }
};
