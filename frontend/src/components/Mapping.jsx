import { useState } from 'react'
import { api, today } from '../lib/api'

export function Mapping({ mapping, controls, run, busy = false }) {
  const [note, setNote] = useState('')
  const [editing, setEditing] = useState(false)
  const [controlId, setControlId] = useState(mapping.control_id)
  const [impact, setImpact] = useState(mapping.impact)
  const [risk, setRisk] = useState({ reason: '', review_date: '' })
  const [action, setAction] = useState({ text: '', owner: '' })
  const [answers, setAnswers] = useState(mapping.answers || {})
  const [custom, setCustom] = useState('')
  const approved = mapping.decision === 'accepted' || mapping.decision === 'corrected'
  const review = (decision, extra = {}) => run(() => api(`/mappings/${mapping.id}/review`, 'POST', { decision, note, ...extra }))
  return <div className="mapping-card">
    <div className="mapping-topline"><div className="mapping-title"><span className="control-ref">{mapping.control.ref}</span><b>{mapping.control.name}</b></div><div className="mapping-badges"><span className={'tag tag-' + mapping.impact}>{mapping.impact} impact</span><span className={'tag tag-' + mapping.decision}>{mapping.decision}</span>{mapping.outdated && <span className="tag tag-warning">Evidence may be outdated</span>}</div></div>
    <p className="mapping-rationale">{mapping.rationale}</p>
    {mapping.outdated && <div className="notice notice-warning">Outdated evidence: {mapping.outdated_reason}</div>}
    <div className="mapping-meta">Owner: <b>{mapping.control.owner || 'Unassigned'}</b><span /> Evidence: <b>{mapping.control.evidence || 'None'}</b><span /> Date: <b>{mapping.control.evidence_date || 'Undated'}</b></div>
    {mapping.risk_reason && <div className={'notice ' + (mapping.risk_review < today ? 'notice-warning' : 'notice-success')}>Risk accepted until {mapping.risk_review}{mapping.risk_review < today ? ' · overdue for review' : ''}: {mapping.risk_reason}</div>}
    {mapping.questions.length > 0 && <div className="question-box"><b>More context needed</b><p>Answer these questions to re-analyze this mapping.</p>{mapping.questions.map((question, index) => <label key={index}>{question}<input placeholder="Add a short answer" value={answers[question] || ''} onChange={e => setAnswers({ ...answers, [question]: e.target.value })} /></label>)}<button className="button button-quiet" disabled={busy} onClick={() => run(() => api(`/mappings/${mapping.id}/answers`, 'POST', { answers }), { label: 'Re-analyzing mapping…', successMessage: 'Context saved and mapping re-analyzed.' })}>Save answers &amp; re-analyze</button></div>}
    {mapping.note && <p className="review-note">Reviewer note: {mapping.note}</p>}
    <div className="review-controls"><input className="review-note-input" placeholder="Reviewer note (required to reject)" value={note} onChange={e => setNote(e.target.value)} /><button className="button button-primary" disabled={busy} onClick={() => review('accepted')}>Accept</button><button className="button button-danger" disabled={busy || !note.trim()} title={!note.trim() ? 'Add a reviewer note before rejecting' : ''} onClick={() => review('rejected')}>Reject</button><button className="button button-quiet" disabled={busy} onClick={() => setEditing(!editing)}>{editing ? 'Cancel correction' : 'Correct mapping'}</button></div>
    {editing && <div className="inline-editor"><select value={controlId} onChange={e => setControlId(+e.target.value)}>{controls.map(control => <option key={control.id} value={control.id}>{control.ref} · {control.name}</option>)}</select><select value={impact} onChange={e => setImpact(e.target.value)}><option>confirmed</option><option>possible</option></select><button className="button button-primary" disabled={busy} onClick={() => review('corrected', { control_id: controlId, impact })}>Save correction</button></div>}
    {mapping.decision !== 'rejected' && <div className="remediation-section"><h4>Remediation actions <span>{mapping.actions.length}</span></h4>{mapping.actions.map(item => <div className="action-row" key={item.id}><span className="action-name">{item.text}</span><input aria-label="Action owner" defaultValue={item.owner} placeholder="Owner" onBlur={e => e.target.value !== item.owner && run(() => api('/actions/' + item.id, 'PUT', { ...item, owner: e.target.value }))} /><select aria-label="Action status" value={item.status} onChange={e => run(() => api('/actions/' + item.id, 'PUT', { ...item, status: e.target.value }))}>{['Open', 'In progress', 'Done'].map(status => <option key={status}>{status}</option>)}</select></div>)}
      {approved && mapping.suggested.map((suggestion, index) => <div className="action-row suggested-row" key={index}><span className="action-name"><small>Suggested</small>{suggestion}</span><input placeholder="Owner" onChange={e => setAction({ text: suggestion, owner: e.target.value })} /><button className="button button-quiet" onClick={() => run(() => api(`/mappings/${mapping.id}/actions`, 'POST', { text: suggestion, owner: action.text === suggestion ? action.owner : mapping.control.owner }))}>Approve</button></div>)}
      {approved && <div className="add-action-row"><input placeholder="Add a remediation action" value={custom} onChange={e => setCustom(e.target.value)} /><button className="button button-quiet" disabled={!custom.trim()} onClick={() => run(() => api(`/mappings/${mapping.id}/actions`, 'POST', { text: custom, owner: mapping.control.owner })).then(() => setCustom(''))}>Add action</button></div>}
      {!approved && <p className="empty-inline">Accept or correct this mapping before approving remediation actions.</p>}
      {mapping.risk_reason ? <button className="text-button" onClick={() => run(() => api(`/mappings/${mapping.id}/risk`, 'DELETE'))}>Withdraw risk acceptance</button> : <div className="risk-row"><input placeholder="Risk acceptance reason" value={risk.reason} onChange={e => setRisk({ ...risk, reason: e.target.value })} /><input aria-label="Risk review date" type="date" value={risk.review_date} onChange={e => setRisk({ ...risk, review_date: e.target.value })} /><button className="button button-quiet" onClick={() => run(() => api(`/mappings/${mapping.id}/risk`, 'POST', risk))}>Accept risk</button></div>}
    </div>}
  </div>
}

export function AddMapping({ change, controls, run, busy = false }) {
  const [open, setOpen] = useState(false)
  const [controlId, setControlId] = useState('')
  const [impact, setImpact] = useState('possible')
  const [reason, setReason] = useState('')
  if (!open) return <button className="button button-quiet add-mapping-trigger" disabled={busy || controls.length === 0} onClick={() => setOpen(true)}>+ Map a control manually</button>
  return <div className="manual-map-form"><select value={controlId || controls[0]?.id} onChange={e => setControlId(e.target.value)}>{controls.map(control => <option key={control.id} value={control.id}>{control.ref} · {control.name}</option>)}</select><select value={impact} onChange={e => setImpact(e.target.value)}><option>confirmed</option><option>possible</option></select><input placeholder="Why is this control affected?" value={reason} onChange={e => setReason(e.target.value)} /><button className="button button-primary" disabled={busy || !reason.trim()} onClick={() => run(() => api(`/changes/${change.id}/mappings`, 'POST', { control_id: +(controlId || controls[0]?.id), impact, rationale: reason })).then(() => setOpen(false))}>Add mapping</button><button className="button button-quiet" disabled={busy} onClick={() => setOpen(false)}>Cancel</button></div>
}
