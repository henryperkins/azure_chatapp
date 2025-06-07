export default {
  transform: { "^.+\\.js$": "babel-jest" },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json"],
  testMatch: [
    "**/tests/**/*.test.js",
    "**/static/js/__tests__/**/*.test.js"
  ],
  // Ignore Playwright E2E specs and patternChecker regression suite
  testPathIgnorePatterns: [
    "/tests/bootstrap-order\\.e2e\\.spec\\.js$",
    "/tests/patternChecker\\.xss\\.test\\.js$"
  ]
};
