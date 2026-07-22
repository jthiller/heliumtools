import { useCallback, useState } from "react";

/**
 * localStorage-backed onboarding drafts so an interrupted wizard (e.g. issue
 * transaction paid, browser closed before onboard) is resumable. One key
 * holds a map of drafts keyed by gateway b58:
 *   { gateway, name, token, wallet, step, lat, lng, address, nasId, vendor,
 *     createdAt, updatedAt }
 * The token is public data (the gateway signature — no private key); it is
 * dropped from the draft once /status reports the entity issued, after which
 * it is never needed again. Resume flows must treat the stored `step` as a
 * hint only — /status is the source of truth.
 */
const STORAGE_KEY = "heliumtools:mobile-onboard:drafts:v1";

function readAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(map) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {}
}

export default function usePersistedDrafts() {
  const [drafts, setDrafts] = useState(readAll);

  const saveDraft = useCallback((draft) => {
    if (!draft?.gateway) return;
    setDrafts((prev) => {
      const existing = prev[draft.gateway];
      const next = {
        ...prev,
        [draft.gateway]: {
          createdAt: existing?.createdAt ?? Date.now(),
          ...existing,
          ...draft,
          updatedAt: Date.now(),
        },
      };
      writeAll(next);
      return next;
    });
  }, []);

  const deleteDraft = useCallback((gateway) => {
    setDrafts((prev) => {
      if (!(gateway in prev)) return prev;
      const next = { ...prev };
      delete next[gateway];
      writeAll(next);
      return next;
    });
  }, []);

  return { drafts, saveDraft, deleteDraft };
}
