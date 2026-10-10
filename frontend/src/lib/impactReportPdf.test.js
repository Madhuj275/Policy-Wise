import test from 'node:test'
import assert from 'node:assert/strict'
import { createImpactReportPdf } from './impactReportPdf.js'

const fixture = (long = false) => ({
  assessment: { version: 7, ts: '2026-10-10T12:00:00Z', ctrl_ver: 4, mode: 'gemini' },
  old_doc: { name: 'Old Security Policy', version: 2 },
  new_doc: { name: 'Updated Security Policy', version: 3 },
  stale: true,
  stale_reasons: ['The control register changed after this assessment.'],
  summary: { changes: 1, mapped: 1, unmapped: 0, compliant: 0, unresolved: 1, pending_review: 1, risk_accepted: 0, risk_overdue: 0, rejected: 0 },
  changes: [{
    id: 12,
    kind: 'modified',
    old_sec: '1.1',
    new_sec: '1.1',
    old_text: long ? 'Previous clause. '.repeat(900) : 'Access reviews happen annually.',
    new_text: 'Access reviews happen quarterly.',
    mappings: [{
      control: { ref: 'AC-1', name: 'Access review', owner: 'Security team' },
      impact: 'confirmed',
      decision: 'pending',
      rationale: 'The review frequency has changed.',
      outdated: true,
      outdated_reason: 'Evidence predates the new effective date.',
      note: 'Confirm ownership.',
      answers: { 'Who approves the review?': 'The security lead.' },
      questions: ['Is the evidence updated?'],
      actions: [{ text: 'Update the review procedure.', owner: 'Security team', status: 'Open' }],
      risk_reason: '',
      risk_review: '',
    }],
  }],
})

test('creates a named PDF with assessment metadata and pages', () => {
  const { pdf, filename } = createImpactReportPdf(fixture())
  assert.equal(filename, 'policy-impact-Updated-Security-Policy-assessment-v7.pdf')
  assert.ok(pdf.output('arraybuffer').byteLength > 1000)
  assert.ok(pdf.internal.getNumberOfPages() >= 1)
})

test('automatically paginates long policy text', () => {
  const { pdf } = createImpactReportPdf(fixture(true))
  assert.ok(pdf.internal.getNumberOfPages() > 1)
  assert.ok(pdf.output('arraybuffer').byteLength > 5000)
})

test('rejects incomplete assessment data before creating the document', () => {
  assert.throws(() => createImpactReportPdf({}), /Assessment data is required/)
})
