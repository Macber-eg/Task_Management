import { invitationCopyBundles as bundles } from "./invitation-copy-bundles";

function getBundle(locale?: string | null) {
  const normalizedLocale = locale?.toLowerCase();

  if (normalizedLocale?.startsWith("de")) return bundles.de;
  if (normalizedLocale?.startsWith("fr")) return bundles.fr;
  if (normalizedLocale?.startsWith("ja")) return bundles.ja;
  if (normalizedLocale?.startsWith("pt")) return bundles.pt;
  if (normalizedLocale?.startsWith("vi")) return bundles.vi;
  if (normalizedLocale === "zh-tw") return bundles.zhTW;

  return bundles.en;
}

export function getWorkspaceInvitationEmailCopy(locale?: string | null) {
  return getBundle(locale).email;
}

export function getInvitationRoleLabel(locale: string | null, role: string) {
  const labels: Record<string, string> = getBundle(locale).roles;

  return role
    .split(",")
    .map((name) => name.trim())
    .filter(Boolean)
    .map((name) => (Object.hasOwn(labels, name) ? labels[name] : name))
    .join(", ");
}

export function getInvitationEmailSubject(
  locale: string | null,
  inviterName: string,
  workspaceName: string,
) {
  const values: Record<string, string> = { inviterName, workspaceName };

  return getWorkspaceInvitationEmailCopy(locale).subject.replace(
    /\{\{(\w+)\}\}/g,
    (_match, key: string) => values[key] ?? "",
  );
}
