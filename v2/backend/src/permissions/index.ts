// The permission vocabulary and the built-in workspace roles. The frontend
// keeps its own copy in `src/lib/permissions`; the two must stay in step.

type Statements = Record<string, readonly string[]>;

function role<S extends Statements>(statements: S) {
  return { statements };
}

const organizationStatement = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

const memberOrganizationStatements = {
  organization: [],
  member: [],
  invitation: [],
  team: [],
  ac: ["read"],
} as const;

const adminOrganizationStatements = {
  organization: ["update"],
  invitation: ["create", "cancel"],
  member: ["create", "update", "delete"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

const ownerOrganizationStatements = {
  organization: ["update", "delete"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  team: ["create", "update", "delete"],
  ac: ["create", "read", "update", "delete"],
} as const;

export const statement = {
  ...organizationStatement,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
} as const;

export const viewer = role({
  ...memberOrganizationStatements,
  project: ["read"],
  task: ["read"],
  label: ["read"],
  workspace: ["read"],
} as const);

export const member = role({
  ...memberOrganizationStatements,
  project: ["create", "read"],
  task: ["create", "read", "update"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read"],
} as const);

export const admin = role({
  ...adminOrganizationStatements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "manage_settings"],
} as const);

export const owner = role({
  ...ownerOrganizationStatements,
  project: ["create", "read", "update", "delete", "share"],
  task: ["create", "read", "update", "delete", "assign"],
  label: ["create", "read", "update", "delete"],
  workspace: ["read", "update", "delete", "manage_settings"],
} as const);

export const builtInRoles = { viewer, member, admin, owner } as const;

export type BuiltInRoleName = keyof typeof builtInRoles;

// Default-role names seeded per workspace. Their permissions live as editable
// rows in `workspace_role`, but the names are reserved. `owner` is not in
// this list: it is the one role whose permissions are fixed in code.
export const DEFAULT_ROLE_NAMES = ["viewer", "member", "admin"] as const;
export type DefaultRoleName = (typeof DEFAULT_ROLE_NAMES)[number];

function toMutablePayload(statements: Statements): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [resource, actions] of Object.entries(statements)) {
    out[resource] = [...actions];
  }
  return out;
}

/** JSON stored in `workspace_role.permission` for the seeded default roles. */
export const defaultRolePayloads: Record<
  DefaultRoleName,
  Record<string, string[]>
> = {
  viewer: toMutablePayload(viewer.statements),
  member: toMutablePayload(member.statements),
  admin: toMutablePayload(admin.statements),
};

export {
  WORKSPACE_CAPABILITY_NAMES,
  type WorkspaceCapability,
  workspaceCapabilities,
} from "./capabilities";
