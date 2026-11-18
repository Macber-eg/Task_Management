import { ApiError } from "./api-error";
import {
  formatValidationIssues,
  type ValidationIssueInput,
} from "./validation-issues";

export function validationError(
  issues: readonly ValidationIssueInput[],
  target?: string,
  message?: string,
) {
  const formatted = formatValidationIssues(issues, target);
  return new ApiError(400, {
    message: message ?? formatted.message,
    code: "VALIDATION_ERROR",
    issues: formatted.issues,
  });
}
