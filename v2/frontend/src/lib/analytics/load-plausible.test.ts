import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  delete window.plausible;
  for (const script of document.head.querySelectorAll("script")) {
    script.remove();
  }
});

describe("loadPlausible", () => {
  it("does nothing without settings", async () => {
    const { loadPlausible } = await import("./load-plausible");
    loadPlausible(null);
    expect(document.head.querySelector("script")).toBeNull();
    expect(window.plausible).toBeUndefined();
  });

  it("adds the script once and queues early events", async () => {
    const { loadPlausible } = await import("./load-plausible");
    const settings = {
      plausibleDomain: "app.example.com",
      scriptUrl: "https://plausible.example.com/js/script.js",
    };

    loadPlausible(settings);
    loadPlausible(settings);

    const scripts = document.head.querySelectorAll("script");
    expect(scripts).toHaveLength(1);
    expect(scripts[0]?.dataset.domain).toBe("app.example.com");
    expect(scripts[0]?.src).toBe(settings.scriptUrl);
    expect(typeof window.plausible).toBe("function");
  });
});
