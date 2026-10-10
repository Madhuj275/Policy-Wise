import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'

const PAGE = { width: 595.28, height: 841.89, left: 48, right: 48, top: 54, bottom: 58 }
const COLORS = {
  ink: [31, 48, 62], muted: [101, 117, 131], teal: [39, 119, 106], pale: [241, 247, 245],
  line: [224, 231, 235], old: [159, 91, 92], oldBg: [253, 246, 246], new: [63, 126, 92], newBg: [244, 250, 246],
  amber: [151, 106, 36], amberBg: [255, 249, 235], purple: [111, 82, 171], purpleBg: [248, 245, 253],
}

const clean = value => String(value ?? '').trim() || '—'
const safeFilenamePart = value => String(value || 'policy').normalize('NFKD').replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'policy'

export function createImpactReportPdf(data) {
  if (!data?.assessment || !data?.summary) throw new Error('Assessment data is required to create the PDF report.')

  const pdf = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const { assessment, summary, changes = [], old_doc: oldDoc = {}, new_doc: newDoc = {} } = data
  const width = pdf.internal.pageSize.getWidth()
  const contentWidth = width - PAGE.left - PAGE.right
  let y = 0

  const newPage = () => {
    pdf.addPage()
    y = PAGE.top
  }
  const ensure = height => {
    if (y + height > PAGE.height - PAGE.bottom) newPage()
  }
  const textLines = (value, size, font = 'normal', maxWidth = contentWidth) => {
    pdf.setFont('helvetica', font)
    pdf.setFontSize(size)
    return pdf.splitTextToSize(clean(value), maxWidth)
  }
  const paragraph = (value, { size = 9, color = COLORS.ink, font = 'normal', lineHeight = size * 1.5, gap = 7, indent = 0 } = {}) => {
    const lines = textLines(value, size, font, contentWidth - indent)
    pdf.setFont('helvetica', font)
    pdf.setFontSize(size)
    pdf.setTextColor(...color)
    let cursor = 0
    while (cursor < lines.length) {
      if (y + lineHeight > PAGE.height - PAGE.bottom) newPage()
      const capacity = Math.max(1, Math.floor((PAGE.height - PAGE.bottom - y) / lineHeight))
      const slice = lines.slice(cursor, cursor + capacity)
      pdf.text(slice, PAGE.left + indent, y, { lineHeightFactor: lineHeight / size })
      y += slice.length * lineHeight
      cursor += slice.length
    }
    y += gap
  }
  const heading = (label, title) => {
    ensure(34)
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(8)
    pdf.setTextColor(...COLORS.teal)
    pdf.text(label.toUpperCase(), PAGE.left, y)
    y += 15
    pdf.setFontSize(14)
    pdf.setTextColor(...COLORS.ink)
    pdf.text(title, PAGE.left, y)
    y += 12
    pdf.setDrawColor(...COLORS.line)
    pdf.line(PAGE.left, y, width - PAGE.right, y)
    y += 13
  }
  const block = (label, content, tone = 'neutral') => {
    const tones = tone === 'old' ? [COLORS.old, COLORS.oldBg] : tone === 'new' ? [COLORS.new, COLORS.newBg] : tone === 'warning' ? [COLORS.amber, COLORS.amberBg] : tone === 'question' ? [COLORS.purple, COLORS.purpleBg] : [COLORS.muted, [248, 250, 251]]
    const lines = textLines(content, 9)
    const lineHeight = 13
    const labelHeight = 22
    let cursor = 0
    while (cursor < lines.length || (lines.length === 0 && cursor === 0)) {
      if (y + labelHeight + lineHeight > PAGE.height - PAGE.bottom) newPage()
      const capacity = Math.max(1, Math.floor((PAGE.height - PAGE.bottom - y - labelHeight - 9) / lineHeight))
      const slice = lines.slice(cursor, cursor + capacity)
      const boxHeight = labelHeight + Math.max(lineHeight, slice.length * lineHeight) + 10
      pdf.setFillColor(...tones[1])
      pdf.roundedRect(PAGE.left, y, contentWidth, boxHeight, 5, 5, 'F')
      pdf.setFont('helvetica', 'bold')
      pdf.setFontSize(7)
      pdf.setTextColor(...tones[0])
      pdf.text(label.toUpperCase(), PAGE.left + 11, y + 14)
      pdf.setFont('helvetica', 'normal')
      pdf.setFontSize(9)
      pdf.setTextColor(...COLORS.ink)
      if (slice.length) pdf.text(slice, PAGE.left + 11, y + labelHeight, { lineHeightFactor: lineHeight / 9 })
      y += boxHeight + 7
      cursor += slice.length
      if (!lines.length) break
    }
  }

  // Cover band and report identity.
  pdf.setFillColor(23, 43, 58)
  pdf.rect(0, 0, width, 188, 'F')
  pdf.setFillColor(53, 146, 126)
  pdf.roundedRect(PAGE.left, 34, 34, 34, 8, 8, 'F')
  pdf.setDrawColor(236, 255, 249)
  pdf.setLineWidth(1.8)
  pdf.line(PAGE.left + 17, 42, PAGE.left + 17, 58)
  pdf.line(PAGE.left + 17, 42, PAGE.left + 24, 45)
  pdf.line(PAGE.left + 24, 45, PAGE.left + 24, 55)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(11)
  pdf.setTextColor(255, 255, 255)
  pdf.text('POLICYWISE', PAGE.left + 44, 49)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(7)
  pdf.setTextColor(174, 195, 202)
  pdf.text('POLICY CHANGE INTELLIGENCE', PAGE.left + 44, 62)
  pdf.setFont('helvetica', 'bold')
  pdf.setFontSize(22)
  pdf.setTextColor(255, 255, 255)
  pdf.text('Policy change impact', PAGE.left, 111)
  pdf.text('report', PAGE.left, 138)
  pdf.setFont('helvetica', 'normal')
  pdf.setFontSize(9)
  pdf.setTextColor(205, 219, 221)
  pdf.text(`Assessment v${assessment.version}  ·  ${clean(assessment.ts)}`, PAGE.left, 164)
  y = 211

  paragraph(`${clean(oldDoc.name)} v${oldDoc.version ?? '—'}  →  ${clean(newDoc.name)} v${newDoc.version ?? '—'}`, { size: 12, color: COLORS.ink, font: 'bold', gap: 4 })
  paragraph(`Control register version ${clean(assessment.ctrl_ver)}  ·  Analysis mode: ${clean(assessment.mode)}`, { size: 8, color: COLORS.muted, gap: 12 })
  block('Important scope', 'This report assesses impact only against the supplied policy text and control register. It is not a formal compliance certification.', 'neutral')
  if (data.stale) block('Review required', `This assessment may be stale. ${(data.stale_reasons || []).join(' ') || 'Re-run the assessment before relying on these findings.'}`, 'warning')
  if (summary.pending_review) block('Pending review', `${summary.pending_review} mapping(s) still need a reviewer decision.`, 'warning')

  heading('At a glance', 'Assessment summary')
  const metrics = [
    ['Policy changes', summary.changes], ['Changes mapped', summary.mapped], ['Unmapped changes', summary.unmapped],
    ['Compliant', summary.compliant], ['Unresolved', summary.unresolved], ['Pending review', summary.pending_review],
    ['Risk accepted', summary.risk_accepted], ['Risk overdue', summary.risk_overdue], ['Rejected mappings', summary.rejected],
  ]
  autoTable(pdf, {
    startY: y,
    head: [['MEASURE', 'COUNT', 'MEASURE', 'COUNT']],
    body: Array.from({ length: Math.ceil(metrics.length / 2) }, (_, index) => {
      const left = metrics[index * 2] || ['', '']
      const right = metrics[index * 2 + 1] || ['', '']
      return [left[0], String(left[1] ?? 0), right[0], String(right[1] ?? 0)]
    }),
    theme: 'grid', margin: { left: PAGE.left, right: PAGE.right },
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 7, textColor: COLORS.ink, lineColor: COLORS.line, lineWidth: 0.5 },
    headStyles: { fillColor: [34, 76, 83], textColor: 255, fontStyle: 'bold', fontSize: 7 },
    columnStyles: { 1: { halign: 'center', fontStyle: 'bold', cellWidth: 55 }, 3: { halign: 'center', fontStyle: 'bold', cellWidth: 55 } },
    alternateRowStyles: { fillColor: [249, 251, 252] },
  })
  y = pdf.lastAutoTable.finalY + 22

  heading('Detailed findings', `Policy changes (${changes.length})`)
  if (!changes.length) paragraph('No policy changes were identified for this assessment.', { color: COLORS.muted })
  changes.forEach((change, index) => {
    ensure(55)
    const changeTitle = `${String(change.kind || 'change').toUpperCase()}  ·  Old ${clean(change.old_sec)}  →  New ${clean(change.new_sec)}`
    pdf.setFillColor(...COLORS.pale)
    pdf.roundedRect(PAGE.left, y - 4, contentWidth, 25, 5, 5, 'F')
    pdf.setFont('helvetica', 'bold')
    pdf.setFontSize(9)
    pdf.setTextColor(...COLORS.ink)
    pdf.text(`${String(index + 1).padStart(2, '0')}   ${changeTitle}`, PAGE.left + 10, y + 12)
    y += 32
    block('Previous policy text', change.old_text || '(No previous text)', 'old')
    block('Updated policy text', change.new_text || '(No updated text)', 'new')
    if (!change.mappings?.length) block('Control mapping', 'No affected controls were identified. This change is currently unmapped.', 'warning')
    ;(change.mappings || []).forEach(mapping => {
      const control = mapping.control || {}
      block(`Control · ${clean(control.ref)} ${clean(control.name)} · ${clean(mapping.impact)} impact · ${clean(mapping.decision)}`, `Owner: ${clean(control.owner || 'Unassigned')}\nRationale: ${clean(mapping.rationale)}`, 'neutral')
      if (mapping.outdated) block('Evidence may be outdated', mapping.outdated_reason || 'Review the evidence date and coverage.', 'warning')
      if (mapping.note) block('Reviewer note', mapping.note, 'neutral')
      Object.entries(mapping.answers || {}).forEach(([question, answer]) => {
        if (answer) block('Reviewer context', `${question}\nAnswer: ${answer}`, 'question')
      })
      ;(mapping.questions || []).forEach(question => block('Open question', question, 'question'))
      ;(mapping.actions || []).forEach(action => block(`Remediation · ${clean(action.status)}`, `${clean(action.text)}\nOwner: ${clean(action.owner || 'Unassigned')}`, 'new'))
      if (mapping.risk_reason) block(`Risk acceptance · review ${clean(mapping.risk_review)}`, mapping.risk_reason, 'warning')
    })
    y += 7
  })

  const pageCount = pdf.internal.getNumberOfPages()
  for (let page = 1; page <= pageCount; page += 1) {
    pdf.setPage(page)
    pdf.setDrawColor(...COLORS.line)
    pdf.line(PAGE.left, PAGE.height - 38, width - PAGE.right, PAGE.height - 38)
    pdf.setFont('helvetica', 'normal')
    pdf.setFontSize(7)
    pdf.setTextColor(...COLORS.muted)
    pdf.text('POLICYWISE  ·  Decision support only', PAGE.left, PAGE.height - 23)
    pdf.text(`Assessment v${assessment.version}  ·  Page ${page} of ${pageCount}`, width - PAGE.right, PAGE.height - 23, { align: 'right' })
  }

  const filename = `policy-impact-${safeFilenamePart(newDoc.name)}-assessment-v${assessment.version || 1}.pdf`
  return { pdf, filename }
}
