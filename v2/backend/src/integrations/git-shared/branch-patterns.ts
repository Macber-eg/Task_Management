/** Branch naming schemes a git integration can link branches to tasks by. */
export const branchPatterns = [
  "{slug}-{number}",
  "{slug}-{number}-{title}",
  "{number}",
  "{number}-{title}",
  "feature/{slug}-{number}",
  "feature/{number}-{title}",
  "fix/{slug}-{number}",
  "fix/{number}-{title}",
] as const;

export type BranchPattern = (typeof branchPatterns)[number] | "custom";

/** The branch settings every git provider's config carries. */
export type BranchMatchConfig = {
  branchPattern?: string;
  customBranchRegex?: string;
};
