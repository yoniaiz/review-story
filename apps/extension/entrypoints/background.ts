import { browser } from "wxt/browser";
import { defineBackground } from "wxt/utils/define-background";
import {
  getPageContext,
  isPrimerExtensionMessage,
  type GitHubPageContext,
  type PrimerExtensionMessage,
} from "../primer/lib/extension-context";

const contextByTab = new Map<number, GitHubPageContext>();

async function requestTabContext(tabId: number, fallbackUrl = ""): Promise<GitHubPageContext> {
  try {
    const context = await browser.tabs.sendMessage(tabId, { type: "primer:request-context" });
    if (context && typeof context === "object" && "kind" in context) {
      return context as GitHubPageContext;
    }
  } catch {
    // Content scripts are intentionally unavailable outside GitHub.
  }
  return contextByTab.get(tabId) ?? getPageContext(fallbackUrl);
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
    if (change.url || change.status === "complete") {
      void broadcastActiveContext(tabId, change.url ?? tab.url);
    }
  });

  browser.tabs.onRemoved.addListener((tabId) => contextByTab.delete(tabId));
});

