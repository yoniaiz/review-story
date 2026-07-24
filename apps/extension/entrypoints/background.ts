import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  getPageContext,
  isPrimerExtensionMessage,
  reconcilePageContext,
  type GitHubPageContext,
  type PrimerExtensionMessage,
} from "../primer/lib/extension-context";

const contextByTab = new Map<number, GitHubPageContext>();
const contentScriptInjectionByTab = new Map<number, Promise<boolean>>();

async function ensureContentScript(tabId: number, url: string): Promise<boolean> {
  if (getPageContext(url).kind === "outside-github") return false;

  const pending = contentScriptInjectionByTab.get(tabId);
  if (pending) return pending;

  const injection = browser.scripting.executeScript({
    target: { tabId },
    files: ["/content-scripts/content.js"],
  }).then(() => true).catch(() => false).finally(() => {
    contentScriptInjectionByTab.delete(tabId);
  });
  contentScriptInjectionByTab.set(tabId, injection);
  return injection;
}

async function readTabContext(tabId: number): Promise<GitHubPageContext | undefined> {
  const context = await browser.tabs.sendMessage(tabId, { type: "primer:request-context" });
  if (context && typeof context === "object" && "kind" in context) {
    return context as GitHubPageContext;
  }
  return undefined;
}

async function requestTabContext(tabId: number, fallbackUrl = ""): Promise<GitHubPageContext> {
  try {
    const context = await readTabContext(tabId);
    if (context) return reconcilePageContext(fallbackUrl, context);
  } catch {
    // Reloading an unpacked extension invalidates its scripts in tabs that were
    // already open. Re-inject once so context tracking and file navigation work
    // without requiring the reviewer to manually refresh GitHub.
    if (await ensureContentScript(tabId, fallbackUrl)) {
      try {
        const context = await readTabContext(tabId);
        if (context) return reconcilePageContext(fallbackUrl, context);
      } catch {
        // Fall through to the last observed or URL-derived context.
      }
    }
  }
  return reconcilePageContext(fallbackUrl, contextByTab.get(tabId));
}

async function broadcastActiveContext(tabId: number, url = ""): Promise<void> {
  const context = await requestTabContext(tabId, url);
  contextByTab.set(tabId, context);
  await browser.runtime.sendMessage({
    type: "primer:active-context-changed",
    tabId,
    context,
  } satisfies PrimerExtensionMessage).catch(() => undefined);
}

export default defineBackground(() => {
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);

  browser.runtime.onMessage.addListener((message, sender) => {
    if (!isPrimerExtensionMessage(message)) return undefined;

    if (message.type === "primer:context-observed" && sender.tab?.id !== undefined) {
      contextByTab.set(sender.tab.id, message.context);
      if (sender.tab.active) void broadcastActiveContext(sender.tab.id, sender.tab.url);
      return undefined;
    }

    if (message.type === "primer:get-active-context") {
      return browser.tabs.query({ active: true, currentWindow: true }).then(async ([tab]) => {
        if (tab?.id === undefined) return getPageContext(tab?.url ?? "");
        return requestTabContext(tab.id, tab.url);
      });
    }

    return undefined;
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    void browser.tabs.get(tabId).then((tab) => broadcastActiveContext(tabId, tab.url));
  });

  browser.tabs.onUpdated.addListener((tabId, change, tab) => {
    // GitHub tabs in the background continue to mutate and navigate. Only the
    // active tab may drive the side panel; otherwise an unrelated repository
    // can replace the PR context that the reviewer is actually looking at.
    if (tab.active && (change.url || change.status === "complete")) {
      void broadcastActiveContext(tabId, change.url ?? tab.url);
    }
  });

  browser.webNavigation.onHistoryStateUpdated.addListener(({ tabId, frameId, url }) => {
    if (frameId !== 0) return;
    void browser.tabs.get(tabId).then((tab) => {
      if (tab.active) void broadcastActiveContext(tabId, url);
    }).catch(() => undefined);
  });

  browser.tabs.onRemoved.addListener((tabId) => {
    contextByTab.delete(tabId);
    contentScriptInjectionByTab.delete(tabId);
  });
});
