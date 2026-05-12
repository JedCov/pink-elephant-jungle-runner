const LOCAL_STORAGE_KEY = "pink-elephant-jungle-runner2.leaderboard.v1";
const DEFAULT_TABLE = "leaderboard";
const MAX_ENTRIES = 10;
const INITIALS_PATTERN = /^[A-Z0-9]{3}$/;

function getSupabaseConfig() {
  const env = import.meta.env ?? {};
  const url = env.VITE_SUPABASE_URL?.replace(/\/$/, "");
  const anonKey = env.VITE_SUPABASE_ANON_KEY;
  const table = env.VITE_SUPABASE_LEADERBOARD_TABLE || DEFAULT_TABLE;
  if (!url || !anonKey) return null;
  return { url, anonKey, table };
}

function sortEntries(entries) {
  return [...entries]
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    })
    .slice(0, MAX_ENTRIES);
}

function toSafeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.floor(number));
}

export function normalizeInitials(value) {
  return String(value ?? "")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);
}

export function validateInitials(value) {
  return INITIALS_PATTERN.test(String(value ?? ""));
}

export function sanitizeLeaderboardEntry(entry) {
  return {
    initials: normalizeInitials(entry?.initials),
    score: toSafeInteger(entry?.score),
    elapsedMs: toSafeInteger(entry?.elapsedMs),
    fruit: toSafeInteger(entry?.fruit),
    crates: toSafeInteger(entry?.crates),
    lives: toSafeInteger(entry?.lives),
    createdAt: entry?.createdAt || new Date().toISOString(),
  };
}

export function validateLeaderboardEntry(entry) {
  const safeEntry = sanitizeLeaderboardEntry(entry);
  if (!validateInitials(safeEntry.initials)) {
    return { ok: false, message: "Enter exactly 3 uppercase letters or numbers. No names, spaces, or symbols." };
  }
  if (!Number.isFinite(Date.parse(safeEntry.createdAt))) {
    return { ok: false, message: "Leaderboard entry has an invalid date." };
  }
  return { ok: true, entry: safeEntry };
}

function normalizeRemoteRow(row) {
  return sanitizeLeaderboardEntry({
    initials: row.initials,
    score: row.score,
    elapsedMs: row.elapsedMs,
    fruit: row.fruit,
    crates: row.crates,
    lives: row.lives,
    createdAt: row.createdAt,
  });
}

function readLocalLeaderboard() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const parsed = JSON.parse(window.localStorage.getItem(LOCAL_STORAGE_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return sortEntries(parsed.map(sanitizeLeaderboardEntry).filter((entry) => validateInitials(entry.initials)));
  } catch (error) {
    console.warn("Pink Elephant leaderboard local read failed", error);
    return [];
  }
}

function writeLocalLeaderboard(entries) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    window.localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(sortEntries(entries)));
  } catch (error) {
    console.warn("Pink Elephant leaderboard local write failed", error);
  }
}

async function loadRemoteLeaderboard(config) {
  const endpoint = `${config.url}/rest/v1/${encodeURIComponent(config.table)}?select=initials,score,elapsedMs,fruit,crates,lives,createdAt&order=score.desc,elapsedMs.asc&limit=${MAX_ENTRIES}`;
  const response = await fetch(endpoint, {
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
    },
  });
  if (!response.ok) throw new Error(`Remote leaderboard load failed (${response.status})`);
  const rows = await response.json();
  if (!Array.isArray(rows)) throw new Error("Remote leaderboard returned an invalid response.");
  return sortEntries(rows.map(normalizeRemoteRow));
}

async function submitRemoteLeaderboardEntry(config, entry) {
  const endpoint = `${config.url}/rest/v1/${encodeURIComponent(config.table)}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${config.anonKey}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
    },
    body: JSON.stringify(entry),
  });
  if (!response.ok) throw new Error(`Remote leaderboard submit failed (${response.status})`);
  return response.json();
}

export function isLeaderboardAvailable() {
  return Boolean(getSupabaseConfig());
}

export async function loadLeaderboard() {
  const config = getSupabaseConfig();
  if (!config) {
    return {
      entries: readLocalLeaderboard(),
      source: "local",
      remoteAvailable: false,
      error: "Remote leaderboard is not configured. Scores are stored on this device.",
    };
  }

  try {
    const entries = await loadRemoteLeaderboard(config);
    writeLocalLeaderboard(entries);
    return { entries, source: "remote", remoteAvailable: true, error: null };
  } catch (error) {
    console.warn("Pink Elephant leaderboard remote load failed", error);
    return {
      entries: readLocalLeaderboard(),
      source: "local",
      remoteAvailable: false,
      error: "Remote leaderboard is unavailable. Showing scores saved on this device.",
    };
  }
}

export async function submitLeaderboardEntry(entry) {
  const validation = validateLeaderboardEntry(entry);
  if (!validation.ok) throw new Error(validation.message);

  const safeEntry = validation.entry;
  const localEntries = sortEntries([...readLocalLeaderboard(), safeEntry]);
  const config = getSupabaseConfig();

  if (!config) {
    writeLocalLeaderboard(localEntries);
    return {
      entries: localEntries,
      source: "local",
      remoteAvailable: false,
      error: "Remote leaderboard is not configured. Score saved on this device.",
    };
  }

  try {
    await submitRemoteLeaderboardEntry(config, safeEntry);
    const entries = await loadRemoteLeaderboard(config);
    writeLocalLeaderboard(entries);
    return { entries, source: "remote", remoteAvailable: true, error: null };
  } catch (error) {
    console.warn("Pink Elephant leaderboard remote submit failed", error);
    writeLocalLeaderboard(localEntries);
    return {
      entries: localEntries,
      source: "local",
      remoteAvailable: false,
      error: "Remote leaderboard is unavailable. Score saved on this device for now.",
    };
  }
}
