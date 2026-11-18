import { render } from "@react-email/render";
import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { getWorkspaceInvitationEmailCopy } from "../invitation-email-copy";
import WorkspaceInvitationEmail from "./workspace-invitation";

describe("WorkspaceInvitationEmail", () => {
  it("renders the invitation in French for a French locale", async () => {
    const html = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "Équipe Produit",
        inviterName: "Camille",
        inviterEmail: "camille@example.com",
        invitationLink: "https://kaneo.example/invite/abc",
        to: "invite@example.com",
        copy: getWorkspaceInvitationEmailCopy("fr-FR"),
      }),
    );

    expect(html).toContain("Rejoindre Équipe Produit");
    expect(html).toContain("Accepter l’invitation");
    expect(html).toContain("Camille (camille@example.com)");
  });

  it("renders the invitation in Japanese for a Japanese locale", async () => {
    const html = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "プロダクト",
        inviterName: "アリス",
        inviterEmail: "alice@example.com",
        invitationLink: "https://kaneo.example/invite/abc",
        to: "invite@example.com",
        copy: getWorkspaceInvitationEmailCopy("ja-JP"),
      }),
    );

    expect(html).toContain("「プロダクト」に参加");
    expect(html).toContain("招待を承諾");
    expect(html).toContain("アリス (alice@example.com)");
  });

  it("renders the invitation in Traditional Chinese for a zh-TW locale", async () => {
    const html = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "產品團隊",
        inviterName: "Alice",
        inviterEmail: "alice@example.com",
        invitationLink: "https://kaneo.example/invite/abc",
        to: "invite@example.com",
        copy: getWorkspaceInvitationEmailCopy("zh-TW"),
      }),
    );

    expect(html).toContain("加入 產品團隊");
    expect(html).toContain("接受邀請");
  });
});

describe("WorkspaceInvitationEmail default copy", () => {
  it("renders without a copy prop so previews and exports work", async () => {
    const html = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "Acme Inc",
        inviterName: "John Doe",
        inviterEmail: "john@acme.com",
        invitationLink: "https://kaneo.app/invite/abc123",
        to: "invitee@example.com",
      }),
    );

    expect(html).toContain("Join Acme Inc");
    expect(html).toContain("Accept invitation");
  });

  it("keeps the fallback in sync with the en-US bundle", async () => {
    const html = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "Acme Inc",
        inviterName: "John Doe",
        inviterEmail: "john@acme.com",
        invitationLink: "https://kaneo.app/invite/abc123",
        to: "invitee@example.com",
      }),
    );
    const withEnUs = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "Acme Inc",
        inviterName: "John Doe",
        inviterEmail: "john@acme.com",
        invitationLink: "https://kaneo.app/invite/abc123",
        to: "invitee@example.com",
        copy: getWorkspaceInvitationEmailCopy("en-US"),
      }),
    );

    expect(html).toBe(withEnUs);
  });

  it("renders the role and expiry with translated labels", async () => {
    const html = await render(
      createElement(WorkspaceInvitationEmail, {
        workspaceName: "Équipe Produit",
        inviterName: "Camille",
        inviterEmail: "camille@example.com",
        invitationLink: "https://kaneo.example/invite/abc",
        to: "invite@example.com",
        locale: "fr-FR",
        role: "Membre",
        expiresAt: new Date("2026-10-13T12:00:00Z"),
        copy: getWorkspaceInvitationEmailCopy("fr-FR"),
      }),
    );

    expect(html).toContain("Détails de l’invitation");
    expect(html).toContain("Membre");
    expect(html).toContain("13 oct. 2026");
  });
});
