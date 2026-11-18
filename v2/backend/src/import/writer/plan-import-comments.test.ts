import { describe, expect, it } from "vitest";
import type { ImportedComment } from "../../importers";
import { planImportComments } from "./plan-import-comments";

const now = new Date("2026-10-11T12:00:00.000Z");

async function authorNames(comments: ImportedComment[]) {
  const rows = planImportComments({
    tasks: [{ id: "task-1", comments }],
    importedBy: "user-1",
    source: "planka",
    now,
  });

  return rows.map((row) => row.externalUserName);
}

describe("planImportComments", () => {
  it("names the author by name, then email, then as unknown", async () => {
    await expect(
      authorNames([
        { author: { name: " Ana ", email: "ana@example.com" }, body: "One" },
        { author: { name: "  ", email: " bo@example.com " }, body: "Two" },
        { author: { email: "   " }, body: "Three" },
        { author: {}, body: "Four" },
      ]),
    ).resolves.toEqual([
      "Ana",
      "bo@example.com",
      "Unknown user",
      "Unknown user",
    ]);
  });

  it("keeps author names within the stored length", async () => {
    const [name] = await authorNames([
      { author: { email: `${"a".repeat(200)}@example.com` }, body: "Long" },
    ]);

    expect(name).toHaveLength(120);
  });
});
