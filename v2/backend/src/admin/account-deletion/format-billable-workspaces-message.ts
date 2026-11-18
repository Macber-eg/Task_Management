export function formatBillableWorkspacesMessage(names: string[]) {
  const quoted = names.map((name) => `"${name}"`);
  const list =
    quoted.length === 1
      ? quoted[0]
      : `${quoted.slice(0, -1).join(", ")} and ${quoted[quoted.length - 1]}`;

  return `${list} still ${names.length === 1 ? "has" : "have"} an active subscription. Cancel it in billing settings before deleting.`;
}
