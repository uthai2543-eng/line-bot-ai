export const DEFAULT_REPLY =
  "เรื่องนี้ Admin ขอส่งต่อให้เจ้าหน้าที่ติดต่อกลับนะครับ รบกวนคุณลูกค้าฝากชื่อและเบอร์โทรไว้ได้เลยครับ 🙏";
export const SHEET_TIMEOUT_MS = 3000;
export const GEMINI_TIMEOUT_MS = 7000;
export const CACHE_TTL_MS = 60_000;

// Sheet (3s) + Gemini (7s) alone would use the whole 10s maxDuration and leave
// no time to call LINE, so Gemini is cut off early when the Sheet was slow.
export const ANSWER_BUDGET_MS = 9000;
