import type { ProjectPhase } from "@/fetchers/planning/planning-api";

export type PhaseTreeNode = ProjectPhase & {
  children: PhaseTreeNode[];
};

export function buildPhaseTree(phases: ProjectPhase[]): PhaseTreeNode[] {
  const byId = new Map<string, PhaseTreeNode>();
  const roots: PhaseTreeNode[] = [];

  for (const phase of phases) {
    byId.set(phase.id, { ...phase, children: [] });
  }

  for (const phase of phases) {
    const node = byId.get(phase.id);
    if (!node) continue;
    const parentId = phase.parentId ?? null;
    // Legacy rows without parent_id are treated as roots.
    if (parentId && byId.has(parentId)) {
      byId.get(parentId)?.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const sortNodes = (nodes: PhaseTreeNode[]) => {
    nodes.sort(
      (a, b) => a.position - b.position || a.name.localeCompare(b.name),
    );
    for (const node of nodes) sortNodes(node.children);
  };
  sortNodes(roots);
  return roots;
}
