# Policywise — Policy Change Impact and Remediation

Policywise compares supplied policy versions, identifies affected controls, and supports human review of suggested impacts and remediation. It assesses only the material supplied by the user; it is not a compliance certification or legal opinion.

## Quick start

Requirements: Python 3.10+, Node.js 18+, and npm. Gemini is optional; without a Gemini key, assessments use the labelled offline keyword-overlap heuristic.

### Windows PowerShell

Open two terminals from the repository root.

Backend terminal:

```powershell
cd backend
py -3 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
# Optional: edit .env and set GEMINI_API_KEY to your Gemini API key.
uvicorn main:app --reload --port 8000
```

Frontend terminal:

```powershell
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. Add or load policy/control data, run an assessment, review its mappings, then use **Impact report** to create a PDF preview and download the PDF.

### macOS / Linux

In separate terminals:

```sh
cd backend
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
# Optionally add GEMINI_API_KEY to .env.
uvicorn main:app --reload --port 8000
```

```sh
cd frontend
npm install
npm run dev
```

The Vite development server listens on port 5173 and proxies `/api` requests to `http://localhost:8000`.

## Configuration and sensitive data

Backend configuration is loaded from `backend/.env`:

| Variable | Purpose | Default |
| --- | --- | --- |
| `GEMINI_API_KEY` | Enables Gemini-powered control mapping and context re-analysis. | Unset; offline heuristic is used. |
| `GEMINI_MODEL` | Gemini model name. | `gemini-2.5-flash` |
| `DB_PATH` | SQLite database path. | `app.db` (relative to the backend process working directory) |
| `AI_LOG_CONTENT` | Opt-in to write raw AI prompts and responses to application logs. | `false` |

Do not commit `.env`, API keys, or raw-content diagnostic logs. Prompts may contain policy text, control evidence, and reviewer answers. Keep `AI_LOG_CONTENT=false` except during approved diagnostics; protect and delete any captured logs according to your data-handling policy.

## Architecture

- `backend/main.py` — FastAPI API, SQLite schema and persistence, numbered clause parsing/diff, assessment logic, Gemini integration and heuristic fallback, deterministic summary/staleness checks, reviewer operations, audit events, and report data endpoint.
- `backend/tests/test_ai_workflow.py` — isolated `unittest` coverage for AI workflow validation, failure fallback, structured telemetry, and audit redaction.
- `frontend/src/App.jsx` — workspace state, Radix UI navigation, loading, and shared feedback.
- `frontend/src/components/Inputs.jsx` — policy version inputs and the control register.
- `frontend/src/components/Assessment.jsx` and `Mapping.jsx` — comparison results, human review, control mapping, actions, context answers, and risk acceptance.
- `frontend/src/components/Report.jsx` and `frontend/src/lib/impactReportPdf.js` — browser PDF preview, paginated PDF creation, and download.
- `frontend/src/lib/api.js` — JSON API client.
- `frontend/src/styles.css` — responsive app styles.

React/Vite serves the frontend. FastAPI exposes `/api` endpoints. SQLite stores policy versions, controls, assessments, change clauses, mappings, action items, control snapshots, and audit events. Gemini is used only when configured; a failed or empty Gemini assessment falls back to a labelled local heuristic. Suggested remediation is subject to reviewer approval.

## Completed scope

- Store previous and updated policy versions, their effective date, and a control register with owners, evidence, evidence dates, and current remediation status.
- Compare numbered policy clauses and retain the exact old/new clause IDs and text for detected changes.
- Ask Gemini to map changes to controls, distinguish confirmed/possible impact, flag evidence, suggest remediation, ask for missing context, and explain its rationale. Validate returned IDs and discard unknown/duplicate mappings.
- Provide a labelled keyword-overlap fallback when Gemini is not configured or cannot provide usable output.
- Calculate assessment summary counts deterministically; let reviewers accept, reject, or correct mappings; assign owners/statuses to approved actions; and record risk acceptances with a reason and future review date.
- Preserve policy and assessment versions, snapshot controls for each assessment, carry forward decisions/actions for unchanged mappings on re-evaluation, and mark assessments stale after relevant policy/control changes or overdue risk reviews.
- Record core assessment, reviewer, remediation, and risk events. Emit structured JSON request/AI workflow logs with timing and failure categories; raw prompt/response logging is opt-in.
- Generate a client-side PDF preview and downloadable PDF containing assessment metadata, summary, policy changes, impact mappings, review information, and remediation. The report explicitly says it is not a formal compliance certification.

## Tests and build

Run frontend checks from `frontend`:

```sh
npm test
npm run build
```

Run backend tests from `backend` with the virtual environment active:

```sh
python -m unittest discover -s tests -v
```

Frontend tests use Node's built-in test runner to exercise PDF creation, filename, and pagination. Backend tests use mocked Gemini responses and a temporary SQLite database; they do not require a real API key. The production build check is separate from behavioral tests.

## Limitations and intentionally excluded scope

- Clause extraction is designed for numbered clauses (for example `1`, `1.1`, `2.1`). Unnumbered structures, tables, footnotes, and complex document layouts are not reliably recognized. The application currently accepts pasted text rather than uploading/parsing Word or PDF documents.
- Re-evaluation is user-triggered. Policy/control changes and overdue risk reviews flag the existing assessment as stale; they do not automatically launch a new Gemini run.
- Mappings are retained with their assessments, but there is no separate immutable mapping-revision history/version number.
- Audit events have no authenticated reviewer identity or tamper-evident hash chain. They are application records, not a security-grade immutable audit service.
- Counts intentionally have different aggregation levels: `mapped`/`unmapped` count changed clauses, while `compliant`, `unresolved`, and several review/risk counts are mapping-oriented. Interpret the labels with that distinction.
- Gemini analysis depends on provider availability and the configured model. The heuristic fallback is intentionally conservative and may miss impacts; all mappings should be reviewed.
- SQLite and the development CORS settings are suitable for local evaluation only. No production hosting, container, cloud infrastructure, authentication, managed database, backups, or monitoring configuration is included.
- Unrestricted legal research, external compliance-platform integration, automatic enforcement, and modification of production systems are excluded.

## Deployment status and notes

**This repository does not currently deploy the application.** There are no checked-in Docker, cloud infrastructure, or hosting manifests. For a local production frontend bundle, run `npm run build` in `frontend`; serve the generated `frontend/dist` directory from a configured web host and deploy the FastAPI backend separately. Before public/production exposure, configure a restricted CORS origin, HTTPS, authentication/authorization, secure secret management, persistent backed-up database storage, log retention/access controls, and monitoring. Configure the frontend's API routing for the deployed backend rather than relying on the local Vite proxy.
