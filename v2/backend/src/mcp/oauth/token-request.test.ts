import { describe, expect, it } from "vitest";
import { parseTokenRequest } from "./token-request";

const grant = {
  grant_type: "authorization_code",
  code: "code",
  client_id: "client",
  code_verifier: "verifier",
  redirect_uri: "https://client.example/callback",
};

describe("parseTokenRequest", () => {
  it("reads a form-encoded grant", () => {
    const result = parseTokenRequest(
      "application/x-www-form-urlencoded; charset=utf-8",
      new URLSearchParams(grant).toString(),
    );
    expect(result).toEqual({
      ok: true,
      request: {
        code: "code",
        client_id: "client",
        code_verifier: "verifier",
        redirect_uri: "https://client.example/callback",
      },
    });
  });

  it("reads a JSON grant, whatever the content type says", () => {
    expect(parseTokenRequest("", JSON.stringify(grant)).ok).toBe(true);
  });

  it.each(["", "null", "[]", "{bad", '"text"'])(
    "refuses a body that is not an object: %j",
    (body) => {
      expect(parseTokenRequest("application/json", body)).toEqual({
        ok: false,
        error: "invalid_request",
      });
    },
  );

  it("refuses other grant types first", () => {
    expect(
      parseTokenRequest(
        "application/json",
        JSON.stringify({ grant_type: "refresh_token" }),
      ),
    ).toEqual({ ok: false, error: "unsupported_grant_type" });
  });

  it.each([
    ["code", ""],
    ["code", "x".repeat(129)],
    ["client_id", "x".repeat(129)],
    ["code_verifier", "x".repeat(129)],
    ["redirect_uri", "x".repeat(2049)],
  ])("refuses an empty or oversized %s", (field, value) => {
    expect(
      parseTokenRequest(
        "application/json",
        JSON.stringify({ ...grant, [field]: value }),
      ),
    ).toEqual({ ok: false, error: "invalid_request" });
  });

  it("refuses a non-string field", () => {
    expect(
      parseTokenRequest("application/json", JSON.stringify({ ...grant, code: {} })),
    ).toEqual({ ok: false, error: "invalid_request" });
  });
});
