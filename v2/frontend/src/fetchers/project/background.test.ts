import { beforeEach, describe, expect, it, vi } from "vitest";
import { removeProjectBackground, uploadProjectBackground } from "./background";

const mocks = vi.hoisted(() => ({
  upload: vi.fn(),
  remove: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  client: {
    project: {
      ":id": {
        "background-upload": { $post: mocks.upload },
        background: { $delete: mocks.remove },
      },
    },
  },
}));

describe("project background fetchers", () => {
  beforeEach(() => {
    mocks.upload.mockReset();
    mocks.remove.mockReset();
  });

  it("uploads the image as one multipart request", async () => {
    const file = new File(["image bytes"], "board.png", {
      type: "image/png",
    });
    mocks.upload.mockResolvedValue({
      ok: true,
      json: async () => ({ url: "/api/project/project-1/background?v=v1" }),
    });

    await expect(uploadProjectBackground("project-1", file)).resolves.toEqual({
      url: "/api/project/project-1/background?v=v1",
    });

    expect(mocks.upload).toHaveBeenCalledWith({
      param: { id: "project-1" },
      form: { file },
    });
  });

  it("throws the API error when the upload is rejected", async () => {
    mocks.upload.mockResolvedValue(
      new Response(JSON.stringify({ message: "The image is too large" }), {
        status: 413,
      }),
    );

    await expect(
      uploadProjectBackground("project-1", new File(["x"], "big.png")),
    ).rejects.toThrow("The image is too large");
  });

  it("removes the project background", async () => {
    mocks.remove.mockResolvedValue({ ok: true });

    await removeProjectBackground("project-1");

    expect(mocks.remove).toHaveBeenCalledWith({
      param: { id: "project-1" },
    });
  });
});
