import os, json, re, sqlite3, difflib, hashlib, datetime as dt, logging, time, uuid
import requests
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv
load_dotenv()
KEY = os.getenv("GEMINI_API_KEY"); MODEL = os.getenv("GEMINI_MODEL", "gemini-2.5-flash")
DB = os.getenv("DB_PATH", "app.db")
app = FastAPI(title="Policy Change Impact and Remediation Agent")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
workflow_logger = logging.getLogger("policy_agent")
workflow_logger.setLevel(logging.INFO)
if not workflow_logger.handlers:
    workflow_logger.addHandler(logging.StreamHandler())
workflow_logger.propagate = False
AI_PROMPT_VERSION = "policy-impact-v1"
SCHEMA = """
CREATE TABLE IF NOT EXISTS docs(id INTEGER PRIMARY KEY, kind TEXT, version INT, name TEXT, text TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS controls(id INTEGER PRIMARY KEY, ref TEXT, name TEXT, description TEXT, owner TEXT, evidence TEXT, evidence_date TEXT, status TEXT, active INT DEFAULT 1);
CREATE TABLE IF NOT EXISTS meta(k TEXT PRIMARY KEY, v TEXT);
CREATE TABLE IF NOT EXISTS assessments(id INTEGER PRIMARY KEY, version INT, old_doc INT, new_doc INT, ctrl_ver INT, mode TEXT, ts TEXT);
CREATE TABLE IF NOT EXISTS changes(id INTEGER PRIMARY KEY, aid INT, kind TEXT, old_sec TEXT, new_sec TEXT, old_text TEXT, new_text TEXT);
CREATE TABLE IF NOT EXISTS mappings(id INTEGER PRIMARY KEY, aid INT, change_id INT, control_id INT, cfp TEXT, impact TEXT, rationale TEXT, outdated INT, outdated_reason TEXT, questions TEXT, suggested TEXT, source TEXT, decision TEXT DEFAULT 'pending', note TEXT, risk_reason TEXT, risk_review TEXT);
CREATE TABLE IF NOT EXISTS actions(id INTEGER PRIMARY KEY, mid INT, text TEXT, owner TEXT, status TEXT DEFAULT 'Open');
CREATE TABLE IF NOT EXISTS snaps(aid INT, cid INT, data TEXT, PRIMARY KEY(aid,cid));
CREATE TABLE IF NOT EXISTS audit(id INTEGER PRIMARY KEY, ts TEXT, actor TEXT, event TEXT, detail TEXT);
"""
def conn():
    c = sqlite3.connect(DB); c.row_factory = sqlite3.Row; return c
_schema_connection = conn()
try:
    c = _schema_connection
    c.executescript(SCHEMA)
    for _a in ("ALTER TABLE docs ADD COLUMN effective_date TEXT", "ALTER TABLE mappings ADD COLUMN answers TEXT"):
        try: c.execute(_a)
        except sqlite3.OperationalError: pass
finally:
    _schema_connection.close()
def q(sql, a=()):
    with conn() as c: return [dict(r) for r in c.execute(sql, a).fetchall()]
def ex(sql, a=()):
    with conn() as c: return c.execute(sql, a).lastrowid
now = lambda: dt.datetime.utcnow().isoformat(timespec="seconds") + "Z"
def log(event, detail="", actor="reviewer"): ex("INSERT INTO audit(ts,actor,event,detail) VALUES(?,?,?,?)", (now(), actor, event, detail))
def structured_log(event, **fields):
    record = {"ts": now(), "event": event, **fields}
    workflow_logger.info(json.dumps(record, ensure_ascii=False, separators=(",", ":"), default=str))

def content_logging_enabled():
    return os.getenv("AI_LOG_CONTENT", "false").strip().lower() in ("1", "true", "yes", "on")

def failure_category(error):
    if isinstance(error, requests.Timeout): return "timeout"
    if isinstance(error, requests.HTTPError): return "provider_http_error"
    if isinstance(error, requests.RequestException): return "network_error"
    if isinstance(error, (json.JSONDecodeError, KeyError, IndexError, TypeError)): return "invalid_provider_response"
    return "unexpected_error"

class AIWorkflowError(Exception):
    def __init__(self, run_id, category):
        self.run_id, self.category = run_id, category
        super().__init__(f"AI workflow failed ({category}; run {run_id})")

@app.middleware("http")
async def log_http_request(request, call_next):
    request_id = request.headers.get("x-request-id", "")[:80] or str(uuid.uuid4())
    started = time.perf_counter()
    try:
        response = await call_next(request)
        structured_log("http.request.completed", request_id=request_id, method=request.method,
                       path=request.url.path, status_code=response.status_code,
                       duration_ms=round((time.perf_counter() - started) * 1000, 2))
        response.headers["x-request-id"] = request_id
        return response
    except Exception as error:
        structured_log("http.request.failed", request_id=request_id, method=request.method,
                       path=request.url.path, failure_category=failure_category(error),
                       duration_ms=round((time.perf_counter() - started) * 1000, 2))
        raise
def ctrl_ver():
    r = q("SELECT v FROM meta WHERE k='ctrl_ver'"); return int(r[0]["v"]) if r else 1
def bump():
    ex("INSERT OR REPLACE INTO meta VALUES('ctrl_ver',?)", (str(ctrl_ver() + 1),))
fp = lambda c: hashlib.md5("|".join(str(c[k]) for k in ("description", "owner", "evidence", "evidence_date", "status")).encode()).hexdigest()
h = lambda s: hashlib.md5(s.encode()).hexdigest()

# ---------- deterministic parsing / diff ----------
def sections(t):
    out, cur = {}, None
    for ln in t.splitlines():
        m = re.match(r"^\s*(?:Section\s+)?(\d+(?:\.\d+)*)[.):]?\s+(.+)", ln)
        if m: cur = m.group(1); out[cur] = m.group(2).strip()
        elif cur and ln.strip(): out[cur] += " " + ln.strip()
    return out
norm = lambda s: re.sub(r"\s+", " ", s.lower()).strip()
def diff(o, n):
    ch, rem, add = [], [k for k in o if k not in n], [k for k in n if k not in o]
    for k in o:
        if k in n and norm(o[k]) != norm(n[k]): ch.append(("modified", k, k, o[k], n[k]))
    for k in rem[:]:
        if not add: break
        b = max(add, key=lambda a: difflib.SequenceMatcher(None, o[k], n[a]).ratio())
        if difflib.SequenceMatcher(None, o[k], n[b]).ratio() > 0.6:
            ch.append(("modified", k, b, o[k], n[b])); rem.remove(k); add.remove(b)
    ch += [("removed", k, None, o[k], None) for k in rem] + [("added", None, k, None, n[k]) for k in add]
    return ch

# ---------- AI (Gemini) ----------
def gemini(prompt, operation="assessment", assessment_id=None, mapping_id=None):
    run_id, started = str(uuid.uuid4()), time.perf_counter()
    capture_content = content_logging_enabled()
    structured_log("ai.request.started", run_id=run_id, operation=operation,
                   assessment_id=assessment_id, mapping_id=mapping_id, model=MODEL,
                   prompt_version=AI_PROMPT_VERSION,
                   prompt_sha256=hashlib.sha256(prompt.encode()).hexdigest(),
                   prompt_chars=len(prompt), content_capture_enabled=capture_content,
                   **({"prompt": prompt} if capture_content else {}))
    try:
        response = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            headers={"x-goog-api-key": KEY}, timeout=180,
            json={"contents": [{"parts": [{"text": prompt}]}], "generationConfig": {"responseMimeType": "application/json", "temperature": 0.1}})
        response.raise_for_status()
        response_text = response.json()["candidates"][0]["content"]["parts"][0]["text"]
        parsed = json.loads(response_text)
        structured_log("ai.request.completed", run_id=run_id, operation=operation,
                       assessment_id=assessment_id, mapping_id=mapping_id, model=MODEL,
                       duration_ms=round((time.perf_counter() - started) * 1000, 2),
                       response_sha256=hashlib.sha256(response_text.encode()).hexdigest(),
                       response_chars=len(response_text), content_capture_enabled=capture_content,
                       **({"response": response_text} if capture_content else {}))
        return parsed, run_id
    except Exception as error:
        category = failure_category(error)
        structured_log("ai.request.failed", run_id=run_id, operation=operation,
                       assessment_id=assessment_id, mapping_id=mapping_id, model=MODEL,
                       duration_ms=round((time.perf_counter() - started) * 1000, 2),
                       failure_category=category, content_capture_enabled=capture_content)
        raise AIWorkflowError(run_id, category) from error
PROMPT = """You are a policy change impact analyst. Assess ONLY against the supplied policy text and control register. Do not use outside law or claim compliance certification.
For each (change, control) pair that is plausibly affected, return a mapping. Use impact "confirmed" ONLY when the changed requirement directly and clearly covers the control's described scope; otherwise "possible". If evidence date/text predates the change or doesn't address the new requirement, set outdated true with reason. List missing_context questions when you cannot decide. Suggest concrete remediation steps.
Return JSON: {"mappings":[{"change_id":int,"control_id":int,"impact":"confirmed|possible","rationale":str,"outdated":bool,"outdated_reason":str,"missing_context":[str],"remediation":[str]}]}
CHANGES: %s
CONTROLS: %s"""
def fallback(changes, ctrls):
    out = []
    for c in changes:
        cw = set(re.findall(r"[a-z]{4,}", norm((c["old_text"] or "") + " " + (c["new_text"] or ""))))
        for k in ctrls:
            kw = set(re.findall(r"[a-z]{4,}", norm(k["name"] + " " + k["description"])))
            if len(cw & kw) >= 2:
                out.append(dict(change_id=c["id"], control_id=k["id"], impact="possible", rationale=f"Keyword overlap: {', '.join(sorted(cw & kw)[:6])} (offline heuristic, needs review).",
                    outdated=False, outdated_reason="", missing_context=["Confirm scope of this control against the changed requirement."], remediation=["Review control design against the new requirement."]))
    return out

def stale_ev(k, eff):  # deterministic outdated-evidence check
    d = (k.get("evidence_date") or "").strip()
    if not d: return "No evidence date recorded."
    return f"Evidence dated {d} predates the new policy effective date {eff}." if eff and d < eff else ""
# ---------- models ----------
class Doc(BaseModel): kind: str; name: str = ""; text: str; effective_date: str = ""
class Ctrl(BaseModel):
    ref: str; name: str; description: str = ""; owner: str = ""; evidence: str = ""; evidence_date: str = ""; status: str = "Not started"
class Review(BaseModel): decision: str; control_id: int | None = None; impact: str | None = None; note: str = ""
class Act(BaseModel): text: str; owner: str = ""; status: str = "Open"
class Risk(BaseModel): reason: str; review_date: str

# ---------- documents & controls ----------
@app.post("/api/documents")
def add_doc(d: Doc):
    if d.kind not in ("old", "new") or not d.text.strip(): raise HTTPException(400, "kind must be old|new and text required")
    v = (q("SELECT MAX(version) m FROM docs WHERE kind=?", (d.kind,))[0]["m"] or 0) + 1
    i = ex("INSERT INTO docs(kind,version,name,text,ts,effective_date) VALUES(?,?,?,?,?,?)", (d.kind, v, d.name, d.text, now(), d.effective_date or None))
    log("document_added", f"{d.kind} policy v{v} '{d.name}' ({len(sections(d.text))} sections)"); return {"id": i, "version": v}
@app.get("/api/documents")
def docs(): return q("SELECT id,kind,version,name,text,ts,effective_date FROM docs ORDER BY id DESC")
@app.get("/api/controls")
def controls(): return q("SELECT * FROM controls WHERE active=1 ORDER BY ref")
@app.post("/api/controls")
def add_ctrl(c: Ctrl):
    i = ex("INSERT INTO controls(ref,name,description,owner,evidence,evidence_date,status) VALUES(?,?,?,?,?,?,?)", tuple(c.model_dump().values()))
    bump(); log("control_added", c.ref); return {"id": i}
@app.put("/api/controls/{cid}")
def upd_ctrl(cid: int, c: Ctrl):
    ex("UPDATE controls SET ref=?,name=?,description=?,owner=?,evidence=?,evidence_date=?,status=? WHERE id=?", (*c.model_dump().values(), cid))
    bump(); log("control_updated", c.ref); return {"ok": True}
@app.delete("/api/controls/{cid}")
def del_ctrl(cid: int):
    ex("UPDATE controls SET active=0 WHERE id=?", (cid,)); bump(); log("control_removed", str(cid)); return {"ok": True}

# ---------- assessment ----------
def latest(kind):
    r = q("SELECT * FROM docs WHERE kind=? ORDER BY version DESC LIMIT 1", (kind,)); return r[0] if r else None
@app.post("/api/assess")
def assess():
    assessment_started = time.perf_counter()
    o, n, ctrls = latest("old"), latest("new"), q("SELECT * FROM controls WHERE active=1")
    if not (o and n): raise HTTPException(400, "Add both a previous and a new policy version first.")
    if not ctrls: raise HTTPException(400, "Add at least one control.")
    prev = q("SELECT id FROM assessments ORDER BY id DESC LIMIT 1")
    ver = len(q("SELECT id FROM assessments")) + 1
    aid = ex("INSERT INTO assessments(version,old_doc,new_doc,ctrl_ver,mode,ts) VALUES(?,?,?,?,?,?)", (ver, o["id"], n["id"], ctrl_ver(), "gemini" if KEY else "offline", now()))
    for k in ctrls: ex("INSERT INTO snaps VALUES(?,?,?)", (aid, k["id"], json.dumps(k)))  # snapshot controls as assessed
    eff = n.get("effective_date") or n["ts"][:10]
    changes = []
    for kind, os_, ns, ot, nt in diff(sections(o["text"]), sections(n["text"])):
        cid = ex("INSERT INTO changes(aid,kind,old_sec,new_sec,old_text,new_text) VALUES(?,?,?,?,?,?)", (aid, kind, os_, ns, ot, nt))
        changes.append(dict(id=cid, kind=kind, old_sec=os_, new_sec=ns, old_text=ot, new_text=nt))
    err, source, res, ai_run_id = None, "gemini", [], None
    if KEY and changes:
        try:
            cin = [dict(change_id=c["id"], type=c["kind"], old_section=c["old_sec"], old_text=c["old_text"], new_section=c["new_sec"], new_text=c["new_text"]) for c in changes]
            kin = [dict(control_id=k["id"], ref=k["ref"], name=k["name"], description=k["description"], owner=k["owner"], evidence=k["evidence"], evidence_date=k["evidence_date"], remediation_status=k["status"]) for k in ctrls]
            output, ai_run_id = gemini(PROMPT % (json.dumps(cin), json.dumps(kin)), assessment_id=aid)
            res = output.get("mappings", []) if isinstance(output, dict) else None
            if not isinstance(res, list):
                structured_log("ai.output.invalid", run_id=ai_run_id, operation="assessment", assessment_id=aid,
                               reason="mappings_not_a_list", output_type=type(res).__name__)
                res = []
        except AIWorkflowError as e:
            err = f"Gemini analysis failed ({e.category}; run {e.run_id}); used offline heuristic."
            res = []
    fallback_reason = None
    if not res:
        fallback_reason = "provider_failure" if err else "model_returned_no_mappings" if ai_run_id else "ai_not_configured"
        source = "offline-heuristic"
        res = fallback(changes, ctrls)
        structured_log("ai.workflow.fallback", operation="assessment", assessment_id=aid,
                       run_id=ai_run_id, reason=fallback_reason, fallback_mapping_count=len(res))
    cmap, kmap, seen = {c["id"]: c for c in changes}, {k["id"]: k for k in ctrls}, set()
    invalid_change_ids, invalid_control_ids, duplicate_pairs = [], [], []
    malformed_mapping_count, accepted_mapping_count = 0, 0
    for m in res:  # deterministic validation: log and drop hallucinated ids / duplicates
        if not isinstance(m, dict):
            malformed_mapping_count += 1
            continue
        change_id, control_id = m.get("change_id"), m.get("control_id")
        valid_change = isinstance(change_id, int) and not isinstance(change_id, bool) and change_id in cmap
        valid_control = isinstance(control_id, int) and not isinstance(control_id, bool) and control_id in kmap
        if not valid_change:
            invalid_change_ids.append(str(change_id)[:80])
        if not valid_control:
            invalid_control_ids.append(str(control_id)[:80])
        if not valid_change or not valid_control:
            continue
        if (change_id, control_id) in seen:
            duplicate_pairs.append([change_id, control_id])
            continue
        seen.add((change_id, control_id))
        accepted_mapping_count += 1
        det = stale_ev(kmap[control_id], eff)
        imp = m.get("impact") if m.get("impact") in ("confirmed", "possible") else "possible"
        ex("INSERT INTO mappings(aid,change_id,control_id,cfp,impact,rationale,outdated,outdated_reason,questions,suggested,source) VALUES(?,?,?,?,?,?,?,?,?,?,?)",
           (aid, change_id, control_id, fp(kmap[control_id]), imp, m.get("rationale", ""), int(bool(m.get("outdated")) or bool(det)), (det + " " + str(m.get("outdated_reason", ""))).strip(),
            json.dumps(m.get("missing_context", [])), json.dumps(m.get("remediation", [])), source))
    structured_log("ai.output.validation", run_id=ai_run_id, operation="assessment", assessment_id=aid,
                   source=source, candidate_count=len(res), accepted_count=accepted_mapping_count,
                   malformed_count=malformed_mapping_count, invalid_change_ids=invalid_change_ids[:100],
                   invalid_control_ids=invalid_control_ids[:100], duplicate_pairs=duplicate_pairs[:100])
    ex("UPDATE assessments SET mode=? WHERE id=?", (source, aid))
    carried = 0
    if prev:  # re-evaluation preserves prior decisions when change text and control are unchanged
        old = q("SELECT m.*,c.old_sec,c.new_sec,c.old_text,c.new_text FROM mappings m JOIN changes c ON c.id=m.change_id WHERE m.aid=? AND m.decision!='pending'", (prev[0]["id"],))
        for m in q("SELECT m.*,c.old_sec,c.new_sec,c.old_text,c.new_text FROM mappings m JOIN changes c ON c.id=m.change_id WHERE m.aid=?", (aid,)):
            for p in old:
                if (p["old_sec"], p["new_sec"], p["control_id"], h(str(p["old_text"]) + str(p["new_text"])), p["cfp"]) == (m["old_sec"], m["new_sec"], m["control_id"], h(str(m["old_text"]) + str(m["new_text"])), m["cfp"]):
                    ex("UPDATE mappings SET decision=?,note=?,risk_reason=?,risk_review=? WHERE id=?", (p["decision"], p["note"], p["risk_reason"], p["risk_review"], m["id"]))
                    for a in q("SELECT * FROM actions WHERE mid=?", (p["id"],)): ex("INSERT INTO actions(mid,text,owner,status) VALUES(?,?,?,?)", (m["id"], a["text"], a["owner"], a["status"]))
                    carried += 1; break
    log("assessment_run", f"v{ver}: policy old v{o['version']} -> new v{n['version']}, controls v{ctrl_ver()}, {len(changes)} changes, {len(seen)} mappings, {carried} decisions carried over, source={source}", "system")
    structured_log("assessment.completed", assessment_id=aid, version=ver, source=source,
                   change_count=len(changes), mapping_count=len(seen), carried_decision_count=carried,
                   warning_category="ai_fallback" if err else None,
                   duration_ms=round((time.perf_counter() - assessment_started) * 1000, 2))
    return {"id": aid, "warning": err}
def summary(aid):
    ch, mp = q("SELECT id FROM changes WHERE aid=?", (aid,)), q("SELECT * FROM mappings WHERE aid=?", (aid,))
    live = [m for m in mp if m["decision"] != "rejected"]
    s = dict(changes=len(ch), mapped=len({m["change_id"] for m in live}), compliant=0, risk_accepted=0, risk_overdue=0, unresolved=0, rejected=len(mp) - len(live), pending_review=sum(m["decision"] == "pending" for m in mp))
    s["unmapped"] = s["changes"] - s["mapped"]
    for m in live:
        acts = q("SELECT status FROM actions WHERE mid=?", (m["id"],))
        if m["risk_reason"] and (m["risk_review"] or "") >= now()[:10]: s["risk_accepted"] += 1
        elif m["risk_reason"]: s["risk_overdue"] += 1; s["unresolved"] += 1
        elif m["decision"] in ("accepted", "corrected") and acts and all(a["status"] == "Done" for a in acts): s["compliant"] += 1
        else: s["unresolved"] += 1
    return s
def full(aid):
    a = q("SELECT * FROM assessments WHERE id=?", (aid,))
    if not a: raise HTTPException(404, "Not found")
    a = a[0]; reasons = []
    if a["old_doc"] != latest("old")["id"] or a["new_doc"] != latest("new")["id"]: reasons.append("A policy document changed after this assessment.")
    if a["ctrl_ver"] != ctrl_ver(): reasons.append("The control register changed after this assessment.")
    od = q("SELECT COUNT(*) n FROM mappings WHERE aid=? AND decision!='rejected' AND risk_reason IS NOT NULL AND risk_review<?", (aid, now()[:10]))[0]["n"]
    if od: reasons.append(f"{od} risk acceptance(s) are past their review date.")
    kmap = {k["id"]: k for k in q("SELECT * FROM controls")}
    kmap.update({r["cid"]: json.loads(r["data"]) for r in q("SELECT * FROM snaps WHERE aid=?", (aid,))})  # controls as they were assessed
    chs = q("SELECT * FROM changes WHERE aid=?", (aid,))
    for c in chs:
        c["mappings"] = q("SELECT * FROM mappings WHERE change_id=?", (c["id"],))
        for m in c["mappings"]:
            m["questions"], m["suggested"] = json.loads(m["questions"] or "[]"), json.loads(m["suggested"] or "[]")
            m["answers"] = json.loads(m.get("answers") or "{}"); m["control"], m["actions"] = kmap.get(m["control_id"]), q("SELECT * FROM actions WHERE mid=?", (m["id"],))
    return dict(assessment=a, stale=bool(reasons), stale_reasons=reasons, summary=summary(aid), changes=chs,
                old_doc=q("SELECT version,name FROM docs WHERE id=?", (a["old_doc"],))[0], new_doc=q("SELECT version,name FROM docs WHERE id=?", (a["new_doc"],))[0])
@app.get("/api/assessments")
def assessments(): return q("SELECT * FROM assessments ORDER BY id DESC")
@app.get("/api/assessments/{aid}")
def get_a(aid: int): return full(aid)

# ---------- review, actions, risk ----------
def mapping(mid):
    r = q("SELECT * FROM mappings WHERE id=?", (mid,))
    if not r: raise HTTPException(404, "Mapping not found")
    return r[0]
@app.post("/api/mappings/{mid}/review")
def review(mid: int, r: Review):
    m = mapping(mid)
    if r.decision not in ("accepted", "rejected", "corrected"): raise HTTPException(400, "Invalid decision")
    if r.decision == "rejected" and not r.note.strip(): raise HTTPException(400, "A reason is required to reject a mapping.")
    if r.decision == "corrected":
        k = q("SELECT * FROM controls WHERE id=?", (r.control_id or m["control_id"],))
        if not k: raise HTTPException(400, "Unknown control")
        ex("INSERT OR IGNORE INTO snaps VALUES(?,?,?)", (m["aid"], k[0]["id"], json.dumps(k[0])))
        ex("UPDATE mappings SET control_id=?,impact=?,cfp=? WHERE id=?", (k[0]["id"], r.impact or m["impact"], fp(k[0]), mid))
    ex("UPDATE mappings SET decision=?,note=? WHERE id=?", (r.decision, r.note, mid))
    log(f"mapping_{r.decision}", f"mapping {mid} (was control {m['control_id']}/{m['impact']})"); return {"ok": True}
@app.post("/api/mappings/{mid}/actions")
def add_action(mid: int, a: Act):
    if mapping(mid)["decision"] not in ("accepted", "corrected"): raise HTTPException(400, "Accept or correct the mapping before approving actions.")
    i = ex("INSERT INTO actions(mid,text,owner,status) VALUES(?,?,?,?)", (mid, a.text, a.owner, a.status)); log("action_approved", f"mapping {mid}, action {i}, status {a.status}"); return {"id": i}
@app.put("/api/actions/{aid}")
def upd_action(aid: int, a: Act):
    ex("UPDATE actions SET text=?,owner=?,status=? WHERE id=?", (a.text, a.owner, a.status, aid)); log("action_updated", f"action {aid}, status {a.status}"); return {"ok": True}
@app.post("/api/mappings/{mid}/risk")
def risk(mid: int, r: Risk):
    mapping(mid)
    if not r.reason.strip() or r.review_date <= now()[:10]: raise HTTPException(400, "Provide a reason and a future review date (YYYY-MM-DD).")
    ex("UPDATE mappings SET risk_reason=?,risk_review=? WHERE id=?", (r.reason, r.review_date, mid)); log("risk_accepted", f"mapping {mid}, review {r.review_date}"); return {"ok": True}
@app.delete("/api/mappings/{mid}/risk")
def unrisk(mid: int):
    ex("UPDATE mappings SET risk_reason=NULL,risk_review=NULL WHERE id=?", (mid,)); log("risk_withdrawn", f"mapping {mid}"); return {"ok": True}
@app.get("/api/audit")
def audit(): return q("SELECT * FROM audit ORDER BY id DESC")

# ---------- report ----------
@app.get("/api/assessments/{aid}/report")
def report(aid: int):
    d = full(aid); s, a = d["summary"], d["assessment"]
    L = [f"# Policy Change Impact Report", f"Assessment v{a['version']} - {a['ts']} - policy '{d['old_doc']['name']}' v{d['old_doc']['version']} -> '{d['new_doc']['name']}' v{d['new_doc']['version']} - controls register v{a['ctrl_ver']} - analysis: {a['mode']}",
         "> This report assesses impact only against the supplied policy text and control register. It is NOT a formal compliance certification.", ""]
    if d["stale"]: L += ["**STALE ASSESSMENT:** " + " ".join(d["stale_reasons"]) + " Re-run before relying on this report.", ""]
    if s["pending_review"]: L += [f"**Not fully reviewed:** {s['pending_review']} mapping(s) still pending.", ""]
    L += ["## Summary", f"- Changes: {s['changes']} | Mapped: {s['mapped']} | Unmapped: {s['unmapped']}", f"- Compliant: {s['compliant']} | Risk accepted: {s['risk_accepted']} | Risk overdue: {s['risk_overdue']} | Unresolved: {s['unresolved']} | Rejected mappings: {s['rejected']}", "", "## Changes"]
    for c in d["changes"]:
        L += [f"### {c['kind'].title()}: old {c['old_sec'] or '-'} / new {c['new_sec'] or '-'}", f"- Old: {c['old_text'] or '(none)'}", f"- New: {c['new_text'] or '(none)'}"]
        if not c["mappings"]: L.append("- No affected controls identified (unmapped).")
        for m in c["mappings"]:
            k = m["control"]; L += [f"- **{k['ref']} {k['name']}** [{m['impact']}, {m['decision']}] owner: {k['owner'] or 'n/a'}", f"  - Why: {m['rationale']}"]
            if m["outdated"]: L.append(f"  - Possibly outdated evidence: {m['outdated_reason']}")
            if m["note"]: L.append(f"  - Reviewer note: {m['note']}")
            for qq, aa in m["answers"].items():
                if aa: L.append(f"  - Context provided: {qq} -> {aa}")
            for x in m["actions"]: L.append(f"  - Action: {x['text']} ({x['owner'] or 'unassigned'}, {x['status']})")
            if m["risk_reason"]: L.append(f"  - Risk accepted until {m['risk_review']}{' (OVERDUE for review)' if m['risk_review'] < now()[:10] else ''}: {m['risk_reason']}")
        L.append("")
    log("report_generated", f"assessment {aid}", "system"); return {"markdown": "\n".join(L)}

# ---------- sample data ----------
OLD = """1. Access Control
1.1 User access reviews shall be performed annually.
1.2 Passwords must be at least 8 characters.
2. Data Retention
2.1 Customer records shall be retained for 7 years.
3. Incident Response
3.1 Security incidents must be reported within 5 business days.
4. Vendor Management
4.1 Vendors shall be assessed at onboarding."""
NEW = """1. Access Control
1.1 User access reviews shall be performed quarterly.
1.2 Passwords must be at least 14 characters and multi-factor authentication is required for administrators.
2. Data Retention
2.1 Customer records shall be retained for 7 years.
3. Incident Response
3.1 Security incidents must be reported within 72 hours.
4. Vendor Management
4.1 Vendors shall be assessed at onboarding and re-assessed annually.
5. Encryption
5.1 Personal data at rest must be encrypted using approved algorithms."""
@app.post("/api/seed")
def seed():
    add_doc(Doc(kind="old", name="Security Policy", text=OLD)); add_doc(Doc(kind="new", name="Security Policy", text=NEW, effective_date="2025-03-15"))
    for c in [Ctrl(ref="AC-01", name="User access review", description="Periodic review of user access rights and password standards", owner="Priya (IAM)", evidence="Annual review completed 2025-03", evidence_date="2025-03-01", status="Not started"),
              Ctrl(ref="IR-02", name="Incident reporting procedure", description="Process for reporting security incidents to management", owner="Rahul (SecOps)", evidence="Runbook v3 says 5 business days", evidence_date="2025-01-10", status="In progress"),
              Ctrl(ref="VM-03", name="Vendor assessment", description="Due diligence assessment of vendors and suppliers", owner="Anita (Procurement)", evidence="Onboarding questionnaire", evidence_date="2025-02-15", status="Not started"),
              Ctrl(ref="DR-04", name="Records retention schedule", description="Retention of customer records", owner="Sam (Legal)", evidence="Retention schedule 2025", evidence_date="2025-04-01", status="Complete")]: add_ctrl(c)
    return {"ok": True}


# ---------- manual mapping and context answers ----------
class Manual(BaseModel): control_id: int; impact: str = "possible"; rationale: str = ""
class Ans(BaseModel): answers: dict
RE_PROMPT = """Re-assess ONE policy change against ONE control using the reviewer's answers. Use only the supplied text; no outside law; never claim compliance certification.
Return JSON: {"impact":"confirmed|possible","rationale":str,"missing_context":[str],"remediation":[str]}
CHANGE: %s
CONTROL: %s
REVIEWER ANSWERS: %s"""
def ctl(aid, cid):
    r = q("SELECT data FROM snaps WHERE aid=? AND cid=?", (aid, cid))
    return json.loads(r[0]["data"]) if r else q("SELECT * FROM controls WHERE id=?", (cid,))[0]
@app.post("/api/changes/{cid}/mappings")
def manual_map(cid: int, r: Manual):
    c, k = q("SELECT * FROM changes WHERE id=?", (cid,)), q("SELECT * FROM controls WHERE id=? AND active=1", (r.control_id,))
    if not c or not k: raise HTTPException(404, "Change or control not found")
    c, k = c[0], k[0]
    if q("SELECT id FROM mappings WHERE change_id=? AND control_id=?", (cid, k["id"])): raise HTTPException(400, "A mapping to this control already exists.")
    ex("INSERT OR IGNORE INTO snaps VALUES(?,?,?)", (c["aid"], k["id"], json.dumps(k)))
    nd = q("SELECT d.* FROM docs d JOIN assessments a ON a.new_doc=d.id WHERE a.id=?", (c["aid"],))[0]
    det = stale_ev(k, nd.get("effective_date") or nd["ts"][:10])
    i = ex("INSERT INTO mappings(aid,change_id,control_id,cfp,impact,rationale,outdated,outdated_reason,questions,suggested,source,decision,note) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)",
           (c["aid"], cid, k["id"], fp(k), r.impact if r.impact in ("confirmed", "possible") else "possible", r.rationale or "Added manually by reviewer.", int(bool(det)), det, "[]", "[]", "manual", "corrected", "Added manually by reviewer"))
    log("mapping_added_manually", f"change {cid} -> control {k['id']} ({r.impact})"); return {"id": i}
@app.post("/api/mappings/{mid}/answers")
def answers(mid: int, r: Ans):
    m = mapping(mid); ex("UPDATE mappings SET answers=? WHERE id=?", (json.dumps(r.answers), mid))
    log("context_provided", f"mapping {mid}, answer_count {len(r.answers)}")
    if not KEY: return {"ok": True, "reanalyzed": False}
    c = q("SELECT * FROM changes WHERE id=?", (m["change_id"],))[0]
    try:
        x, run_id = gemini(RE_PROMPT % (json.dumps(dict(old=c["old_text"], new=c["new_text"])), json.dumps(ctl(m["aid"], m["control_id"])), json.dumps(r.answers)), operation="mapping_reanalysis", assessment_id=m["aid"], mapping_id=mid)
    except AIWorkflowError as e:
        raise HTTPException(502, f"Answers saved, but Gemini re-analysis failed ({e.category}; run {e.run_id}).")
    imp = x.get("impact") if x.get("impact") in ("confirmed", "possible") else m["impact"]
    ex("UPDATE mappings SET impact=?,rationale=?,questions=?,suggested=?,decision='pending' WHERE id=?", (imp, x.get("rationale", m["rationale"]), json.dumps(x.get("missing_context", [])), json.dumps(x.get("remediation", [])), mid))
    log("mapping_reanalyzed", f"mapping {mid}: impact {m['impact']} -> {imp}; returned to pending review", "system")
    structured_log("ai.mapping.reanalysis.completed", run_id=run_id, assessment_id=m["aid"], mapping_id=mid,
                   impact_before=m["impact"], impact_after=imp, missing_context_count=len(x.get("missing_context", [])),
                   remediation_count=len(x.get("remediation", [])))
    return {"ok": True, "reanalyzed": True}
