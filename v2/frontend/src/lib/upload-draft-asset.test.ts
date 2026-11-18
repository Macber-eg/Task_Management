import { beforeEach, describe, expect, it, vi } from "vitest";
import { uploadDraftAsset } from "./upload-draft-asset";

const mocks = vi.hoisted(() => ({ upload: vi.fn() }));

vi.mock("@/lib/api", () => ({
  client: {
    task: { "draft-upload": { ":projectId": { $post: mocks.upload } } },
  },
}));

describe("uploadDraftAsset", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
    mocks.upload.mockResolvedValue({
      ok: true,
      json: async () => ({ id: "asset-1", url: "/api/asset/asset-1" }),
    });
  });

  it("stages the file with one multipart request", async () => {
    const file = new File(["png"], "shot.png", { type: "image/png" });

    const asset = await uploadDraftAsset("project-1", file);

    expect(mocks.upload).toHaveBeenCalledWith({
      param: { projectId: "project-1" },
      form: { file },
    });
    expect(asset).toEqual({
      id: "asset-1",
      url: "/api/asset/asset-1",
      alt: "shot",
      filename: "shot.png",
      kind: "image",
      mimeType: "image/png",
      size: file.size,
    });
  });

  it("sends an unclassified file as a named binary attachment", async () => {
    const asset = await uploadDraftAsset(
      "project-1",
      new File(["data"], "", { type: "" }),
    );

    const sent = mocks.upload.mock.calls[0]?.[0].form.file as File;
    expect(sent.name).toBe("file");
    expect(sent.type).toBe("application/octet-stream");
    expect(asset.kind).toBe("attachment");
  });
});
