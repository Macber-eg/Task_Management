/** Identifies this tab so the API can skip echoing a tab's own realtime events back to it. */
export const windowId = Math.random().toString(36).substring(2, 11);
