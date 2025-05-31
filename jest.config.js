export default {
  transform: { "^.+\\.js$": "babel-jest" },
  testEnvironment: "node",
  moduleFileExtensions: ["js", "json"],
  // Ignore Playwright E2E specs and patternChecker regression suite
  testPathIgnorePatterns: [
    "/tests/bootstrap-order\\.e2e\\.spec\\.js$",
    "/tests/patternChecker\\.xss\\.test\\.js$"
  ]
};
