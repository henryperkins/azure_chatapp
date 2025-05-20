# 🔍 Linting Workflow

Follow **this exact sequence** after any task that introduces significant code changes.
The goal is to merge / deploy **only code that is completely lint-clean**.

---

## 1&nbsp;· Prerequisites

| Stack | Version | Install Guide |
|-------|---------|---------------|
| **Node.js** | ≥ 18.12.0 | https://nodejs.org |
| **npm** (or **pnpm**) | ≥ 9 / 10 | `corepack enable && corepack prepare pnpm@latest --activate` |
| **Python** | ≥ 3.10 | https://python.org/downloads |

Create / activate your virtual-environment before continuing.

```bash
python -m venv .venv
source .venv/bin/activate        # Linux / macOS
# .venv\Scripts\activate         # Windows PowerShell
```

---

## 2&nbsp;· One-Time Dependency Installation

### JavaScript / TypeScript / CSS

```bash
pnpm install           # preferred (faster, reproducible)
# npm ci               # fallback if pnpm unavailable
```

### Python

```bash
pip install -r requirements.txt        # project runtime deps
pip install flake8 pylint              # lint toolchain
```

> **TIP :** run these commands whenever `package.json`, `requirements.txt`, or the CI config changes.

---

## 3&nbsp;· Full-Project Lint Pass

### JavaScript / TypeScript (ESLint rules live in [.eslintrc.js](./.eslintrc.js))

Run:

```bash
pnpm run lint             # static/js/**/*.js
```

Enable auto-fixable rules (idempotent):

```bash
pnpm run lint -- --fix
```

### CSS (Stylelint, PostCSS syntax)

```bash
pnpm run lint:css          # checks ./static/css/*.css
pnpm run lint:css -- --fix # auto-fix where possible
```

### Python

```bash
flake8 .                                # style errors & complexity
pylint $(git ls-files '*.py')           # code-quality & bug patterns
```

---

## 4&nbsp;· Interpreting & Fixing Lint Errors

| Tool | What to look for | Common Fix Guides |
|------|------------------|-------------------|
| **ESLint** | guardrail violations, unused vars, import/order | `eslint.org/docs/latest/rules` |
| **Stylelint** | unsupported CSS, unknown props, tailwind misuse | `stylelint.io/user-guide/rules` |
| **Flake8** | PEP-8 spacing, complexity > 15 | `pycodestyle`, `mccabe` docs |
| **Pylint** | undefined-name, duplicate-code, perf smells | `pylint.pycqa.org` |

1. Prefer **auto-fix** flags first (`--fix`).
2. For remaining issues, edit the offending files manually.
3. Never disable rules unless business-critical—discuss with maintainers.

---

## 5&nbsp;· Re-Run Until Clean

Repeat section 3 after every set of fixes:

```bash
# repeat until all commands exit with code 0
```

Lint output **must** show _0 errors, 0 warnings_.
CI will reject non-clean pushes; running locally avoids red pipelines.

---

## 6&nbsp;· Commit & Push Only When Lint-Clean

```bash
git add -u
git commit -m "style: pass full lint suite"
git push
```

If new deps or config were added, include lockfile / config in the same commit.

---

### ✅ Summary Checklist

- [ ] Deps installed (`pnpm install`, `pip install …`)
- [ ] `pnpm run lint -- --fix` passes
- [ ] `pnpm run lint:css -- --fix` passes
- [ ] `flake8 .` passes
- [ ] `pylint $(git ls-files '*.py')` score ≥ 8.0 & no fatal errors
- [ ] All lint commands exit **0**
- [ ] Commit + push

_Merge only when every box is checked._
