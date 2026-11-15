// Folds a string down to what a person means when they type it into search:
// case-, accent- and spacing-insensitive. SQLite's LIKE / COLLATE NOCASE only
// fold ASCII, so "éponge" never matched "Éponge" and "eponge" never matched
// either — hence the matching is done here, in JS, on both sides.
//
// NFD splits "É" into "E" + a combining accent (and "ṛ" into "r" + a dot
// below), which the range below then drops. Ligatures have no decomposition,
// so they are spelled out by hand.
export function normalizeForSearch(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/œ/g, "oe")
    .replace(/æ/g, "ae")
    .replace(/ß/g, "ss")
    .replace(/\s+/g, " ")
    .trim();
}

export function matchesSearch(
  normalizedQuery: string,
  ...fields: (string | null | undefined)[]
): boolean {
  if (!normalizedQuery) return true;
  return fields.some((f) => !!f && normalizeForSearch(f).includes(normalizedQuery));
}
