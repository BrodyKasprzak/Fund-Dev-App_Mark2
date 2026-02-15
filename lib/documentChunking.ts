import crypto from "crypto";

export const CHUNKER_VERSION = "heuristic_v1";

const DEFAULT_TARGET_CHARS = 1_400;
const DEFAULT_MAX_CHARS = 2_200;
const DEFAULT_OVERLAP_CHARS = 240;
const DEFAULT_HEADING_MAX_CHARS = 120;

type Block = {
  text: string;
  startOffset: number;
  endOffset: number;
};

type Piece = Block & {
  heading: string | null;
};

type ChunkBuildInput = {
  orgId: string;
  docId: string;
  version: number;
  extractedText: string;
  targetChars?: number;
  maxChars?: number;
  overlapChars?: number;
};

export type BuiltChunk = {
  chunkId: string;
  ordinal: number;
  orgId: string;
  docId: string;
  version: number;
  heading: string | null;
  text: string;
  charCount: number;
  tokenEstimate: number;
  startOffset: number;
  endOffset: number;
  chunkVersion: string;
};

function normalizeText(input: string) {
  return input
    .replace(/\r\n/g, "\n")
    .replace(/\u0000/g, "")
    .replace(/\t/g, " ")
    .replace(/[ ]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeInline(input: string) {
  return input.replace(/\s+/g, " ").trim();
}

function buildBlocks(text: string) {
  const blocks: Block[] = [];
  const pattern = /\S[\s\S]*?(?=\n{2,}|\s*$)/g;
  let match: RegExpExecArray | null = null;

  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const normalized = normalizeInline(raw);
    if (!normalized) continue;

    const blockStart = match.index + raw.indexOf(normalized[0] ?? "");
    blocks.push({
      text: normalized,
      startOffset: blockStart,
      endOffset: blockStart + normalized.length,
    });
  }

  return blocks;
}

function isLikelyHeading(text: string) {
  const clean = normalizeInline(text);
  if (!clean) return false;
  if (clean.length > DEFAULT_HEADING_MAX_CHARS) return false;
  if ((clean.match(/\n/g) || []).length > 1) return false;

  const words = clean.split(/\s+/).filter(Boolean);
  if (words.length === 0 || words.length > 18) return false;

  if (/^[0-9]+(\.[0-9]+)*\s+\S+/.test(clean)) return true;
  if (/^#{1,6}\s+\S+/.test(clean)) return true;
  if (/[:!?.,;]$/.test(clean) && !clean.endsWith(":")) return false;

  const letters = clean.replace(/[^A-Za-z]/g, "").length;
  if (letters < 4) return false;
  const alphaRatio = letters / clean.length;
  if (alphaRatio < 0.55) return false;

  const upperWords = words.filter((w) => /^[A-Z0-9]/.test(w)).length;
  if (upperWords >= Math.ceil(words.length * 0.7)) return true;

  if (clean === clean.toUpperCase()) return true;

  return clean.endsWith(":");
}

function splitLongBlock(block: Block, maxChars: number) {
  if (block.text.length <= maxChars) return [block];

  const parts: Block[] = [];
  const sentencePattern = /[^.!?]+[.!?]?/g;
  const sentences: Array<{ text: string; offset: number }> = [];
  let sentenceMatch: RegExpExecArray | null = null;
  while ((sentenceMatch = sentencePattern.exec(block.text)) !== null) {
    const raw = sentenceMatch[0];
    const trimmed = normalizeInline(raw);
    if (!trimmed) continue;
    const relOffset = sentenceMatch.index + raw.indexOf(trimmed[0] ?? "");
    sentences.push({ text: trimmed, offset: relOffset });
  }

  if (sentences.length <= 1) {
    for (let i = 0; i < block.text.length; i += maxChars) {
      const piece = normalizeInline(block.text.slice(i, i + maxChars));
      if (!piece) continue;
      parts.push({
        text: piece,
        startOffset: block.startOffset + i,
        endOffset: block.startOffset + i + piece.length,
      });
    }
    return parts;
  }

  let buffer = "";
  let bufferStart = block.startOffset;
  let bufferEnd = block.startOffset;

  for (const sentence of sentences) {
    if (!buffer) {
      buffer = sentence.text;
      bufferStart = block.startOffset + sentence.offset;
      bufferEnd = bufferStart + sentence.text.length;
      continue;
    }

    const candidate = `${buffer} ${sentence.text}`;
    if (candidate.length <= maxChars) {
      buffer = candidate;
      bufferEnd = block.startOffset + sentence.offset + sentence.text.length;
      continue;
    }

    parts.push({
      text: buffer,
      startOffset: bufferStart,
      endOffset: bufferEnd,
    });

    buffer = sentence.text;
    bufferStart = block.startOffset + sentence.offset;
    bufferEnd = bufferStart + sentence.text.length;
  }

  if (buffer) {
    parts.push({
      text: buffer,
      startOffset: bufferStart,
      endOffset: bufferEnd,
    });
  }

  return parts;
}

function piecesToText(pieces: Piece[]) {
  if (pieces.length === 0) return "";
  const heading = pieces[0]?.heading ? `# ${pieces[0].heading}\n\n` : "";
  const content = pieces.map((p) => p.text).join("\n\n");
  return `${heading}${content}`.trim();
}

function getOverlapPieces(pieces: Piece[], overlapChars: number) {
  if (overlapChars <= 0 || pieces.length < 2) return [];
  const selected: Piece[] = [];
  let charCount = 0;
  for (let i = pieces.length - 1; i >= 0; i -= 1) {
    const piece = pieces[i];
    selected.unshift(piece);
    charCount += piece.text.length;
    if (charCount >= overlapChars) break;
  }
  if (selected.length >= pieces.length) return [];
  return selected;
}

function hashChunkId(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function buildDocumentChunks(input: ChunkBuildInput): BuiltChunk[] {
  const targetChars = input.targetChars ?? DEFAULT_TARGET_CHARS;
  const maxChars = Math.max(targetChars + 200, input.maxChars ?? DEFAULT_MAX_CHARS);
  const overlapChars = input.overlapChars ?? DEFAULT_OVERLAP_CHARS;

  const normalized = normalizeText(input.extractedText);
  if (!normalized) return [];

  const rawBlocks = buildBlocks(normalized);
  if (rawBlocks.length === 0) return [];

  const pieces: Piece[] = [];
  let currentHeading: string | null = null;

  for (const block of rawBlocks) {
    if (isLikelyHeading(block.text)) {
      currentHeading = block.text.replace(/^#+\s*/, "").slice(0, DEFAULT_HEADING_MAX_CHARS);
      continue;
    }

    const splitBlocks = splitLongBlock(block, maxChars);
    for (const split of splitBlocks) {
      pieces.push({
        ...split,
        heading: currentHeading,
      });
    }
  }

  if (pieces.length === 0) return [];

  const grouped: Piece[][] = [];
  let buffer: Piece[] = [];

  const flush = () => {
    if (buffer.length === 0) return;
    grouped.push(buffer);
    buffer = [];
  };

  for (const piece of pieces) {
    if (buffer.length === 0) {
      buffer = [piece];
      continue;
    }

    const candidate = [...buffer, piece];
    if (piecesToText(candidate).length <= maxChars) {
      buffer = candidate;
      continue;
    }

    flush();
    const overlap = getOverlapPieces(grouped[grouped.length - 1] ?? [], overlapChars);
    buffer = overlap.length > 0 ? [...overlap, piece] : [piece];

    if (piecesToText(buffer).length > maxChars) {
      buffer = [piece];
    }
  }
  flush();

  return grouped.map((group, idx) => {
    const text = piecesToText(group);
    const startOffset = group[0]?.startOffset ?? 0;
    const endOffset = group[group.length - 1]?.endOffset ?? 0;
    const ordinal = idx;
    const stableHash = hashChunkId(
      `${input.orgId}:${input.docId}:v${input.version}:${ordinal}:${text}`,
    );
    const chunkId = `v${input.version}_${String(ordinal).padStart(4, "0")}_${stableHash}`;

    return {
      chunkId,
      ordinal,
      orgId: input.orgId,
      docId: input.docId,
      version: input.version,
      heading: group[0]?.heading ?? null,
      text,
      charCount: text.length,
      tokenEstimate: Math.max(1, Math.ceil(text.length / 4)),
      startOffset,
      endOffset,
      chunkVersion: CHUNKER_VERSION,
    };
  });
}
