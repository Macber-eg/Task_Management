import { describe, expect, it } from "vitest";
import { contentDisposition } from "./content-disposition";

describe("contentDisposition", () => {
  it("serves images inline and other files as attachments", () => {
    expect(contentDisposition("photo.png", true)).toBe(
      `inline; filename="photo.png"; filename*=UTF-8''photo.png`,
    );
    expect(contentDisposition("report.pdf", false)).toBe(
      `attachment; filename="report.pdf"; filename*=UTF-8''report.pdf`,
    );
  });

  it("keeps quotes and line breaks out of the header", () => {
    expect(contentDisposition('evil"\r\nX-Injected: 1.png', false)).toBe(
      `attachment; filename="evilX-Injected: 1.png"; filename*=UTF-8''evilX-Injected%3A%201.png`,
    );
  });

  it("gives non-ASCII names an ASCII fallback and an exact encoded name", () => {
    expect(contentDisposition("Résumé 日本.pdf", false)).toBe(
      `attachment; filename="Resume _.pdf"; filename*=UTF-8''R%C3%A9sum%C3%A9%20%E6%97%A5%E6%9C%AC.pdf`,
    );
  });

  it("replaces path separators and empty names", () => {
    expect(contentDisposition("a/b\\c's (1)*.txt", false)).toBe(
      `attachment; filename="a-b-c's (1)*.txt"; filename*=UTF-8''a%2Fb%5Cc%27s%20%281%29%2A.txt`,
    );
    expect(contentDisposition("  ", true)).toBe(
      `inline; filename="file"; filename*=UTF-8''file`,
    );
  });
});
