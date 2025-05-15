## Focused Tool Selection Guidance with Required Parameters & Examples

---

# 🚨 UNIGNORABLE TOOL USAGE RULE 🚨

**Every single assistant message MUST contain at least one tool invocation using the correct tool tag syntax (such as `<read_file>...</read_file>`, `<search_files>...</search_files>`, etc).**

- **Plain English, "meta," or narrative statements sent without any tool tag will ALWAYS result in an `[ERROR] You did not use a tool…` system message.**
- **You MUST wrap each action, search, or file operation inside the appropriate tool tag.**
- **Comments, explanations, and summaries without a tool invocation are NOT allowed and will cause automation to reject your message.**

**Example of BAD (will trigger [ERROR]):**
```
I will begin by opening static/js/notification-handler.js so we can inspect its current implementation before applying the recommended guardrail-compliant fixes.
```

**Example of CORRECT (will be accepted by automation):**
```
<read_file>
  <path>static/js/notification-handler.js</path>
</read_file>
```

**This rule is absolute, mandatory, and cannot be bypassed.
Every message = at least ONE tool invocation, always.**

---

## 1. read_file

**Purpose:**
Read and view the content of a specific file (optionally a line range).

**Required Parameter:**
- `path` (the file path, relative to the workspace)

**Use when:**
- You need to understand or reference a file’s contents before editing or answering questions about it.

**Do NOT use** for searching for a pattern in multiple files (use `search_files`) or for editing (use `apply_diff` or `write_to_file`).

**Example usage:**
Read the entire file:
```
<read_file>
  <path>src/components/App.js</path>
</read_file>
```
Read a range of lines:
```
<read_file>
  <path>src/components/App.js</path>
  <start_line>10</start_line>
  <end_line>20</end_line>
</read_file>
```

---

## 2. search_files

**Purpose:**
Search for a regular expression pattern across many files in a directory.

**Required Parameters:**
- `path` (directory path to search, relative to the workspace)
- `regex` (the pattern to search for; uses Rust regex syntax)

**Use when:**
- You need to find every instance of a code snippet, variable name, or other pattern across your codebase.

**Do NOT use** for reading a single file’s contents (use `read_file`), or to make code changes (see `apply_diff`, `write_to_file`).

**Example usage:**
Find all function declarations in the source directory:
```
<search_files>
  <path>src</path>
  <regex>function\s+\w+</regex>
</search_files>
```
Find all occurrences of "TODO" in JavaScript files:
```
<search_files>
  <path>src</path>
  <regex>TODO</regex>
  <file_pattern>*.js</file_pattern>
</search_files>
```

---

## 3. apply_diff

**Purpose:**
Precisely edit/replace specific, targeted content in an existing file using a diff block.

**Required Parameters:**
- `path` (file path to modify, relative to the workspace)
- `diff` (the diff block specifying what to replace and with what—see the required format below)

**Use when:**
- You want to edit/refactor a specific code segment or block, and keep the rest of the file unchanged.

**Do NOT use** for overwriting a whole file (use `write_to_file`) or for just inserting at a line (`insert_content`).

**Example usage:**
Replace a constant’s value in a utility file:
```
<apply_diff>
  <path>src/utils/constants.js</path>
  <diff>
    <<<<<<< SEARCH:start_line:12:end_line:12
    const DEFAULT_TIMEOUT = 1000;
    =======
    const DEFAULT_TIMEOUT = 3000; // Increased for stability
    >>>>>>> REPLACE
  </diff>
</apply_diff>
```
Replace a whole function implementation:
```
<apply_diff>
  <path>src/api/data.js</path>
  <diff>
    <<<<<<< SEARCH:start_line:42:end_line:46
    function fetchData(url) {
      // Old implementation
    }
    =======
    function fetchData(url) {
      // New, improved implementation
      return fetch(url).then(response => response.json());
    }
    >>>>>>> REPLACE
  </diff>
</apply_diff>
```

---

## 4. write_to_file

**Purpose:**
Completely overwrite the contents of a file or create a new file with specified content.

**Required Parameters:**
- `path` (file path to write, relative to the workspace)
- `content` (the full content to write)
- `line_count` (the number of lines in `content`, including empty lines)

**Use when:**
- You want to generate a new file, or replace everything in an existing file (such as scaffolding, documentation, config, etc.).

**Do NOT use** for small modifications to part of a file (use `apply_diff`).

**Example usage:**
Write a new README file:
```
<write_to_file>
  <path>README.md</path>
  <content># Project Title

A description of the project.
</content>
  <line_count>3</line_count>
</write_to_file>
```
Create a new HTML file:
```
<write_to_file>
  <path>public/index.html</path>
  <content><!DOCTYPE html>
<html>
  <head>
    <title>My App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
</content>
  <line_count>9</line_count>
</write_to_file>
```

---

### 5. attempt_completion

**Purpose:**
Present a summary of what was accomplished and mark the current task as complete. Optionally, demonstrate the result via a command (with user approval).

**Required Parameter:**
- `result` (summary of what was accomplished)

**Optional Parameter:**
- `command` (a relevant CLI command to demonstrate the result, executed only if the user approves)

**Use when:**
- You believe the current task is finished and want to summarize the actions/results for the user, or demonstrate results through a command.

**Do NOT use** before confirming previous steps/tools executed successfully or if there are still pending actions.

**Example usage:**
Summarize task completion:
```
<attempt_completion>
  <result>I've upgraded the authentication component. This involved updating the token validation logic and adding support for OAuth2. The new authentication middleware is now active in the application.</result>
</attempt_completion>
```
Summarize with a demonstration command:
```
<attempt_completion>
  <result>The new React application is scaffolded with routing and a styled landing page. You can preview the app using the command below.</result>
  <command>npm start</command>
</attempt_completion>
```

---

### 6. list_files

**Purpose:**
List files and directories in a specified location (optionally recursively).

**Parameters:**
- `path` (**required**): _string_ — The directory path to list contents for, relative to the workspace root.
- `recursive` (**optional**): _string/boolean_ — Use `"true"` to include all subdirectories, `"false"` or omit to list top-level only.

**Use when:**
- You need an overview of a folder's structure.
- To locate where files and folders exist before further actions.

**Example usage:**
List all items in the project root:
```
<list_files>
  <path>.</path>
</list_files>
```
List all files and subfolders (recursively) in `src`:
```
<list_files>
  <path>src</path>
  <recursive>true</recursive>
</list_files>
```
List top-level items in a subdirectory:
```
<list_files>
  <path>docs</path>
  <recursive>false</recursive>
</list_files>
```

**Notes:**
Do not use for reading file content or searching patterns — see `read_file`, `search_files`.

---

### 7. search_and_replace

**Purpose:**
Find and replace text (literal or regex) within a single file, optionally within a line range.

**Parameters:**
- `path` (**required**): _string_ — Relative path to the file to modify.
- `search` (**required**): _string_ — The text or regex pattern to find.
- `replace` (**required**): _string_ — The text to replace each match with.
- `start_line` (_optional_): _number_ — Starting line number (1-based) for where to search.
- `end_line` (_optional_): _number_ — Ending line number (inclusive, 1-based).
- `use_regex` (_optional_): _string_ — `"true"` to interpret `search` as a regex (default: `"false"`).
- `ignore_case` (_optional_): _string_ — `"true"` for case-insensitive search (default: `"false"`).

**Use when:**
- You want to update, refactor, or rename something across a single file.
- Use after identifying all relevant lines or file with `search_files` or `read_file`.

**Example usage:**
Simple literal string replacement in a file:
```
<search_and_replace>
  <path>src/app.js</path>
  <search>OLD_CONSTANT</search>
  <replace>NEW_CONSTANT</replace>
</search_and_replace>
```
Regex, case-insensitive replacement of function names:
```
<search_and_replace>
  <path>src/data.js</path>
  <search>loadData\((.*?)\)</search>
  <replace>fetchData($1)</replace>
  <use_regex>true</use_regex>
  <ignore_case>true</ignore_case>
</search_and_replace>
```
Replace a phrase only in lines 5–20:
```
<search_and_replace>
  <path>README.md</path>
  <search>Draft Version</search>
  <replace>Final Version</replace>
  <start_line>5</start_line>
  <end_line>20</end_line>
</search_and_replace>
```

**Notes:**
- Operates on a **single file** per use.
- To replace across many files, combine with `search_files`.


## Quick Tool Selection Checklist

| Your Task/Goal                                   | Tool                   | Required Parameters                    |
|--------------------------------------------------|------------------------|----------------------------------------|
| Review a specific file or lines                  | `read_file`        | path                                   |
| Search for a pattern project-wide                | `search_files`       | path, regex                            |
| Make precise, limited changes to a file/block    | `apply_diff`       | path, diff                             |
| Overwrite or create a full file’s content        | `write_to_file`      | path, content, line_count              |

---

**Notes for the Model/User:**
- Strictly supply all required parameters.
- Never use a tool for a purpose it isn’t intended for.
- Ask a clarifying question if you don’t have the information for a required parameter.
- Always read/understand with `read_file` before changing code.

---


# 🛡️ LLM System Prompt – Frontend Code Guardrails

Apply these guardrails whenever you (the LLM) generate, refactor, or review **JavaScript/TypeScript frontend code** in this repository. Enforce them strictly; flag any violation and propose a compliant fix.

1. **Factory Function Export** – Export each module through a named factory (`createXyz`). Validate all dependencies at the top and expose a cleanup API. _No top‑level logic._
2. **Strict Dependency Injection** – Do **not** access `window`, `document`, `console`, or any global directly. Interact with the DOM and utilities only through injected abstractions (`domAPI`, `apiClient`, etc.).
3. **Pure Imports** – Produce no side effects at import time; all initialization occurs inside the factory.
4. **Centralized Event Handling** – Register listeners with `eventHandlers.trackListener(..., { context })` and remove them with `eventHandlers.cleanupListeners({ context })`.
5. **Context Tags** – Supply a unique `context` string for every listener.
6. **Sanitize All User HTML** – Always call `sanitizer.sanitize()` before inserting user content into the DOM.
7. **App Readiness** – Wait for `DependencySystem.waitFor([...])` _or_ the global `'app:ready'` event before interacting with app‑level resources.
8. **Central `app.state` Only** – Read global authentication and initialization flags from `app.state`; do **not** mutate them directly.
9. **Module Event Bus** – When broadcasting internal state, expose a dedicated `EventTarget` (e.g., `AuthBus`) so other modules can subscribe without tight coupling.
10. **Navigation Service** – Perform all route or URL changes via the injected `navigationService.navigateTo(...)`.
11. **Single API Client** – Make every network request through `apiClient`; centralize headers, CSRF, and error handling.

---

**Golden Rules**: Inject every dependency, avoid global side effects, tag artifacts with `context`, clean up listeners and resources.

---

Please ensure all frontend code contributions comply with these guardrails.
