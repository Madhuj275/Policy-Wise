import { AlertTriangle, RefreshCw, Sparkles } from 'lucide-react'
import { api } from '../lib/api'
import { AddMapping, Mapping } from './Mapping'

const metrics = [
  ['changes', 'Changes'], ['mapped', 'Mapped'], ['unmapped', 'Unmapped'], ['compliant', 'Compliant'],
  ['risk_accepted', 'Risk accepted'], ['risk_overdue', 'Risk overdue'], ['unresolved', 'Unresolved'], ['pending_review', 'Pending review'],
]

export default function Assessment({ run, controls, data, list, pick, busy = false }) {
  if (!data) return <div className="assessment-empty panel"><div className="empty-icon"><Sparkles size={23} /></div><span className="eyebrow">POLICY ANALYSIS</span><h2>Start your first assessment</h2><p>Add a previous and updated policy, then run an assessment to see which controls may be affected.</p><button className="button button-primary" disabled={busy} onClick={() => run(() => api('/assess', 'POST'), { label: 'Running assessment…', successMessage: 'Assessment completed.' })}><Sparkles size={16} /> {busy ? 'Running…' : 'Run assessment'}</button></div>
  const { summary, assessment } = data
  return <div className="page-stack">
    <section className="panel assessment-overview"><div className="assessment-toolbar"><div><span className="eyebrow">ASSESSMENT OVERVIEW</span><h2>Impact analysis</h2><div className="assessment-context"><span>{data.old_doc.name} <b>v{data.old_doc.version}</b></span><span className="context-arrow">→</span><span>{data.new_doc.name} <b>v{data.new_doc.version}</b></span><span className="context-divider" />{assessment.ts}<span className="context-divider" />Controls v{assessment.ctrl_ver}</div></div><div className="assessment-actions"><select aria-label="Choose assessment" disabled={busy} value={assessment.id} onChange={e => pick(+e.target.value)}>{list.map(item => <option key={item.id} value={item.id}>Assessment v{item.version} · {item.ts} · {item.mode}</option>)}</select><button className="button button-primary" disabled={busy} onClick={() => run(() => api('/assess', 'POST'), { label: 'Re-evaluating policy…', successMessage: 'Assessment refreshed.' })}><RefreshCw size={15} /> Re-evaluate</button></div></div>
      {data.stale && <div className="stale-banner"><AlertTriangle size={17} /><div><b>This assessment is out of date</b><span>{data.stale_reasons.join(' ')} Re-evaluate to refresh; existing review decisions are kept.</span></div></div>}
      <div className="metrics-grid">{metrics.map(([key, label]) => <div className={'metric metric-' + key} key={key}><span>{label}</span><strong>{summary[key]}</strong></div>)}</div>
    </section>
    <div className="results-heading"><div><span className="eyebrow">DETAILED FINDINGS</span><h3>Policy changes <span className="results-count">{data.changes.length}</span></h3></div><p>Review each control mapping, decision, and remediation action.</p></div>
    {data.changes.map(change => <article className="change-panel panel" key={change.id}><div className="change-heading"><div><span className={'change-kind kind-' + change.kind}>{change.kind}</span><span className="section-change">{change.old_sec || '—'} <span>→</span> {change.new_sec || '—'}</span></div><span className="change-ref">Policy clause</span></div>
      <div className="diff-grid"><div className="diff-block diff-old"><span className="diff-label">PREVIOUS TEXT <b>{change.old_sec || '—'}</b></span><p>{change.old_text || '(No previous text)'}</p></div><div className="diff-block diff-new"><span className="diff-label">UPDATED TEXT <b>{change.new_sec || '—'}</b></span><p>{change.new_text || '(No updated text)'}</p></div></div>
      {change.mappings.length === 0 && <div className="unmapped-notice"><AlertTriangle size={16} /><span>No affected controls found. Counted as unmapped; add a control or map one below if this is incorrect.</span></div>}
      <div className="mappings-list">{change.mappings.map(mapping => <Mapping key={mapping.id} mapping={mapping} controls={controls} run={run} busy={busy} />)}</div><AddMapping change={change} controls={controls} run={run} busy={busy} />
    </article>)}
  </div>
}
