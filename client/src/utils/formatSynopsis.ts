const MAL_REWRITE_MARKER = /\[Written by MAL Rewrite\]/i;

/** Normalize whitespace inside a single synopsis paragraph. */
function normalizeParagraph(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Split a MAL-style synopsis into display paragraphs.
 * Handles `\n\n` breaks and optional `[Written by MAL Rewrite]` sections.
 */
export function formatSynopsis(synopsis: string): string[] {
  const trimmed = synopsis.trim();
  if (!trimmed) {
    return [];
  }

  const blocks = trimmed
    .split(/\n\s*\n/)
    .map(normalizeParagraph)
    .filter((block) => block.length > 0);

  if (blocks.length === 0) {
    return [normalizeParagraph(trimmed)];
  }

  const paragraphs: string[] = [];

  for (const block of blocks) {
    if (MAL_REWRITE_MARKER.test(block)) {
      const parts = block
        .split(MAL_REWRITE_MARKER)
        .map(normalizeParagraph)
        .filter((part) => part.length > 0);
      paragraphs.push(...parts);
      continue;
    }
    paragraphs.push(block);
  }

  return paragraphs.length > 0 ? paragraphs : [normalizeParagraph(trimmed)];
}
