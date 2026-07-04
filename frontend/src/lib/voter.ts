const VOTER_ID_KEY = "fives:voter-id";

function votedKey(slug: string): string {
  return `fives:voted:${slug}`;
}

/** A random id generated once per browser and reused across every public showcase page's votes. */
export function getVoterId(): string {
  const existing = localStorage.getItem(VOTER_ID_KEY);
  if (existing) return existing;

  const id = crypto.randomUUID();
  localStorage.setItem(VOTER_ID_KEY, id);
  return id;
}

export function hasVoted(slug: string): boolean {
  return localStorage.getItem(votedKey(slug)) !== null;
}

export function markVoted(slug: string): void {
  localStorage.setItem(votedKey(slug), "1");
}
