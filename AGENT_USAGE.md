# Agent usage and verification notes

This document records how coding agents have worked with this repository, representative task prompts, delegated exploration, known mistakes, and the verification evidence available from the project work.

## Tools and working approach

- **Read-only codebase inspection:** `list_dir`, `file_search`, `grep_search`, `read_file`, and `get_errors`. For backend work, inspect `backend/main.py`, its tests, configuration templates, and API/data flow. Do not read or reproduce secrets from `backend/.env`.
- **Editing:** `apply_patch` for focused changes and `create_file` for new modules/docs/tests. Prefer small, reviewable edits; do not replace whole files when a localized edit is sufficient.
- **Commands:** `run_in_terminal` for npm install/build/test commands and Python tests using the selected Python environment. Do not run notebook commands in this React/FastAPI repository.
- **UI validation:** `open_browser_page`, `read_page`, `click_element`, and `screenshot_page` to inspect the local Vite app when UI work is requested.
- **Delegation:** `runSubagent` was used for a read-only inspection of the report component, FastAPI/Gemini path, logging, audit schema, and test setup. Its role was research only; implementation remained in the main coding session.

## Representative prompts

Examples based on work requested for this repository:

- “Split the policy impact screen into files, use Radix UI, and improve the interface.”
- “Use jsPDF for a properly formatted impact report.”
- “Show a PDF preview and PDF download only; remove Markdown from the report screen.”
- “Check the implementation against the supplied input, AI-agent, and application requirements without changing anything.”
- “Document setup, architecture, completed/excluded scope, tests, limitations, deployment, and agent usage.”

The intended workflow is to clarify only decisions that materially affect behavior, inspect the existing implementation, make the requested change, then report what was actually verified. A read-only compliance review should remain read-only.

## Delegated work

The read-only exploration request covered:

- How the React report component generated and downloaded output.
- How FastAPI builds numbered clause diffs, calls Gemini, validates response IDs, and falls back to a heuristic.
- What the audit table records and whether tests/deployment scaffolding existed.

The exploration returned findings and recommendations; it did not edit repository files. Recommendations were checked against the local source before being described as implemented.

## Important mistakes and scope decisions

- A PDF UI edit briefly placed `hasCurrentPreview` inside the preview callback and introduced duplicate toolbar/iframe markup. This caused a runtime `ReferenceError`, reported by the user. The declaration was moved to component scope, duplicate markup removed, and editor diagnostics then reported no errors. Before similar changes, inspect the entire edited component rather than trusting a partial patch result.
- During backend-test setup, the selected Python environment initially lacked the API dependencies. The test fixture also needed cleanup/commit handling for SQLite on Windows, and one telemetry assertion read the prompt hash from the wrong event. These issues were corrected; keep database fixtures isolated, close connections explicitly, and assert fields on the appropriate structured event.
- The user explicitly requested a PDF-only report UI. The Markdown presentation/download was removed from the frontend; do not add it back unless asked. The backend Markdown endpoint may remain, but it is not the report UI requested.
- The user at one point narrowed work to the PDF change and explicitly said not to continue unrelated work or testing. Respect narrow scope and do not run tests, refactor adjacent features, or pursue earlier recommendations unless requested or necessary to resolve the current defect.
- No design alternatives were represented as accepted when the user had not chosen them. In particular, automatic re-evaluation timing, standalone mapping-version semantics, reviewer authentication, and audit tamper-evidence remain decisions/limitations, not completed features.

## Verification evidence

Verification performed during the project work included:

- **Frontend build:** `npm run build` completed successfully after the initial component/Radix and PDF-generator implementation. This build predates the final PDF-only preview markup, so it must not be treated as verification of every later UI edit.
- **Frontend PDF utility tests:** `npm test` passed three tests covering PDF creation/name, long-content pagination, and missing assessment data. These test the PDF utility, not the full React preview experience.
- **Backend AI workflow tests:** the final recorded `python -m unittest discover -s tests -v` command completed with exit code 0. The suite uses mocked Gemini responses and an isolated SQLite database; it does not verify a live Gemini key or hosted deployment.
- **Browser inspection:** the local Vite app rendered its workspace, including the policy inputs and audit views. A separate preview attempt on another port produced 404s; the working app was on port 5173. This was not an end-to-end production deployment test.
- **Final PDF component correction:** editor diagnostics reported no errors in `Report.jsx` after the runtime error was corrected. No production build or browser end-to-end PDF-preview test was run after that final correction.

When making new changes, rerun only the relevant checks and update this section with the exact command/result and scope. Never claim a live AI integration, production deployment, or browser PDF rendering was verified unless it was actually exercised.
