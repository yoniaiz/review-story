import Parser from "tree-sitter";
import TypeScript from "tree-sitter-typescript";
import type { DiffHunk } from "./types.js";

const enclosingNodeTypes = new Set([
  "class_declaration",
  "interface_declaration",
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "abstract_method_signature",
  "method_signature",
  "lexical_declaration",
  "variable_declaration",
  "type_alias_declaration",
  "enum_declaration",
]);

const callableNodeTypes = new Set([
  "function_declaration",
  "generator_function_declaration",
  "method_definition",
  "arrow_function",
  "function_expression",
]);

const variableNodeTypes = new Set([
  "lexical_declaration",
  "variable_declaration",
]);

export function extractChangedSymbols(
  path: string,
  source: string,
  hunks: DiffHunk[],
): string[] {
  if (supportsTreeSitter(path)) {
    try {
      return treeSitterSymbols(path, source, hunks);
    } catch {
      // Native parser failures degrade to the language-agnostic extractor.
    }
  }
  return regexSymbols(source, hunks);
}

export function extractSourceSkeleton(
  path: string,
  source: string,
): string | null {
  if (!supportsTreeSitter(path)) return null;
  try {
    const parser = new Parser();
    parser.setLanguage(treeSitterLanguage(path));
    const tree = parser.parse(source);
    if (tree.rootNode.hasError) return null;
    const nodes = tree.rootNode
      .descendantsOfType([...enclosingNodeTypes])
      .filter(isMeaningfulSymbolNode);
    const skeleton = nodes
      .slice(0, 250)
      .map((node) => {
        const signature = source
          .slice(node.startIndex, signatureEndIndex(node))
          .replaceAll(/\s+/g, " ")
          .replace(/\s*=\s*$/, "")
          .trim();
        return `${node.startPosition.row + 1}: ${signature}`;
      })
      .filter((line) => line.length > 3)
      .join("\n");
    return skeleton || null;
  } catch {
    return null;
  }
}

function signatureEndIndex(node: Parser.SyntaxNode): number {
  if (variableNodeTypes.has(node.type)) {
    const declarator = node.namedChildren.find(
      (child) => child.type === "variable_declarator",
    );
    const value = declarator?.childForFieldName("value");
    if (!value) return node.endIndex;
    if (callableNodeTypes.has(value.type)) {
      return value.childForFieldName("body")?.startIndex ?? value.endIndex;
    }
    return value.startIndex;
  }
  return node.childForFieldName("body")?.startIndex ?? node.endIndex;
}

function treeSitterSymbols(
  path: string,
  source: string,
  hunks: DiffHunk[],
): string[] {
  if (hunks.length === 0) return [];
  const parser = new Parser();
  parser.setLanguage(treeSitterLanguage(path));
  const tree = parser.parse(source);
  const symbols = new Set<string>();
  const declarations = tree.rootNode
    .descendantsOfType([...enclosingNodeTypes])
    .filter(isMeaningfulSymbolNode);

  for (const hunk of hunks) {
    const startRow = clampRow(hunk.newStart - 1, tree.rootNode.endPosition.row);
    const endRow = clampRow(
      startRow + Math.max(1, hunk.newLines) - 1,
      tree.rootNode.endPosition.row,
    );
    const overlapping = declarations.filter(
      (node) =>
        node.startPosition.row <= endRow && node.endPosition.row >= startRow,
    );
    const probeRows = new Set([startRow, endRow]);
    for (const node of overlapping) {
      if (node.startPosition.row >= startRow && node.startPosition.row <= endRow) {
        probeRows.add(node.startPosition.row);
      }
    }

    for (const row of [...probeRows].sort((left, right) => left - right)) {
      const candidate = overlapping
        .filter(
          (node) =>
            node.startPosition.row <= row && node.endPosition.row >= row,
        )
        .sort(compareNodeSize)[0];
      if (!candidate) continue;
      for (const name of symbolNames(candidate)) symbols.add(name);
    }
  }

  return [...symbols].sort();
}

function symbolNames(node: Parser.SyntaxNode): string[] {
  const direct = node.childForFieldName("name");
  if (direct?.text) return [direct.text];
  if (variableNodeTypes.has(node.type)) {
    const names: string[] = [];
    for (const child of node.namedChildren) {
      const name = child.childForFieldName("name");
      if (name?.text) names.push(name.text);
    }
    return names;
  }
  return [];
}

function regexSymbols(source: string, hunks: DiffHunk[]): string[] {
  const lines = source.split("\n");
  const rows = hunks.length > 0 ? hunks.map((hunk) => hunk.newStart - 1) : [0];
  const expression =
    /(?:function|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|(?:const|let|var)\s+([A-Za-z_$][\w$]*)|(?:async\s+)?def\s+([A-Za-z_$][\w$]*)/;
  const symbols = new Set<string>();
  for (const row of rows) {
    for (let index = Math.min(row, lines.length - 1); index >= 0; index -= 1) {
      const match = expression.exec(lines[index] ?? "");
      const name = match?.[1] ?? match?.[2] ?? match?.[3];
      if (name) {
        symbols.add(name);
        break;
      }
    }
  }
  return [...symbols].sort();
}

function supportsTreeSitter(path: string): boolean {
  return /\.(?:js|jsx|ts|tsx)$/i.test(path);
}

function treeSitterLanguage(path: string) {
  return /\.(?:jsx|tsx)$/i.test(path) ? TypeScript.tsx : TypeScript.typescript;
}

function isMeaningfulSymbolNode(node: Parser.SyntaxNode): boolean {
  if (!variableNodeTypes.has(node.type)) return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (callableNodeTypes.has(parent.type)) return false;
  }
  return true;
}

function compareNodeSize(left: Parser.SyntaxNode, right: Parser.SyntaxNode): number {
  return (
    left.endIndex - left.startIndex - (right.endIndex - right.startIndex) ||
    left.startIndex - right.startIndex
  );
}

function clampRow(row: number, finalRow: number): number {
  return Math.max(0, Math.min(row, finalRow));
}
