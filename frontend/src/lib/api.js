export const api = async (path, method = 'GET', body) => {
  const response = await fetch('/api' + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!response.ok) {
    const error = await response.json().catch(() => ({}))
    throw new Error(typeof error.detail === 'string' ? error.detail : response.statusText)
  }
  return response.json()
}

export const EMPTY_CONTROL = {
  ref: '', name: '', description: '', owner: '', evidence: '', evidence_date: '', status: 'Not started',
}
export const CONTROL_STATUSES = ['Not started', 'In progress', 'Complete']
export const today = new Date().toISOString().slice(0, 10)
