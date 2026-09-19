// lib/responses.js
export function ok(res, data = {}) {
  return res.status(200).json({ success: true, ...data });
}
export function bad(res, message = 'Bad request', code = 400) {
  return res.status(code).json({ success: false, message });
}
export function serverError(res, message = 'Internal server error') {
  console.error('[serverError]', message);
  return res.status(500).json({ success: false, message });
}
