import type { FullOrganization, Organization } from "@/lib/auth/types";

// Lists return plain workspaces; the full lookup adds members and invitations.
export type Workspace = Organization & Partial<FullOrganization>;

export type ActiveWorkspace = FullOrganization;

export default Workspace;
