export const LEADERBOARD_LIMIT = 20;

export function normalizeInitials(initials) {
  const normalized = String(initials ?? "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 3);

  return normalized.padEnd(3, "-");
}

function normalizeDate(date) {
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return new Date(0).toISOString();
  return parsed.toISOString();
}

export function normalizeLeaderboardEntry(entry) {
  return {
    initials: normalizeInitials(entry?.initials),
    score: Math.max(0, Math.floor(Number(entry?.score) || 0)),
    elapsedMs: Math.max(0, Math.floor(Number(entry?.elapsedMs) || 0)),
    date: normalizeDate(entry?.date),
  };
}

/**
 * Deterministic leaderboard order:
 * 1. Higher score ranks first.
 * 2. Lower elapsedMs ranks first when scores match.
 * 3. Newer date ranks first as the final stable tie-breaker.
 */
export function compareLeaderboardEntries(a, b) {
  if (b.score !== a.score) return b.score - a.score;
  if (a.elapsedMs !== b.elapsedMs) return a.elapsedMs - b.elapsedMs;

  // Newer scores win the final documented tie-breaker; exact date ties keep input order.
  return new Date(b.date).getTime() - new Date(a.date).getTime();
}

export function rankLeaderboardEntries(entries, limit = LEADERBOARD_LIMIT) {
  return entries
    .map((entry, index) => ({ entry: normalizeLeaderboardEntry(entry), index }))
    .sort((a, b) => compareLeaderboardEntries(a.entry, b.entry) || a.index - b.index)
    .slice(0, limit)
    .map(({ entry }) => entry);
}

export function addLeaderboardEntry(entries, entry, limit = LEADERBOARD_LIMIT) {
  return rankLeaderboardEntries([...entries, entry], limit);
}
