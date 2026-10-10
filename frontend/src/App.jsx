import { useCallback, useEffect, useState } from 'react'
import * as Tabs from '@radix-ui/react-tabs'
import * as Tooltip from '@radix-ui/react-tooltip'
import { Activity, ArrowUpRight, ClipboardList, FileCheck2, FileText, History, LoaderCircle, Shield, ShieldCheck } from 'lucide-react'
import { api } from './lib/api'
import Inputs from './components/Inputs'
import Assessment from './components/Assessment'
import Report from './components/Report'
import Audit from './components/Audit'

const navigation = [
  { id: 'inputs', label: 'Policy inputs', icon: ClipboardList },
  { id: 'assessment', label: 'Assessment', icon: FileCheck2 },
  { id: 'report', label: 'Impact report', icon: FileText },
  { id: 'audit', label: 'Audit history', icon: History },
]

export default function App() {
  const [tab, setTab] = useState('inputs')
  const [docs, setDocs] = useState([])
  const [controls, setControls] = useState([])
  const [assessments, setAssessments] = useState([])
  const [data, setData] = useState(null)
  const [assessmentId, setAssessmentId] = useState(null)
  const [audit, setAudit] = useState([])
  const [feedback, setFeedback] = useState({ type: '', message: '' })
  const [busy, setBusy] = useState(false)
  const [initialLoading, setInitialLoading] = useState(true)
  const [operationLabel, setOperationLabel] = useState('Updating workspace…')

  const load = useCallback(async selectedId => {
    const [documents, register, history, auditEntries] = await Promise.all([
      api('/documents'), api('/controls'), api('/assessments'), api('/audit'),
    ])
    setDocs(documents)
    setControls(register)
    setAssessments(history)
    setAudit(auditEntries)
    const id = selectedId ?? assessmentId ?? history[0]?.id
    if (id) {
      setAssessmentId(id)
      try { setData(await api('/assessments/' + id)) } catch { setData(null) }
    } else {
      setAssessmentId(null)
      setData(null)
    }
  }, [assessmentId])

  useEffect(() => {
    load().catch(e => setFeedback({ type: 'error', message: e.message })).finally(() => setInitialLoading(false))
  }, [])

  const run = async (operation, { successMessage = 'Changes saved successfully.', label = 'Updating workspace…', refresh = true } = {}) => {
    setFeedback({ type: '', message: '' })
    setBusy(true)
    setOperationLabel(label)
    try {
      const result = await operation()
      if (result?.warning) setFeedback({ type: 'warning', message: result.warning })
      if (refresh) await load(result?.id && result.warning !== undefined ? result.id : undefined)
      if (result?.id && result.warning !== undefined) setTab('assessment')
      if (!result?.warning) setFeedback({ type: 'success', message: successMessage })
      return result
    } catch (e) {
      setFeedback({ type: 'error', message: e.message })
    } finally {
      setBusy(false)
    }
  }

  const selectAssessment = async id => {
    setBusy(true)
    setOperationLabel('Loading assessment…')
    try { await load(id) } catch (e) { setFeedback({ type: 'error', message: e.message }) }
    finally { setBusy(false) }
  }

  return <Tooltip.Provider delayDuration={250}><Tabs.Root className="tabs-root" value={tab} onValueChange={setTab}>
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="#inputs" onClick={() => setTab('inputs')}>
          <span className="brand-mark"><Shield size={21} /></span>
          <span><b>Policywise</b><small>CHANGE INTELLIGENCE</small></span>
        </a>
        <div className="workspace-label">WORKSPACE</div>
        <Tabs.List className="side-nav" aria-label="Workspace sections">
          {navigation.map(({ id, label, icon: Icon }) => <Tabs.Trigger key={id} className="nav-item" value={id}>
            <Icon size={18} strokeWidth={1.8} /><span>{label}</span>{tab === id && <span className="nav-active-indicator" />}
          </Tabs.Trigger>)}
        </Tabs.List>
        <div className="sidebar-spacer" />
        <div className="sidebar-callout"><div className="callout-icon"><ShieldCheck size={18} /></div><b>Grounded in your policies</b><p>Find what changed and understand which controls need attention.</p><span>Evidence-first analysis <ArrowUpRight size={13} /></span></div>
        <div className="sidebar-footer"><span className="avatar">PA</span><span><b>Policy analyst</b><small>Local workspace</small></span><Activity size={15} /></div>
      </aside>
      <div className="main-shell">
        <header className="topbar"><div className="mobile-brand"><span className="brand-mark"><Shield size={18} /></span><b>Policywise</b></div><div className="breadcrumb">Workspace <span>/</span> <b>{navigation.find(item => item.id === tab)?.label}</b></div><div className="topbar-status"><span className={'connection-dot ' + (busy ? 'is-busy' : '')} />{busy ? <><LoaderCircle className="spin" size={15} /> {operationLabel}</> : 'All changes saved'}</div></header>
          <Tabs.List className="mobile-tabs" aria-label="Workspace sections">{navigation.map(({ id, label, icon: Icon }) => <Tabs.Trigger key={id} className="mobile-tab" value={id}><Icon size={16} /><span>{label}</span></Tabs.Trigger>)}</Tabs.List>
          <main className="main-content">
            {busy && <div className="loading-banner" role="status"><LoaderCircle size={16} className="spin" />{operationLabel}</div>}
            <div className="page-alerts" aria-live="polite">{feedback.message && <div className={'feedback-banner feedback-' + feedback.type} role={feedback.type === 'error' ? 'alert' : 'status'}><b>{feedback.type === 'success' ? 'Success' : feedback.type === 'warning' ? 'Please review' : 'Something needs attention'}</b><span>{feedback.message}</span><button aria-label="Dismiss message" onClick={() => setFeedback({ type: '', message: '' })}>×</button></div>}</div>
            {initialLoading ? <div className="initial-loading panel" role="status"><LoaderCircle size={22} className="spin" /><b>Loading your policy workspace</b><span>Gathering your policies, controls, and assessment history…</span></div> : <>
              <Tabs.Content className="tab-panel" value="inputs"><Inputs run={run} docs={docs} controls={controls} busy={busy} /></Tabs.Content>
              <Tabs.Content className="tab-panel" value="assessment"><Assessment run={run} controls={controls} data={data} list={assessments} pick={selectAssessment} busy={busy} /></Tabs.Content>
              <Tabs.Content className="tab-panel" value="report"><Report assessmentId={assessmentId} assessmentData={data} run={run} busy={busy} /></Tabs.Content>
              <Tabs.Content className="tab-panel" value="audit"><Audit entries={audit} /></Tabs.Content>
            </>}
            <footer className="app-footer"><span>Policywise · Policy Change Impact</span><Tooltip.Root><Tooltip.Trigger asChild><span className="disclaimer">For decision support only <span aria-hidden="true">ⓘ</span></span></Tooltip.Trigger><Tooltip.Portal><Tooltip.Content className="tooltip-content" side="top">Assesses only against the supplied policy. This is not a compliance certification.<Tooltip.Arrow className="tooltip-arrow" /></Tooltip.Content></Tooltip.Portal></Tooltip.Root></footer>
          </main>
      </div>
    </div>
  </Tabs.Root></Tooltip.Provider>
}