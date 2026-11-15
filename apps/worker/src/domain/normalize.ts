// company_norm / role_norm (spec section 9): lowercase, strip punctuation and legal
// suffixes (ltd, limited, inc, nz), collapse whitespace. Used for search and email linking.
const LEGAL_SUFFIXES = new Set(["ltd", "limited", "inc", "nz", "llc", "pty", "co"]);

export function normalizeName(input: string): string {
  const words = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // Kōwhai -> Kowhai, so search works without macrons
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  while (words.length > 1 && LEGAL_SUFFIXES.has(words[words.length - 1] as string)) words.pop();
  return words.join(" ");
}
