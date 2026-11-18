import { describe, expect, it } from "vitest";
import { broadcastTrigger, signalsForPath } from "./signals";

describe("signalsForPath", () => {
  it("refreshes the session after sign-in and sign-out", () => {
    expect(signalsForPath("/sign-in/email")).toEqual(["$sessionSignal"]);
    expect(signalsForPath("/sign-out")).toEqual([
      "$sessionSignal",
      "$activeOrgSignal",
    ]);
  });

  it("refreshes organization state after organization calls", () => {
    expect(signalsForPath("/organization/create")).toEqual([
      "$sessionSignal",
      "$listOrg",
      "$activeOrgSignal",
    ]);
    expect(signalsForPath("/organization/set-active")).toEqual([
      "$sessionSignal",
      "$activeOrgSignal",
      "$activeMemberSignal",
      "$activeMemberRoleSignal",
    ]);
    expect(signalsForPath("/organization/invite-member")).toEqual([
      "$activeOrgSignal",
    ]);
  });

  it("ignores reads outside organization", () => {
    expect(signalsForPath("/get-session")).toEqual([]);
    expect(signalsForPath("/api-key/list")).toEqual([]);
  });
});

describe("broadcastTrigger", () => {
  it("names the cross-tab events", () => {
    expect(broadcastTrigger("/sign-out")).toBe("signout");
    expect(broadcastTrigger("/update-user")).toBe("updateUser");
    expect(broadcastTrigger("/sign-in/email")).toBe("signin");
    expect(broadcastTrigger("/organization/list")).toBeNull();
  });
});
