import { describe, expect, it } from "vitest";
import { trustedProxyMatcher } from "./trusted-proxies";

describe("trustedProxyMatcher", () => {
  it("trusts loopback by default, including IPv4-mapped addresses", () => {
    const trust = trustedProxyMatcher(undefined);
    expect(trust("127.0.0.1")).toBe(true);
    expect(trust("::1")).toBe(true);
    expect(trust("::ffff:127.0.0.1")).toBe(true);
    expect(trust("203.0.113.9")).toBe(false);
  });

  it("trusts configured ranges and nothing for 'none'", () => {
    const trust = trustedProxyMatcher("172.16.0.0/12, 10.0.0.1");
    expect(trust("::ffff:172.20.0.4")).toBe(true);
    expect(trust("10.0.0.1")).toBe(true);
    expect(trust("10.0.0.2")).toBe(false);
    expect(trustedProxyMatcher("none")("127.0.0.1")).toBe(false);
  });

  it("rejects malformed configuration at startup", () => {
    expect(() => trustedProxyMatcher("not-an-ip")).toThrow(/TRUSTED_PROXIES/);
    expect(() => trustedProxyMatcher("10.0.0.0/33")).toThrow(/TRUSTED_PROXIES/);
  });
});
