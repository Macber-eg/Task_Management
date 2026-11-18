import { vi } from "vitest";
import type { LabelIntegrationSync } from "../../src/label/label-integration-sync";

function createMocks() {
  return {
    syncLabelToGitHub: vi.fn<LabelIntegrationSync["syncLabelToGitHub"]>(),
    syncLabelToGitea: vi.fn<LabelIntegrationSync["syncLabelToGitea"]>(),
    syncLabelToGitlab: vi.fn<LabelIntegrationSync["syncLabelToGitlab"]>(),
    removeLabelFromGitHub:
      vi.fn<LabelIntegrationSync["removeLabelFromGitHub"]>(),
    removeLabelFromGitea: vi.fn<LabelIntegrationSync["removeLabelFromGitea"]>(),
    removeLabelFromGitlab:
      vi.fn<LabelIntegrationSync["removeLabelFromGitlab"]>(),
    notifySyncWorkspaceLabelChanged:
      vi.fn<LabelIntegrationSync["notifySyncWorkspaceLabelChanged"]>(),
  } satisfies LabelIntegrationSync;
}

export type LabelIntegrationSyncDouble = ReturnType<typeof createMocks>;

/** Clears recorded calls and makes every method resolve again. */
export function resetLabelIntegrationSyncDouble(
  double: LabelIntegrationSyncDouble,
): void {
  for (const method of Object.values(double)) {
    method.mockReset().mockResolvedValue(undefined);
  }
}

/** Records the calls the label services make to the integrations. */
export function createLabelIntegrationSyncDouble(): LabelIntegrationSyncDouble {
  const double = createMocks();
  resetLabelIntegrationSyncDouble(double);
  return double;
}
