import { browser } from "wxt/browser";
import { defineContentScript } from "wxt/utils/define-content-script";
import { getPageContext, isPrimerExtensionMessage, isSameGitCommit } from "../primer/lib/extension-context";
import type { CommentDraftResult, DiffAnchor, DiffSide } from "../primer/lib/extension-context";
import {
  createDiffAnchor,
  normalizeDiffSide,
  parseDiffCellId,
  type DiffPoint,
} from "../primer/lib/github-diff-anchor";
import {
  createGitHubDiffFragment,
  createPullFilesUrl,
} from "../primer/lib/github-navigation";
import { normalizeGitHubFilePath } from "../primer/lib/github-file-path";

const FILE_SELECTOR = [
  "[data-file-path]",
  ".file[data-path]",
  "[data-testid='diff-file']",
  "copilot-diff-entry",
  // GitHub's React diff container uses the file's `diff-<sha256>` fragment as
  // its id; line ids append an uppercase L/R suffix and are excluded here.
  "[id^='diff-']:not([id*='L']):not([id*='R'])",
].join(", ");
const LINE_SELECTOR = "[data-line-number], [data-line], td.blob-num, [id*='diff-'][id*='L'], [id*='diff-'][id*='R']";
const RESIZE_SETTLE_MS = 80;
const DIFF_SCROLL_STICKY_OFFSET = 88;
const DIFF_SCROLL_MIN_MS = 450;
const DIFF_SCROLL_MAX_MS = 1_100;
const DIFF_SCROLL_MAX_FRAME_PX = 90;
let activeDiffScrollFrame: number | undefined;
let activeDiffScrollTarget: { element: Element; block: DiffScrollBlock } | undefined;

type DiffScrollBlock = "start" | "center";

function diffScrollTop(target: Element, block: DiffScrollBlock): number {
  const rect = target.getBoundingClientRect();
  const absoluteTop = window.scrollY + rect.top;
  const desiredTop = block === "center"
    ? absoluteTop - (window.innerHeight - rect.height) / 2
    : absoluteTop - DIFF_SCROLL_STICKY_OFFSET;
  const maxScrollTop = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(maxScrollTop, Math.max(0, desiredTop));
}

function cancelDiffScroll(): void {
  if (activeDiffScrollFrame !== undefined) {
    window.cancelAnimationFrame(activeDiffScrollFrame);
    activeDiffScrollFrame = undefined;
  }
  activeDiffScrollTarget = undefined;
}

function animateDiffScroll(target: Element, block: DiffScrollBlock): void {
  // Re-requests for the in-flight destination arrive constantly while
  // GitHub hydrates virtualized rows; restarting the glide reads as a jump.
  if (
    activeDiffScrollFrame !== undefined
    && activeDiffScrollTarget?.element === target
    && activeDiffScrollTarget.block === block
  ) {
    return;
  }
  cancelDiffScroll();

  const startTop = window.scrollY;
  const distance = diffScrollTop(target, block) - startTop;
  if (Math.abs(distance) < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.scrollTo({ top: startTop + distance, behavior: "auto" });
    return;
  }

  // One hand-driven glide for every distance: native smooth scroll cannot be
  // cancelled or retargeted, and hydration shifts the layout mid-scroll, so
  // the destination is recomputed from the element on every frame.
  const duration = Math.min(
    DIFF_SCROLL_MAX_MS,
    Math.max(DIFF_SCROLL_MIN_MS, DIFF_SCROLL_MIN_MS + Math.abs(distance) * 0.25),
  );
  const startedAt = performance.now();
  activeDiffScrollTarget = { element: target, block };
  const tick = (now: number) => {
    if (!target.isConnected) {
      cancelDiffScroll();
      return;
    }
    const progress = Math.min(1, (now - startedAt) / duration);
    const eased = progress < 0.5
      ? 2 * progress ** 2
      : 1 - ((-2 * progress + 2) ** 2) / 2;
    const targetTop = diffScrollTop(target, block);
    // Hydration can move the destination mid-glide; capping how far a single
    // frame travels absorbs the shift over several frames instead of snapping.
    const desired = startTop + (targetTop - startTop) * eased;
    const step = Math.max(
      -DIFF_SCROLL_MAX_FRAME_PX,
      Math.min(DIFF_SCROLL_MAX_FRAME_PX, desired - window.scrollY),
    );
    window.scrollTo({ top: window.scrollY + step, behavior: "auto" });
    const settled = progress >= 1 && Math.abs(diffScrollTop(target, block) - window.scrollY) < 2;
    if (!settled && now - startedAt < duration * 2) {
      activeDiffScrollFrame = window.requestAnimationFrame(tick);
    } else {
      cancelDiffScroll();
    }
  };
  activeDiffScrollFrame = window.requestAnimationFrame(tick);
}

function visibleHeight(element: Element): number {
  const rect = element.getBoundingClientRect();
  return Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
}

function readFilePath(element: Element): string | undefined {
  const direct = element.getAttribute("data-file-path") ?? element.getAttribute("data-path");
  if (direct) return normalizeGitHubFilePath(direct);

  const label = element.querySelector<HTMLElement>(
    "[data-file-path], [data-path], .file-info a, a.Link--primary[href*='#diff-']",
  );
  return normalizeGitHubFilePath(label?.getAttribute("data-file-path")
    ?? label?.getAttribute("data-path")
    ?? label?.textContent?.trim()
    ?? undefined);
}

function findVisibleFile(): string | undefined {
  const viewportCenter = window.innerHeight / 2;
  const candidates = Array.from(document.querySelectorAll(FILE_SELECTOR))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        path: readFilePath(element),
        top: rect.top,
        bottom: rect.bottom,
        height: visibleHeight(element),
        distance: Math.abs((rect.top + rect.bottom) / 2 - viewportCenter),
      };
    })
    .filter((candidate): candidate is typeof candidate & { path: string } => Boolean(candidate.path));
  const visible = candidates
    .filter(({ height }) => height > 0)
    .sort((left, right) => left.distance - right.distance)[0];
  if (visible) return visible.path;

  // GitHub's current diff UI puts data-file-path on a short file-header
  // button, not on the full diff container. While reviewing the body that
  // header is usually just above the viewport, so use the nearest preceding
  // header as the active file instead of dropping back to "Waiting".
  return candidates
    .filter(({ top }) => top <= viewportCenter)
    .sort((left, right) => right.top - left.top)[0]?.path
    ?? candidates.sort((left, right) => left.distance - right.distance)[0]?.path;
}

function findFileElement(path?: string): Element | undefined {
  if (!path) return undefined;
  return Array.from(document.querySelectorAll(FILE_SELECTOR))
    .filter((element) => readFilePath(element) === path)
    .sort((left, right) => fileElementScore(right) - fileElementScore(left))[0];
}

function fileElementScore(element: Element): number {
  const rect = element.getBoundingClientRect();
  return (element.querySelector(LINE_SELECTOR) ? 2 : 0) + (rect.height > 60 ? 1 : 0);
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
  return headShaFromDiffUrls();
}

// GitHub's current PR markup no longer exposes the head SHA as a meta tag or
// data attribute; it only appears inside diff-service URLs, e.g.
// `?end_commit_oid=<head>`, `?sha2=<head>`, and `/diffs/<base>..<head>`.
function headShaFromDiffUrls(): string | undefined {
  const urlAttributes = ["href", "src", "action", "data-url"] as const;
  const markers = ["end_commit_oid=", "sha2=", "/diffs/"];
  const selector = urlAttributes
    .flatMap((attribute) => markers.map((marker) => `[${attribute}*="${marker}"]`))
    .join(",");
  for (const element of document.querySelectorAll(selector)) {
    for (const attribute of urlAttributes) {
      const value = element.getAttribute(attribute);
      if (!value) continue;
      const match = value.match(/(?:end_commit_oid|sha2)=([a-f0-9]{7,64})/i)
        ?? value.match(/\/diffs\/[a-f0-9]{7,64}\.\.([a-f0-9]{7,64})/i);
      if (match?.[1]) return match[1];
    }
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

const STEP_HIGHLIGHT_CLASS = "primer-step-highlight";
let stepHighlightStyle: HTMLStyleElement | undefined;

function ensureStepHighlightStyle(): void {
  if (stepHighlightStyle?.isConnected) return;
  stepHighlightStyle = document.createElement("style");
  stepHighlightStyle.textContent = `
    .${STEP_HIGHLIGHT_CLASS} {
      box-shadow: inset 3px 0 0 #315cf5 !important;
      background-color: rgba(49, 92, 245, 0.07) !important;
    }
  `;
  document.head.append(stepHighlightStyle);
}

function clearStepHighlights(): void {
  for (const element of document.querySelectorAll(`.${STEP_HIGHLIGHT_CLASS}`)) {
    element.classList.remove(STEP_HIGHLIGHT_CLASS);
  }
}

function highlightMountedRange(
  file: Element,
  path: string,
  startLine: number,
  endLine: number,
  side: DiffSide,
): void {
  ensureStepHighlightStyle();
  for (const element of file.querySelectorAll(LINE_SELECTOR)) {
    const point = pointFromLineElement(element, path);
    if (!point || point.side !== side) continue;
    if (point.line < startLine || point.line > endLine) continue;
    const row = element.closest("tr, [role='row'], [data-testid='diff-line']") ?? element;
    row.classList.add(STEP_HIGHLIGHT_CLASS);
  }
}

function scrollToMountedDiff(
  path: string,
  line?: number,
  side: DiffSide = "RIGHT",
  exactLineOnly = false,
  endLine?: number,
): boolean {
  const target = findFileElement(path);
  if (!target) return false;
  const lineTarget = line
    ? Array.from(target.querySelectorAll(LINE_SELECTOR)).find((element) => {
        const point = pointFromLineElement(element, path);
        return point?.line === line && point.side === side;
      })
    : undefined;
  if (line && exactLineOnly && !lineTarget) return false;
  const scrollTarget = lineTarget?.closest("tr, [role='row'], [data-testid='diff-line']") ?? lineTarget ?? target;
  animateDiffScroll(scrollTarget, lineTarget ? "center" : "start");
  clearStepHighlights();
  if (lineTarget && line) {
    highlightMountedRange(target, path, line, Math.max(endLine ?? line, line), side);
  }
  if (scrollTarget instanceof HTMLElement) {
    scrollTarget.animate(
      [
        { outline: "2px solid transparent", outlineOffset: "2px" },
        { outline: "2px solid #315cf5", outlineOffset: "2px" },
        { outline: "2px solid transparent", outlineOffset: "2px" },
      ],
      { duration: 1_400, easing: "ease-out" },
    );
  }
  return true;
}

function waitForMountedLine(
  path: string,
  line: number,
  side: DiffSide,
  endLine?: number,
  timeoutMs = 2_000,
): Promise<boolean> {
  if (scrollToMountedDiff(path, line, side, true, endLine)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timeout = window.setTimeout(() => {
      observer.disconnect();
      resolve(false);
    }, timeoutMs);
    const observer = new MutationObserver(() => {
      if (!scrollToMountedDiff(path, line, side, true, endLine)) return;
      window.clearTimeout(timeout);
      observer.disconnect();
      resolve(true);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  });
}

async function navigateToDiff(
  path: string,
  line?: number,
  side: DiffSide = "RIGHT",
  endLine?: number,
): Promise<boolean> {
  if (scrollToMountedDiff(path, line, side, false, endLine)) return true;

  // If GitHub has not mounted the file yet, navigate to the stable file
  // fragment first. Exact line scrolling is retried once the diff is mounted;
  // line fragments do not exist for collapsed or large unloaded diffs.
  const fragment = await createGitHubDiffFragment(path);
  const filesUrl = createPullFilesUrl(window.location.href, fragment);
  if (!filesUrl) return false;

  const onFilesChanged = /\/pull\/\d+\/(?:files|changes)(?:\/|$)/.test(window.location.pathname);
  if (!onFilesChanged) {
    window.location.assign(filesUrl);
    return true;
  }

  // GitHub often keeps a lightweight per-file anchor mounted even when its
  // diff rows are virtualized. Scroll to that placeholder ourselves so the
  // virtualizer can hydrate it without an immediate browser hash jump.
  const fragmentTarget = document.getElementById(fragment);
  if (fragmentTarget) {
    animateDiffScroll(fragmentTarget, "start");
    if (line) void waitForMountedLine(path, line, side, endLine);
    return true;
  }

  // GitHub's diff is virtualized. Its native file/line fragment asks the PR
  // router to mount the relevant diff even when no matching element exists yet.
  if (window.location.hash !== `#${fragment}`) {
    window.location.hash = fragment;
    if (line) void waitForMountedLine(path, line, side);
    return true;
  }

  const nativeLink = Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]"))
    .find((link) => link.getAttribute("href")?.endsWith(`#${fragment}`));
  if (nativeLink) {
    nativeLink.click();
    if (line) void waitForMountedLine(path, line, side, endLine);
    return true;
  }

  window.location.assign(filesUrl);
  return true;
}

async function navigateToAnchor(anchor: DiffAnchor): Promise<boolean> {
  const currentHeadSha = readHeadSha();
  if (currentHeadSha && !isSameGitCommit(currentHeadSha, anchor.headSha)) {
    // The PR moved past the plan's commit, so exact line numbers are suspect.
    // Still glide to the file: a hard URL fallback in the panel snaps the
    // page and loses the reviewer's place entirely.
    return navigateToDiff(anchor.path);
  }
  // A range anchor scrolls to its first line and highlights through the last.
  const startLine = anchor.startLine ?? anchor.line;
  return navigateToDiff(anchor.path, startLine, anchor.startSide ?? anchor.side, anchor.line);
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
  if (!currentHeadSha || !isSameGitCommit(currentHeadSha, anchor.headSha)) {
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
    let stableViewportWidth = window.innerWidth;
    let frozenRootWidth: { value: string; priority: string } | undefined;

    const freezeGitHubLayout = () => {
      if (frozenRootWidth) return;
      const rootStyle = document.documentElement.style;
      frozenRootWidth = {
        value: rootStyle.getPropertyValue("width"),
        priority: rootStyle.getPropertyPriority("width"),
      };
      // Chrome's side panel normally makes GitHub reflow its entire diff for
      // every pixel of a divider drag. Keep the last settled document width so
      // intermediate frames only clip/reveal it, then perform one final reflow.
      rootStyle.setProperty("width", `${stableViewportWidth}px`, "important");
    };
    const releaseGitHubLayout = () => {
      if (!frozenRootWidth) return;
      const rootStyle = document.documentElement.style;
      if (frozenRootWidth.value) {
        rootStyle.setProperty("width", frozenRootWidth.value, frozenRootWidth.priority);
      } else {
        rootStyle.removeProperty("width");
      }
      frozenRootWidth = undefined;
      stableViewportWidth = window.innerWidth;
    };

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
      if (viewportResizeTimer !== undefined) return;
      if (scheduledFrame !== undefined) return;
      scheduledFrame = window.requestAnimationFrame(publish);
    };
    const schedulePublishAfterMutation = () => {
      if (viewportResizeTimer !== undefined) return;
      if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
      mutationTimer = window.setTimeout(() => {
        mutationTimer = undefined;
        schedulePublishForNextFrame();
      }, 120);
    };
    const schedulePublishAfterResize = () => {
      freezeGitHubLayout();
      // A resize can also produce scroll events through browser scroll anchoring.
      // Cancel work queued by either source so no geometry is read mid-drag.
      if (scheduledFrame !== undefined) {
        window.cancelAnimationFrame(scheduledFrame);
        scheduledFrame = undefined;
      }
      if (mutationTimer !== undefined) {
        window.clearTimeout(mutationTimer);
        mutationTimer = undefined;
      }
      if (viewportResizeTimer !== undefined) window.clearTimeout(viewportResizeTimer);
      viewportResizeTimer = window.setTimeout(() => {
        viewportResizeTimer = undefined;
        // This becomes the baseline for the next drag, so consecutive width
        // adjustments each freeze and snap independently.
        releaseGitHubLayout();
        schedulePublishForNextFrame();
      }, RESIZE_SETTLE_MS);
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
      cancelDiffScroll();
      if (scheduledFrame !== undefined) window.cancelAnimationFrame(scheduledFrame);
      if (mutationTimer !== undefined) window.clearTimeout(mutationTimer);
      if (viewportResizeTimer !== undefined) window.clearTimeout(viewportResizeTimer);
      releaseGitHubLayout();
    });

    // The native chrome messaging API ignores a Promise returned from an
    // onMessage listener, so the sender would always resolve to undefined and
    // the side panel would treat every navigation as failed. Deliver async
    // results through sendResponse and keep the channel open by returning true.
    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (!isPrimerExtensionMessage(message)) return undefined;
      const respond = (result: Promise<unknown> | unknown): true => {
        void Promise.resolve(result)
          .catch(() => false)
          .then((value) => sendResponse(value));
        return true;
      };
      if (message.type === "primer:request-context") return respond(readContext());
      if (message.type === "primer:navigate-file") {
        return respond(navigateToDiff(message.path, message.line, message.side));
      }
      if (message.type === "primer:navigate-anchor") return respond(navigateToAnchor(message.anchor));
      if (message.type === "primer:draft-comment") {
        return respond(draftNativeComment(message.anchor, message.body));
      }
      return undefined;
    });

    publish();
  },
});
