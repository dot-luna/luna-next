export const HOST = "org.dot_luna.browser_links";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** Allow exact origins, including scheme and port; subdomains do not inherit permission. */
export function originRules(origins: string[]): chrome.declarativeNetRequest.Rule[] {
  return [...new Set(origins)].map((origin, index) => ({
    id: index + 10,
    priority: 2,
    action: { type: "allow" as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      regexFilter: `^${escapeRegex(new URL(origin).origin)}/`,
      resourceTypes: ["main_frame" as chrome.declarativeNetRequest.ResourceType],
    },
  }));
}

/** Static routing remains active while the worker sleeps; only top-level navigations are intercepted. */
export function redirectRule(extensionId: string) {
  return {
    id: 1,
    priority: 1,
    action: {
      type: "redirect",
      redirect: {
        regexSubstitution: `chrome-extension://${extensionId}/open.html#\\1`,
      },
    },
    condition: {
      regexFilter: "^(https?://.*)$",
      requestMethods: ["get"],
      resourceTypes: ["main_frame"],
    },
  };
}
