import { HTTPException } from "./http-exception";

export type ApiErrorIssue = { path: string; message: string };

export type ApiErrorBody = {
  message: string;
  code: string;
  issues?: ApiErrorIssue[];
  missingPermissions?: string[];
};

export class ApiError extends HTTPException {
  readonly code: string;
  readonly issues?: ApiErrorIssue[];
  readonly missingPermissions?: string[];

  constructor(status: number, body: ApiErrorBody) {
    super(status, { message: body.message });
    this.code = body.code;
    this.issues = body.issues;
    this.missingPermissions = body.missingPermissions;
  }
}
