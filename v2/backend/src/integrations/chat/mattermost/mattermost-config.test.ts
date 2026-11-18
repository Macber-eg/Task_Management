import { afterEach, describe, expect, it, vi } from "vitest";
import { validateMattermostConfig } from "./mattermost-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("validateMattermostConfig", () => {
  it("rejects private webhook destinations by default", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "");

    const result = await validateMattermostConfig({
      webhookUrl: "https://127.0.0.1/hooks/example",
    });

    expect(result.valid).toBe(false);
    expect(result.errors?.join(" ")).toContain("non-routable address");
  });

  it("allows private destinations when the self-hosting override is enabled", async () => {
    vi.stubEnv("KANEO_ALLOW_PRIVATE_WEBHOOK_DESTINATIONS", "true");

    const result = await validateMattermostConfig({
      webhookUrl: "https://127.0.0.1/hooks/example",
    });

    expect(result).toEqual({ valid: true });
  });

  it("rejects an explicitly empty webhook URL", async () => {
    const result = await validateMattermostConfig({ webhookUrl: "" });

    expect(result.valid).toBe(false);
  });
});
