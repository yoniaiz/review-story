interface NavigateMessage {
  type: "review-story:navigate";
  path: string;
  line?: number;
}

interface VisibleFileMessage {
  type: "review-story:visible-file";
  path: string;
}

export default defineContentScript({
  // Match the whole PR so this script survives GitHub Turbo navigation into /files.
  matches: ["https://github.com/*/*/pull/*"],
  main() {
    browser.runtime.onMessage.addListener((message: unknown) => {
      if (!isNavigateMessage(message)) return;
      return navigateToFile(message.path, message.line);
    });

    let scheduled = false;
    let lastVisiblePath = "";

    const reportVisibleFile = () => {
      scheduled = false;
      const path = findVisibleFilePath();
      if (!path || path === lastVisiblePath) return;
      lastVisiblePath = path;
      const message: VisibleFileMessage = {
        type: "review-story:visible-file",
        path,
      };
      void browser.runtime.sendMessage(message).catch(() => undefined);
    };

    const scheduleReport = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(reportVisibleFile);
    };

    const observer = new MutationObserver(scheduleReport);
    observer.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("scroll", scheduleReport, { passive: true });
    scheduleReport();
  },
});

function isNavigateMessage(message: unknown): message is NavigateMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    message.type === "review-story:navigate" &&
    "path" in message &&
    typeof message.path === "string"
  );
}

async function navigateToFile(path: string, line?: number): Promise<boolean> {
  const mountedContainer = findMountedFileContainer(path);
  if (mountedContainer) {
    mountedContainer.scrollIntoView({ behavior: "smooth", block: "start" });
    flashTarget(mountedContainer);
    return true;
  }

  const diffId = await githubDiffId(path);
  if (!window.location.pathname.includes("/files")) {
    const pullPath = window.location.pathname.match(
      /^(\/[^/]+\/[^/]+\/pull\/\d+)/,
    )?.[1];
    if (!pullPath) return false;
    const filesPath = `${pullPath}/files`;
    window.location.assign(`${filesPath}${window.location.search}#${diffId}`);
    return true;
  }
  const targetHash = line ? `${diffId}R${line}` : diffId;
  window.location.hash = targetHash;

  const mountedAfterHash = await waitForMountedFile(path);
  if (mountedAfterHash) {
    mountedAfterHash.scrollIntoView({ behavior: "smooth", block: "start" });
    flashTarget(mountedAfterHash);
    return true;
  }

  const nativeTreeLink = findNativeTreeLink(path);
  if (nativeTreeLink) {
    nativeTreeLink.click();
    const mountedAfterTreeClick = await waitForMountedFile(path);
    if (mountedAfterTreeClick) {
      mountedAfterTreeClick.scrollIntoView({ behavior: "smooth", block: "start" });
      flashTarget(mountedAfterTreeClick);
      return true;
    }
  }

  // Last-resort full navigation asks GitHub to reconstruct the Files page at the anchor.
  window.location.assign(
    `${window.location.pathname}${window.location.search}#${targetHash}`,
  );
  return true;
}

async function waitForMountedFile(
  path: string,
  timeoutMs = 500,
): Promise<HTMLElement | undefined> {
  const deadline = performance.now() + timeoutMs;
  while (performance.now() < deadline) {
    const container = findMountedFileContainer(path);
    if (container) return container;
    await new Promise<void>((resolveWait) =>
      window.setTimeout(resolveWait, 50),
    );
  }
  return undefined;
}

function findMountedFileContainer(path: string): HTMLElement | undefined {
  return [...document.querySelectorAll<HTMLElement>("[data-path]")].find(
    (element) =>
      element.dataset.path === path &&
      (element.matches(".file, [id^='diff-']") ||
        element.querySelector("table.diff-table, .js-file-content")),
  );
}

function findNativeTreeLink(path: string): HTMLAnchorElement | undefined {
  return [...document.querySelectorAll<HTMLAnchorElement>("a[href]")].find(
    (anchor) => {
      const label = anchor.textContent?.trim();
      return (
        label === path ||
        anchor.getAttribute("title") === path ||
        anchor.getAttribute("aria-label") === path
      );
    },
  );
}

function findVisibleFilePath(): string | undefined {
  const candidates = [
    ...document.querySelectorAll<HTMLElement>("[data-path]"),
  ].filter((element) => {
    const rect = element.getBoundingClientRect();
    return (
      Boolean(element.dataset.path) &&
      rect.height > 100 &&
      rect.bottom > 120 &&
      rect.top < window.innerHeight
    );
  });

  candidates.sort((left, right) => {
    const leftDistance = Math.abs(left.getBoundingClientRect().top - 140);
    const rightDistance = Math.abs(right.getBoundingClientRect().top - 140);
    return leftDistance - rightDistance;
  });

  return candidates[0]?.dataset.path;
}

async function githubDiffId(path: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(path),
  );
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
  return `diff-${hex}`;
}

function flashTarget(element: HTMLElement): void {
  element.animate(
    [
      { outline: "3px solid rgba(118, 92, 255, 0.7)" },
      { outline: "3px solid rgba(118, 92, 255, 0)" },
    ],
    { duration: 1_200, easing: "ease-out" },
  );
}
