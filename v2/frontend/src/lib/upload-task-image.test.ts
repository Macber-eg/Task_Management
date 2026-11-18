import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { asUploadPart, uploadTaskImage } from "./upload-task-image";

const mocks = vi.hoisted(() => ({
  createImageUpload: vi.fn(),
}));

vi.mock("@/fetchers/task/create-image-upload", () => ({
  default: mocks.createImageUpload,
}));

describe("uploadTaskImage", () => {
  beforeEach(() => {
    mocks.createImageUpload.mockResolvedValue({
      id: "asset-1",
      url: "/api/asset/asset-1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("sends a file the browser cannot classify as binary", async () => {
    const file = new File(["server config"], "server.conf");

    const asset = await uploadTaskImage({
      taskId: "task-1",
      surface: "comment",
      file,
    });

    expect(file.type).toBe("");
    const sent = mocks.createImageUpload.mock.calls[0]?.[0];
    expect(sent).toMatchObject({ taskId: "task-1", surface: "comment" });
    expect(sent.file.type).toBe("application/octet-stream");
    expect(sent.file.name).toBe("server.conf");
    expect(asset).toMatchObject({
      url: "/api/asset/asset-1",
      mimeType: "application/octet-stream",
      kind: "attachment",
    });
  });

  it("preserves a browser-provided content type", async () => {
    const file = new File(["image"], "image.png", { type: "image/png" });

    const asset = await uploadTaskImage({
      taskId: "task-1",
      surface: "description",
      file,
    });

    expect(mocks.createImageUpload).toHaveBeenCalledWith({
      taskId: "task-1",
      surface: "description",
      file,
    });
    expect(asset.mimeType).toBe("image/png");
    expect(asset.kind).toBe("image");
  });

  it("rejects empty files before uploading", async () => {
    await expect(
      uploadTaskImage({
        taskId: "task-1",
        surface: "comment",
        file: new File([], "empty.txt"),
      }),
    ).rejects.toThrow("Only non-empty file uploads are supported.");
    expect(mocks.createImageUpload).not.toHaveBeenCalled();
  });
});

describe("asUploadPart", () => {
  it("names an unnamed paste", () => {
    const part = asUploadPart(
      new File(["x"], "", { type: "image/png" }),
      "image",
    );
    expect(part.name).toBe("image");
    expect(part.type).toBe("image/png");
  });
});
