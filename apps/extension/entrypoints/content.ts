import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { getPageContext, isPrimerExtensionMessage } from "../primer/lib/extension-context";
import type { CommentDraftResult, DiffAnchor, DiffSide } from "../primer/lib/extension-context";
import {
  createDiffAnchor,
  normalizeDiffSide,
  parseDiffCellId,
  type DiffPoint,
} from "../primer/lib/github-diff-anchor";

const FILE_SELECTOR = "[data-file-path], .file[data-path], [data-testid='diff-file'], copilot-diff-entry";
const LINE_SELECTOR = "[data-line-number], [data-line], td.blob-num, [id*='diff-'][id*='L'], [id*='diff-'][id*='R']";

function visibleHeight(element: Element): number {
  const rect = element.getBoundingClientRect();
  return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
}

function readFilePath(element: Element): string | undefined {
  const direct = element.getAttribute("data-file-path") ?? element.getAttribute("data-path");
  if (direct) return direct;

  const label = element.querySelector<HTMLElement>(
    "[data-file-path], [data-path], .file-info a, a.Link--primary[href*='#diff-']",
  );
  return label?.getAttribute("data-file-path")
    ?? label?.getAttribute("data-path")
    ?? label?.textContent?.trim()
    ?? undefined;
}

function findVisibleFile(): string | undefined {
  const candidates = Array.from(document.querySelectorAll(FILE_SELECTOR));
  const visible = candidates
    .map((element) => ({ element, height: visibleHeight(element) }))
    .filter(({ height }) => height > 0)
    .sort((left, right) => right.height - left.height)[0]?.element;
  return visible ? readFilePath(visible) : undefined;
}

function findFileElement(path?: string): Element | undefined {
  if (!path) return undefined;
  return Array.from(document.querySelectorAll(FILE_SELECTOR))
    .find((element) => readFilePath(element) === path);
}

function readHeadSha(): string | undefined {
  const selectors = [
    "meta[name='octolytics-dimension-pull_request_head_sha']",
    "meta[name='pull-request-head-sha']",
    "[data-pull-request-head-sha]",
    "[data-head-commit-oid]",
    "[data-head-ref-oid]",
    "[data-head-sha]",
  ];
  for (const selector of selectors) {
    const element = document.querySelector(selector);
    const value = element?.getAttribute("content")
      ?? element?.getAttribute("data-pull-request-head-sha")
      ?? element?.getAttribute("data-head-commit-oid")
      ?? element?.getAttribute("data-head-ref-oid")
      ?? element?.getAttribute("data-head-sha");
    if (value && /^[a-f0-9]{7,64}$/i.test(value)) return value;
  }
  return undefined;
}

function elementFromNode(node: Node | null): Element | undefined {
  if (node instanceof Element) return node;
  return node?.parentElement ?? undefined;
}

function sideFromElement(element: Element): DiffSide | undefined {
  const attributeSide = normalizeDiffSide(
    element.getAttribute("data-side")
      ?? element.getAttribute("data-diff-side")
      ?? element.getAttribute("data-change-type"),
  );
  if (attributeSide) return attributeSide;

  const parsedId = parseDiffCellId(element.id);
  if (parsedId) return parsedId.side;

  const className = element.getAttribute("class") ?? "";
  if (/deletion|removed|blob-num-deletion/.test(className)) return "LEFT";
  if (/addition|added|blob-num-addition/.test(className)) return "RIGHT";
  return undefined;
}

function pointFromLineElement(element: Element, path: string): DiffPoint | undefined {
  const parsedId = parseDiffCellId(element.id);
  const rawLine = element.getAttribute("data-line-number")
    ?? element.getAttribute("data-line")
    ?? parsedId?.line.toString();
  const line = rawLine ? Number(rawLine) : undefined;
  const side = sideFromElement(element) ?? parsedId?.side;
  if (!line || !Number.isInteger(line) || line < 1 || !side) return undefined;
  return { path, line, side };
}

function pointFromNode(node: Node | null): DiffPoint | undefined {
  const source = elementFromNode(node);
  const file = source?.closest(FILE_SELECTOR);
  const path = file ? readFilePath(file) : undefined;
  if (!source || !file || !path) return undefined;

  const directLine = source.closest(LINE_SELECTOR);
  if (directLine) {
    const directPoint = pointFromLineElement(directLine, path);
    if (directPoint) return directPoint;
  }

  const row = source.closest("tr, [role='row'], [data-testid='diff-line']");
  if (!row) return undefined;
  const preferredSide = sideFromElement(source) ?? sideFromElement(row);
  const candidates = Array.from(row.querySelectorAll(LINE_SELECTOR))
    .map((element) => pointFromLineElement(element, path))
    .filter((point): point is DiffPoint => point !== undefined);
  return candidates.find((point) => point.side === preferredSide)
    ?? candidates.find((point) => point.side === "RIGHT")
    ?? candidates[0];
}

function excerptFromNode(node: Node | null): string | undefined {
  const source = elementFromNode(node);
  return source?.closest("tr, [role='row'], [data-testid='diff-line']")?.textContent?.trim();
}

function findSelectedAnchor(headSha: string): DiffAnchor | undefined {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.toString().trim()) return undefined;
  const start = pointFromNode(selection.anchorNode);
  const end = pointFromNode(selection.focusNode);
  if (!start || !end) return undefined;
  if (start.path !== end.path || start.side !== end.side) return undefined;
  const excerpt = excerptFromNode(selection.focusNode);
  return createDiffAnchor({
    headSha,
    selectionStart: start,
    point: end,
    selectedText: selection.toString(),
    ...(excerpt ? { excerpt } : {}),
  });
}

function findVisibleAnchor(path: string, headSha: string): DiffAnchor | undefined {
  const file = findFileElement(path);
  if (!file) return undefined;
  const viewportCenter = window.innerHeight / 2;
  const visibleLines = Array.from(file.querySelectorAll(LINE_SELECTOR))
    .map((element) => {
      const point = pointFromLineElement(element, path);
      const rect = element.getBoundingClientRect();
      return { element, point, rect, distance: Math.abs((rect.top + rect.bottom) / 2 - viewportCenter) };
    })
    .filter(({ point, rect }) => point && rect.bottom > 0 && rect.top < window.innerHeight)
    .sort((left, right) => left.distance - right.distance);
  const preferred = visibleLines.find(({ point }) => point?.side === "RIGHT") ?? visibleLines[0];
  if (!preferred?.point) return undefined;
  const excerpt = preferred.element.closest(
    "tr, [role='row'], [data-testid='diff-line']",
  )?.textContent;
  return createDiffAnchor({
    headSha,
    point: preferred.point,
    ...(excerpt ? { excerpt } : {}),
  });
}

function findActiveAnchor(activeFile?: string): DiffAnchor | undefined {
  const headSha = readHeadSha();
  if (!headSha) return undefined;
  return findSelectedAnchor(headSha)
    ?? (activeFile ? findVisibleAnchor(activeFile, headSha) : undefined);
}

function scrollToFile(path: string): boolean {
  const candidates = Array.from(document.querySelectorAll(FILE_SELECTOR));
  const target = candidates.find((element) => readFilePath(element) === path);
  if (!target) return false;
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  return true;
}

function findAnchorLineElement(anchor: DiffAnchor): Element | undefined {
  const file = findFileElement(anchor.path);
  if (!file) return undefined;
  return Array.from(file.querySelectorAll(LINE_SELECTOR)).find((element) => {
    const point = pointFromLineElement(element, anchor.path);
    return point?.line === anchor.line && point.side === anchor.side;
  });
}

function isVisible(element: Element): boolean {
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
}

function findCommentTrigger(lineElement: Element): HTMLElement | undefined {
  const selector = [
    "button.add-line-comment",
    "button[aria-label*='Add line comment']",
    "button[aria-label*='add line comment']",
    "button[data-testid*='add-line-comment']",
  ].join(", ");
  if (lineElement instanceof HTMLElement && lineElement.matches(selector)) return lineElement;
  const scopes = [
    lineElement,
    lineElement.parentElement,
    lineElement.closest("td, [role='cell']"),
    lineElement.closest("tr, [role='row'], [data-testid='diff-line']"),
  ].filter((element): element is Element => element !== null);
  for (const scope of scopes) {
    const trigger = scope.querySelector<HTMLElement>(selector);
    if (trigger) return trigger;
  }
  return undefined;
}

const COMMENT_COMPOSER_SELECTOR = [
  "textarea[name='comment[body]']",
  "textarea[data-testid*='comment']",
  "textarea[placeholder*='comment' i]",
  "textarea[aria-label*='comment' i]",
  "[contenteditable='true'][data-testid*='comment']",
].join(", ");

function waitForNewComposer(
  file: Element,
  existing: Set<Element>,
  timeoutMs = 3_000,
): Promise<HTMLElement | undefined> {
  const find = () => Array.from(file.querySelectorAll<HTMLElement>(COMMENT_COMPOSER_SELECTOR))
    .find((element) => !existing.has(element) && isVisible(element));
  const immediate = find();
  if (immediate) return Promise.resolve(immediate);

  return new Promise((resolve) => {
    let settled = false;
    const finish = (composer?: HTMLElement) => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      window.clearTimeout(timer);
      resolve(composer);
    };
    const observer = new MutationObserver(() => {
      const composer = find();
      if (composer) finish(composer);
    });
    const timer = window.setTimeout(() => finish(), timeoutMs);
    observer.observe(file, { childList: true, subtree: true });
  });
}

function fillCommentComposer(composer: HTMLElement, body: string): void {
  composer.focus();
  if (composer instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(composer, body);
  } else {
    composer.textContent = body;
  }
  composer.dispatchEvent(new InputEvent("input", {
    bubbles: true,
    cancelable: true,
    data: body,
    inputType: "insertText",
  }));
  composer.dispatchEvent(new Event("change", { bubbles: true }));
}

async function draftNativeComment(anchor: DiffAnchor, body: string): Promise<CommentDraftResult> {
  if (!body.trim()) return { ok: false, error: "invalid-request" };
  const currentHeadSha = readHeadSha();
  if (!currentHeadSha || currentHeadSha !== anchor.headSha) {
    return { ok: false, error: "stale-anchor" };
  }

  const lineElement = findAnchorLineElement(anchor);
  if (!lineElement) return { ok: false, error: "anchor-not-found" };
  lineElement.scrollIntoView({ behavior: "auto", block: "center" });

  // GitHub's range-selection gesture differs between unified and split views.
  // Refuse to draft against only the final line until that gesture is verified.
  if (anchor.startLine !== undefined) return { ok: false, error: "range-not-supported" };

  const file = findFileElement(anchor.path);
  const trigger = findCommentTrigger(lineElement);
  if (!file || !trigger) return { ok: false, error: "composer-not-found" };
  const existing = new Set(file.querySelectorAll(COMMENT_COMPOSER_SELECTOR));
  trigger.click();
  const composer = await waitForNewComposer(file, existing);
  if (!composer) return { ok: false, error: "composer-not-found" };
  fillCommentComposer(composer, body.trim());
  return { ok: true, status: "drafted" };
}

export default defineContentScript({
  matches: ["https://github.com/*"],
  runAt: "document_idle",
  main(ctx) {
    let previousSignature = "";
    let scheduledFrame: number | undefined;
    let mutationTimer: number | undefined;
    let viewportResizeTimer: number | undefined;

    const readContext = () => {
      const activeFile = findVisibleFile();
      const headSha = readHeadSha();
      return getPageContext(window.location.href, activeFile, findActiveAnchor(activeFile), headSha);
    };
    const publish = () => {
      scheduledFrame = undefined;
      const context = readContext();
      const anchor = context.activeAnchor;
      const signature = [
        context.url,
        context.activeFile,
        context.headSha,
        anchor?.headSha,
        anchor?.startSide,
        anchor?.startLine,
        anchor?.side,
        anchor?.line,
        anchor?.selectedText,
      ].join("::");
      if (signature === previousSignature) return;
      previousSignature = signature;
      void browser.runtime.sendMessage({ type: "primer:context-observed", context });
    };
    const schedulePublishForNextFrame = () => {
      if (scheduledFrame !== undefined) return;
      scheduledFrame = window.requestAnimationFrame(publish);
    };
    const schedulePublishAfterMutation = () => {
      if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(() => {
        mutationTimer = undefined;
        schedulePublishForNextFrame();
      }, 120);
    };
    const schedulePublishAfterResize = () => {
      if (viewportResizeTimer !== undefined) window.clearTimeout(viewportResizeTimer);
      viewportResizeTimer = window.setTimeout(() => {
        viewportResizeTimer = undefined;
        schedulePublishForNextFrame();
      }, 180);
    };

    const observer = new MutationObserver(schedulePublishAfterMutation);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    ctx.addEventListener(window, "scroll", schedulePublishForNextFrame, { passive: true });
    // Dragging Chrome's side-panel divider resizes the page viewport on every
    // frame. Reading every diff rectangle during that drag forces GitHub's
    // large DOM through avoidable layout work. Refresh once the drag settles.
    ctx.addEventListener(window, "resize", schedulePublishAfterResize, { passive: true });
    ctx.addEventListener(document, "selectionchange", schedulePublishAfterMutation);
    ctx.addEventListener(window, "popstate", schedulePublishForNextFrame);
    ctx.onInvalidated(() => {
      observer.disconnect();
      if (scheduledFrame !== undefined) window.cancelAnimationFrame(scheduledFrame);
      if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
      if (viewportResizeTimer !== undefined) window.clearTimeout(viewportResizeTimer);
    });

    browser.runtime.onMessage.addListener((message) => {
      if (!isPrimerExtensionMessage(message)) return undefined;
      if (message.type === "primer:request-context") return Promise.resolve(readContext());
      if (message.type === "primer:navigate-file") return Promise.resolve(scrollToFile(message.path));
      if (message.type === "primer:draft-comment") {
        return draftNativeComment(message.anchor, message.body);
      }
      return undefined;
    });

    publish();
  },
});
