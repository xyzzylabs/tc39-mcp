// Trigram similarity scoring for fuzzy search fallback.
//
// Given a needle and a candidate haystack token, decompose both into
// 3-character sliding windows ("trigrams") and score by Jaccard
// similarity over the trigram sets:
//
//   sim(a, b) = |tri(a) ∩ tri(b)| / |tri(a) ∪ tri(b)|
//
// Scores ∈ [0, 1], where 1 = identical strings. Typos like
// "tonumebr" vs "tonumber" score ~0.7; unrelated tokens score < 0.1.

/** Pad the input so the first/last characters get full trigram
 *  representation. "ab" → "  ab  " → " a", " ab", "ab ", "b  ". */
function trigrams(s: string): Set<string> {
  const padded = `  ${s.toLowerCase()}  `;
  const out = new Set<string>();
  for (let i = 0; i < padded.length - 2; i++) {
    out.add(padded.slice(i, i + 3));
  }
  return out;
}

const triCache = new Map<string, Set<string>>();
function getTrigrams(s: string): Set<string> {
  let t = triCache.get(s);
  if (!t) {
    t = trigrams(s);
    triCache.set(s, t);
  }
  return t;
}

/** Jaccard similarity over trigram sets. Pure function over its
 *  inputs; the per-string cache above is just an opportunistic
 *  speedup for repeated calls. */
export function trigramSimilarity(a: string, b: string): number {
  // Empty inputs collide on the padding-only trigram set; treat as 0.
  if (!a || !b) return 0;
  if (a === b) return 1;
  const A = getTrigrams(a);
  const B = getTrigrams(b);
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return union === 0 ? 0 : inter / union;
}
