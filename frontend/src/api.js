/** Fired when the API says the session has ended, so the app can show the sign-in page. */
export const SIGNED_OUT = 'invoicedesk:signed-out';

async function request(path, options = {}) {
  const res = await fetch(`/api${path}`, { credentials: 'same-origin', ...options });
  if (res.status === 204) return null;
  const body = await res.json().catch(() => ({}));
  if (res.status === 401 && !path.startsWith('/auth/')) window.dispatchEvent(new Event(SIGNED_OUT));
  if (!res.ok) throw Object.assign(new Error(body.error || `Request failed (${res.status})`), { status: res.status });
  return body;
}

const json = (method, data) => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
});

export const api = {
  me: () => request('/auth/me'),
  login: (agrno, email, password) => request('/auth/login', json('POST', { agrno, email, password })),
  logout: () => request('/auth/logout', { method: 'POST' }),
  health: () => request('/health'),
  stats: () => request('/stats'),
  listInvoices: (params = {}) => {
    const qs = new URLSearchParams(Object.entries(params).filter(([, v]) => v)).toString();
    return request(`/invoices${qs ? `?${qs}` : ''}`);
  },
  getInvoice: (id) => request(`/invoices/${id}`),
  saveInvoice: (id, data) => request(`/invoices/${id}`, json('PUT', data)),
  reprocess: (id, provider) => request(`/invoices/${id}/reprocess`, json('POST', provider ? { provider } : {})),
  deleteInvoice: (id) => request(`/invoices/${id}`, { method: 'DELETE' }),
  pages: (id) => request(`/invoices/${id}/pages`),
  split: (id, parts) => request(`/invoices/${id}/split`, json('POST', { parts })),
  listExtractors: () => request('/extractors'),
  upload: (files, provider = 'auto', split = true) => {
    const form = new FormData();
    form.append('provider', provider);
    form.append('split', split ? '1' : '0');
    [...files].forEach((f) => form.append('files', f));
    return request('/invoices/upload', { method: 'POST', body: form });
  },
  fileUrl: (id) => `/api/invoices/${id}/file`,
  exportUrl: () => '/api/invoices/export/csv',
  listSuppliers: () => request('/suppliers'),
  getSupplier: (id) => request(`/suppliers/${id}`),
  saveSupplier: (id, data) => request(`/suppliers/${id}`, json('PUT', data)),
  listCustomers: () => request('/customers'),
  getCustomer: (id) => request(`/customers/${id}`),
  saveCustomer: (id, data) => request(`/customers/${id}`, json('PUT', data)),

  // approvals and notifications
  myApprovals: () => request('/approvals'),
  approvers: () => request('/approvals/approvers'),
  assign: (id, approverUserId, comment) => request(`/invoices/${id}/assign`, json('POST', { approverUserId, comment })),
  decide: (id, decision, comment) => request(`/invoices/${id}/decision`, json('POST', { decision, comment })),
  notifications: (unreadOnly = false) => request(`/notifications?top=30${unreadOnly ? '&unread=1' : ''}`),
  markRead: (id = 0) => request('/notifications/read', json('POST', id ? { id } : {})),

  // audit trail (read-only)
  auditTrail: (id) => request(`/invoices/${id}/audit`),
  auditLog: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v)).toString();
    return request(`/audit${qs ? `?${qs}` : ''}`);
  },
  auditExportUrl: (filters = {}) => {
    const qs = new URLSearchParams(Object.entries(filters).filter(([k, v]) => v && k !== 'before' && k !== 'top')).toString();
    return `/api/audit/export.csv${qs ? `?${qs}` : ''}`;
  },

  // extraction settings (stored encrypted in DS_AgreementTable by the web service)
  saveToolSettings: (provider, settings) => request(`/extraction-settings/${provider}`, json('PUT', { settings })),
  removeToolSettings: (provider) => request(`/extraction-settings/${provider}`, { method: 'DELETE' }),
  setDefaultTool: (provider) => request('/extraction-default', json('PUT', { provider })),
  setApprovalPolicy: (requireApprover) => request('/approval-policy', json('PUT', { require_approver: requireApprover })),
};
