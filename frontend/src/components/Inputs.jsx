import { useState } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Plus, Pencil, Trash2, X, Upload, FileText, ShieldCheck } from 'lucide-react'
import { api, EMPTY_CONTROL, CONTROL_STATUSES } from '../lib/api'

function ControlDialog({ control, onSave, onClose, busy }) {
  const [form, setForm] = useState(control || EMPTY_CONTROL)
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }))
  return <Dialog.Root open onOpenChange={open => !open && onClose()}>
    <Dialog.Portal>
      <Dialog.Overlay className="dialog-overlay" />
      <Dialog.Content className="dialog-content">
        <div className="dialog-heading"><div><span className="eyebrow">CONTROL REGISTER</span><Dialog.Title>{control ? 'Edit control' : 'Add a control'}</Dialog.Title><Dialog.Description>Keep ownership and evidence current for a more useful impact assessment.</Dialog.Description></div><Dialog.Close className="icon-button" aria-label="Close"><X size={18} /></Dialog.Close></div>
        <div className="form-grid">
          <label>Reference<input autoFocus required maxLength={40} placeholder="e.g. GOV-01" value={form.ref} onChange={e => set('ref', e.target.value)} /></label>
          <label>Control name<input required maxLength={160} placeholder="e.g. Access review" value={form.name} onChange={e => set('name', e.target.value)} /></label>
          <label>Owner<input placeholder="Team or person" value={form.owner} onChange={e => set('owner', e.target.value)} /></label>
          <label>Evidence date<input type="date" value={form.evidence_date} onChange={e => set('evidence_date', e.target.value)} /></label>
          <label className="span-two">Current evidence<input placeholder="Link, ticket, or evidence summary" value={form.evidence} onChange={e => set('evidence', e.target.value)} /></label>
          <label className="span-two">Description / scope<textarea className="short-textarea" placeholder="What does this control cover?" value={form.description} onChange={e => set('description', e.target.value)} /></label>
          <label>Status<select value={form.status} onChange={e => set('status', e.target.value)}>{CONTROL_STATUSES.map(status => <option key={status}>{status}</option>)}</select></label>
        </div>
        <div className="dialog-actions"><Dialog.Close className="button button-quiet">Cancel</Dialog.Close><button className="button button-primary" disabled={!form.ref.trim() || !form.name.trim() || busy} onClick={() => onSave(form)}>{busy ? 'Saving…' : control ? 'Save changes' : 'Add control'}</button></div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
}

function PolicyCard({ kind, docs, run, busy }) {
  const [name, setName] = useState('')
  const [text, setText] = useState('')
  const [effectiveDate, setEffectiveDate] = useState('')
  const version = docs.find(doc => doc.kind === kind)?.version
  const isNew = kind === 'new'
  const save = async () => {
    const result = await run(() => api('/documents', 'POST', { kind, name, text, effective_date: isNew ? effectiveDate : '' }), { successMessage: 'Policy version saved.' })
    if (!result) return
    setText('')
  }
  return <section className="policy-card">
    <div className="policy-card-heading"><div className={'policy-icon ' + (isNew ? 'violet' : 'blue')}><FileText size={18} /></div><div><h3>{isNew ? 'Updated policy' : 'Previous policy'}</h3><p>{version ? `Current version · v${version}` : 'No version added yet'}</p></div></div>
    <label className="field-label">Policy name<input maxLength={160} placeholder={isNew ? 'e.g. Information security policy' : 'e.g. Policy v1'} value={name} onChange={e => setName(e.target.value)} /></label>
    {isNew && <label className="field-label">Effective date<input type="date" value={effectiveDate} onChange={e => setEffectiveDate(e.target.value)} /><small>Evidence dated before this date may be flagged as outdated.</small></label>}
    <label className="field-label">Policy text<textarea required maxLength={500000} placeholder="Paste policy clauses here. Number clauses (1, 1.1, 2.1 …) for precise change references." value={text} onChange={e => setText(e.target.value)} /></label>
    <button className="button button-primary" disabled={!text.trim() || busy} onClick={save}><Upload size={15} /> {busy ? 'Saving…' : 'Save as new version'}</button>
  </section>
}

export default function Inputs({ run, docs, controls, busy = false }) {
  const [editing, setEditing] = useState(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const saveControl = async form => {
    const result = await run(() => editing ? api('/controls/' + editing.id, 'PUT', form) : api('/controls', 'POST', form), { successMessage: editing ? 'Control updated.' : 'Control added.' })
    if (!result) return
    setDialogOpen(false)
    setEditing(null)
  }
  const editControl = control => { setEditing(control); setDialogOpen(true) }
  const addControl = () => { setEditing(null); setDialogOpen(true) }
  return <div className="page-stack">
    <section className="section-heading"><div><span className="eyebrow">WORKSPACE SETUP</span><h2>Policy inputs</h2><p>Add both policy versions and your control register to prepare an assessment.</p></div><button className="button button-quiet" disabled={busy} onClick={() => run(() => api('/seed', 'POST'))}><Upload size={15} /> Load sample data</button></section>
    <section className="panel"><div className="panel-heading"><div><span className="eyebrow">01 — POLICY COMPARISON</span><h3>Compare policy versions</h3><p>Changes are identified by comparing the previous and updated policy.</p></div><span className="step-badge"><FileText size={17} /></span></div>
      <div className="policy-grid"><PolicyCard kind="old" docs={docs} run={run} busy={busy} /><PolicyCard kind="new" docs={docs} run={run} busy={busy} /></div>
      <div className="version-history"><h4>Version history <span>{docs.length}</span></h4>{docs.length === 0 ? <p className="empty-inline">Saved policy versions will appear here.</p> : <div className="history-list">{docs.map(doc => <details key={doc.id} className="history-item"><summary><span className="history-dot" /><b>{doc.kind === 'old' ? 'Previous' : 'Updated'} · v{doc.version}</b><span>{doc.name || 'Unnamed policy'}</span><time>{doc.ts}</time></summary><pre>{doc.text}</pre></details>)}</div>}</div>
    </section>
    <section className="panel"><div className="panel-heading register-heading"><div><span className="eyebrow">02 — GOVERNANCE</span><h3>Control register</h3><p>Controls and their evidence are used to assess policy impact.</p></div><button className="button button-primary" disabled={busy} onClick={addControl}><Plus size={16} /> Add control</button></div>
      {controls.length === 0 ? <div className="empty-state"><div className="empty-icon"><ShieldCheck size={22} /></div><h4>No controls added</h4><p>Build your register by adding controls, owners, and current evidence.</p><button className="button button-primary" disabled={busy} onClick={addControl}><Plus size={16} /> Add your first control</button></div> : <div className="table-wrap"><table className="data-table"><thead><tr><th>CONTROL</th><th>OWNER</th><th>CURRENT EVIDENCE</th><th>STATUS</th><th aria-label="Actions" /></tr></thead><tbody>{controls.map(control => <tr key={control.id}><td><div className="control-title"><strong>{control.ref} · {control.name}</strong><span>{control.description || 'No description provided'}</span></div></td><td>{control.owner || <span className="muted">Unassigned</span>}</td><td><div className="evidence-cell">{control.evidence || <span className="muted">No evidence</span>}<small>{control.evidence_date || 'Undated'}</small></div></td><td><span className={'status-pill status-' + control.status.toLowerCase().replaceAll(' ', '-')}>{control.status}</span></td><td><div className="table-actions"><button className="icon-button" title="Edit control" disabled={busy} onClick={() => editControl(control)}><Pencil size={15} /></button><button className="icon-button danger-icon" title="Remove control" disabled={busy} onClick={() => run(() => api('/controls/' + control.id, 'DELETE'))}><Trash2 size={15} /></button></div></td></tr>)}</tbody></table></div>}
    </section>
    {dialogOpen && <ControlDialog key={editing?.id || 'new'} control={editing} onSave={saveControl} onClose={() => { setDialogOpen(false); setEditing(null) }} busy={busy} />}
  </div>
}
