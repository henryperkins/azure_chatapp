module.exports = {
  transform: { "^.+\\.js$": "babel-jest" },
  testEnvironment: "jsdom",
  moduleFileExtensions: ["js", "json"],
  testMatch: [
    "**/tests/**/*.test.js",
    "**/static/js/__tests__/**/*.test.js"
  ],
  // Ignore Playwright E2E specs and patternChecker regression suite
  testPathIgnorePatterns: [
    "/tests/bootstrap-order\\.e2e\\.spec\\.js$",
    "/tests/patternChecker\\.xss\\.test\\.js$"
  ],
  // Use a local cache directory to avoid permission issues in sandboxed /tmp
  cacheDirectory: "./.jest_cache",
  setupFiles: ["<rootDir>/jest.setup.js"]
};
