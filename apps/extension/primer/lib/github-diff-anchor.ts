import type { DiffAnchor, DiffSide } from "./extension-context";

export interface DiffPoint {
  path: string;
  line: number;
  side: DiffSide;
}

export interface DiffAnchorInput {
  headSha: string;
  point: DiffPoint;
  selectionStart?: DiffPoint;
  selectedText?: string;
  excerpt?: string;
}

export function normalizeDiffSide(value?: string | null): DiffSide | undefined {
  const side = value?.trim().toUpperCase();
  if (side === "LEFT" || side === "L" || side === "DELETION") return "LEFT";
  if (side === "RIGHT" || side === "R" || side === "ADDITION") return "RIGHT";
  return undefined;
}

export function parseDiffCellId(value?: string | null): Pick<DiffPoint, "line" | "side"> | undefined {
  if (!value) return undefined;
  const match = value.match(/(?:^|[^A-Z0-9])([LR])(\d+)(?:$|[^0-9])/i)
    ?? value.match(/([LR])(\d+)$/i);
  if (!match) return undefined;
  const line = Number(match[2]);
  const side = normalizeDiffSide(match[1]);
  return Number.isInteger(line) && line > 0 && side ? { line, side } : undefined;
}

export function createDiffAnchor(input: DiffAnchorInput): DiffAnchor | undefined {
  const { headSha, point, selectionStart, selectedText, excerpt } = input;
  if (!headSha || !point.path || !Number.isInteger(point.line) || point.line < 1) return undefined;

  const anchor: DiffAnchor = {
    path: point.path,
    headSha,
    line: point.line,
    side: point.side,
  };

  if (selectionStart
    && selectionStart.path === point.path
    && selectionStart.side === point.side
    && selectionStart.line !== point.line) {
    anchor.startLine = Math.min(selectionStart.line, point.line);
    anchor.line = Math.max(selectionStart.line, point.line);
    anchor.startSide = point.side;
  }

  const normalizedSelection = selectedText?.trim();
  const normalizedExcerpt = excerpt?.trim();
  if (normalizedSelection) anchor.selectedText = normalizedSelection.slice(0, 2_000);
  if (normalizedExcerpt) anchor.excerpt = normalizedExcerpt.slice(0, 2_000);
  return anchor;
}

