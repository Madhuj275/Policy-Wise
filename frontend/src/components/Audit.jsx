import { Clock3 } from 'lucide-react'

export default function Audit({ entries }) {
  return <div className="page-stack">
    <section className="section-heading"><div><span className="eyebrow">TRACEABILITY</span><h2>Audit history</h2><p>A chronological record of assessment reviews and decisions.</p></div><span className="audit-count">{entries.length} events</span></section>
    <section className="panel audit-panel">{entries.length === 0 ? <div className="empty-state"><div className="empty-icon"><Clock3 size={22} /></div><h3>No activity yet</h3><p>Review decisions, risk acceptances, and changes will appear here.</p></div> : <div className="audit-list">{entries.map(entry => <article className="audit-entry" key={entry.id}><div className="audit-marker"><Clock3 size={14} /></div><time>{entry.ts}</time><div className="audit-detail"><b>{entry.event}</b><p>{entry.detail}</p></div><span className="audit-actor">{entry.actor}</span></article>)}</div>}</section>
  </div>
}
