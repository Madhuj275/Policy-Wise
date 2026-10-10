import { useEffect, useState } from 'react'
import { Download, FileCheck2, FileText, LoaderCircle, RefreshCw } from 'lucide-react'
import { createImpactReportPdf } from '../lib/impactReportPdf'

export default function Report({ assessmentId, assessmentData, run, busy }) {
  const [pdfUrl, setPdfUrl] = useState('')
  const [previewDataKey, setPreviewDataKey] = useState('')
  const [filename, setFilename] = useState('policy-impact-report.pdf')
  const [localMessage, setLocalMessage] = useState('')
  const [localError, setLocalError] = useState('')
  const dataKey = JSON.stringify(assessmentData || null)
  const hasAssessment = Boolean(assessmentId && assessmentData?.assessment && assessmentData?.summary)
  const hasCurrentPreview = Boolean(pdfUrl && previewDataKey === dataKey)

  useEffect(() => {
    setPdfUrl('')
    setPreviewDataKey('')
    setFilename(`policy-impact-assessment-v${assessmentData?.assessment?.version || 1}.pdf`)
    setLocalMessage('')
    setLocalError('')
  }, [assessmentId, dataKey])

  useEffect(() => () => {
    if (pdfUrl) URL.revokeObjectURL(pdfUrl)
  }, [pdfUrl])

  const createPreview = () => run(async () => {
    setLocalError('')
    setLocalMessage('')
    if (!hasAssessment) throw new Error('Run an assessment before creating its PDF report.')
    const { pdf, filename: pdfFilename } = createImpactReportPdf(assessmentData)
    const nextUrl = URL.createObjectURL(pdf.output('blob'))
    setPdfUrl(nextUrl)
    setPreviewDataKey(dataKey)
    setFilename(pdfFilename)
    return { filename: pdfFilename }
  }, { successMessage: 'The PDF preview is ready.', label: 'Preparing PDF preview…', refresh: false })
    .then(result => {
      if (!result) setLocalError('The PDF preview could not be created. Please try again.')
    })
    .catch(error => setLocalError(error.message))

  const downloadPdf = () => {
    if (!hasCurrentPreview) return
    const link = document.createElement('a')
    link.href = pdfUrl
    link.download = filename
    link.click()
    setLocalMessage('PDF downloaded.')
  }

  return <div className="page-stack report-page">
    <section className="section-heading report-heading"><div><span className="eyebrow">SHAREABLE SUMMARY</span><h2>PDF impact report</h2><p>Preview and download a formatted report for the selected assessment.</p></div>
      <div className="row-actions"><button className="button button-quiet" onClick={createPreview} disabled={!hasAssessment || busy}><RefreshCw size={15} />{busy ? 'Preparing…' : hasCurrentPreview ? 'Refresh preview' : 'Create PDF preview'}</button><button className="button button-primary" onClick={downloadPdf} disabled={!hasCurrentPreview || busy}><Download size={15} /> Download PDF</button></div>
    </section>
    {!hasAssessment ? <section className="panel report-preview-empty"><div className="empty-state"><div className="empty-icon"><FileText size={22} /></div><h3>No assessment selected</h3><p>Run or select an assessment first. Its policy changes, control decisions, and remediation will appear in the PDF preview.</p></div></section> : <section className="panel pdf-preview-panel">
      <div className="pdf-preview-toolbar"><div className="pdf-file-icon"><FileText size={17} /></div><div className="pdf-file-details"><b>{filename}</b><span>Assessment v{assessmentData.assessment.version} · {assessmentData.changes?.length || 0} policy changes</span></div><span className="pdf-format-badge">PDF</span></div>
      {(localError || localMessage) && <div className={localError ? 'pdf-message pdf-message-error' : 'pdf-message'} role={localError ? 'alert' : 'status'}>{localError || localMessage}</div>}
      {hasCurrentPreview ? <iframe className="pdf-preview-frame" src={`${pdfUrl}#toolbar=1&navpanes=0&view=FitH`} title="Policy impact report PDF preview" /> : <div className="pdf-preview-placeholder"><div className="pdf-placeholder-icon"><FileCheck2 size={25} /></div><b>Your report preview will appear here</b><span>Create a PDF preview to review the formatted report before downloading.</span><button className="button button-primary" onClick={createPreview} disabled={busy}><FileText size={15} /> Create PDF preview</button></div>}
      {busy && <div className="pdf-generating"><LoaderCircle size={15} className="spin" /> Preparing your report…</div>}
    </section>}
  </div>
}
