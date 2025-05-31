// Regression test: every XSS sink triggers rule 9 or passes clean (safe)
/* eslint-env jest, node */
const { execSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const fixtureDir = path.resolve('tests/fixtures/xss');
const script = path.resolve('scripts/patternChecker.cjs');

function run(file) {
  try {
    // Capture stdout; only interested in exit code for "safe" cases,
    // but for "unsafe" we also check for rule 6 (XSS guardrail) mention in output.
    // Use the --rule=6 flag to only check XSS rule
    const out = execSync(`node ${script} --rule=6 ${file}`, { encoding: 'utf8', stdio: 'pipe' });
    return { code: 0, stdout: out };
  } catch (err) {
    return {
      code: err.status || 1,
      stdout: err.stdout ? err.stdout.toString() : ''
    };
  }
}

describe('Rule 9 (XSS guardrail) regression suite', () => {
  const files = fs.readdirSync(fixtureDir).filter(f => f.endsWith('.js'));
  files.forEach(f => {
    const filePath = path.join(fixtureDir, f);
    if (f.includes('-unsafe')) {
      test(`${f} should FAIL (trigger rule 9)`, () => {
        const { code, stdout } = run(filePath);
        expect(code).toBe(1);
        expect(
          stdout.includes('Sanitize All User HTML') ||
          stdout.includes('Setting .innerHTML without') ||
          stdout.includes('insertAdjacentHTML() without') ||
          stdout.includes('setAttribute(\'src\', …) without')
        ).toBe(true);
      });
    } else {
      test(`${f} should PASS (safe)`, () => {
        const { code, stdout } = run(filePath);
        expect(code).toBe(0);
        expect(
          stdout.includes('Violation') || stdout.includes('dom--security-sanitized-inputs')
        ).toBe(false);
      });
    }
  });
});
