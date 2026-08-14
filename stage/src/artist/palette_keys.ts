/** Natural-sort and FNV-1a helpers shared by palettes and categorical themes. */

export function stableStringHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

export function compareTextTokens(a: string, b: string): number {
  const lowerA = a.toLowerCase();
  const lowerB = b.toLowerCase();
  if (lowerA < lowerB) return -1;
  if (lowerA > lowerB) return 1;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function normalizeNumericToken(token: string): string {
  const normalized = token.replace(/^0+/, "");
  return normalized.length > 0 ? normalized : "0";
}

export function compareNaturalKeys(a: string, b: string): number {
  const partsA = a.match(/\d+|\D+/g) ?? [a];
  const partsB = b.match(/\d+|\D+/g) ?? [b];
  const limit = Math.min(partsA.length, partsB.length);

  for (let i = 0; i < limit; i++) {
    const partA = partsA[i];
    const partB = partsB[i];
    const digitsA = /^\d+$/.test(partA);
    const digitsB = /^\d+$/.test(partB);

    if (digitsA && digitsB) {
      const normA = normalizeNumericToken(partA);
      const normB = normalizeNumericToken(partB);
      if (normA.length !== normB.length) {
        return normA.length - normB.length;
      }
      if (normA !== normB) {
        return normA < normB ? -1 : 1;
      }
      if (partA.length !== partB.length) {
        return partA.length - partB.length;
      }
      continue;
    }

    if (digitsA !== digitsB) {
      return digitsA ? -1 : 1;
    }

    const textCmp = compareTextTokens(partA, partB);
    if (textCmp !== 0) return textCmp;
  }

  if (partsA.length !== partsB.length) {
    return partsA.length - partsB.length;
  }
  return compareTextTokens(a, b);
}
