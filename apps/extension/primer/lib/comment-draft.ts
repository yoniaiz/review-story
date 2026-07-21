export interface CommentCommand {
  kind: "comment";
  instruction?: string;
}

export function parseCommentCommand(value: string): CommentCommand | undefined {
  const match = value.trim().match(/^\/comment(?:\s+([\s\S]+))?$/i);
  if (!match) return undefined;
  const instruction = match[1]?.trim();
  return instruction ? { kind: "comment", instruction } : { kind: "comment" };
}

export function createFallbackCommentDraft(
  instruction: string | undefined,
  reviewReason: string | undefined,
): string {
  if (instruction) return instruction;
  const reason = reviewReason?.trim().replace(/\s+/g, " ");
  if (reason) {
    return `Could we clarify how this line supports the intended behavior here? Review context: ${reason}`;
  }
  return "Could we clarify the intent of this line and the behavior it is expected to preserve?";
}
