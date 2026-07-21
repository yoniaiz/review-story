import type { Claim, Evidence } from "@review-story/contracts";

export interface AnchorValidationResult<T> {
  value: T;
  droppedAnchors: number;
  droppedClaims: number;
}
export function validateEvidenceAnchors(
  evidence: Array<{ path: string; lines: [number, number] }>,
  lineCounts: ReadonlyMap<string, number>,
): AnchorValidationResult<Evidence[]> {
  let droppedAnchors = 0;
  const value: Evidence[] = [];
  for (const anchor of evidence) {
    const lineCount = lineCounts.get(anchor.path);
    if (!lineCount) {
      droppedAnchors += 1;
      continue;
    }
    const range = clampLineRange(anchor.lines, lineCount);
    if (!range) {
      droppedAnchors += 1;
      continue;
    }
    value.push({ path: anchor.path, lines: range });
  }
  return { value, droppedAnchors, droppedClaims: 0 };
}

export function validateClaim(
  claim: {
    text: string;
    kind: "observed" | "inferred";
    evidence: Array<{ path: string; lines: [number, number] }>;
  },
  lineCounts: ReadonlyMap<string, number>,
): AnchorValidationResult<Claim | null> {
  const anchors = validateEvidenceAnchors(claim.evidence, lineCounts);
  const text = claim.text.trim();
  if (!text || anchors.value.length === 0) {
    return {
      value: null,
      droppedAnchors: anchors.droppedAnchors,
      droppedClaims: 1,
    };
  }
  return {
    value: { text, kind: claim.kind, evidence: anchors.value },
    droppedAnchors: anchors.droppedAnchors,
    droppedClaims: 0,
  };
}

export function clampLineRange(
  lines: [number, number],
  lineCount: number,
): [number, number] | null {
  if (!Number.isFinite(lines[0]) || !Number.isFinite(lines[1])) return null;
  if (lines[1] < 1 || lines[0] > lineCount) return null;
  const start = Math.max(1, Math.trunc(lines[0]));
  const end = Math.min(lineCount, Math.trunc(lines[1]));
  return start <= end ? [start, end] : null;
}
