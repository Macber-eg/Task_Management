import { authError } from "../auth-error";
import { isTrustedCallbackURL } from "../social/trusted-callback-url";

export type RedirectTargets = {
  callbackURL?: string;
  redirectTo?: string;
  errorCallbackURL?: string;
  newUserCallbackURL?: string;
};

/**
 * Every redirect target a request names must be the web app, the API or a
 * relative path, so an emailed link cannot be turned into an open redirect.
 */
export function assertTrustedRedirects(targets: RedirectTargets): void {
  const checks = [
    [targets.callbackURL, "INVALID_CALLBACK_URL"],
    [targets.redirectTo, "INVALID_REDIRECT_URL"],
    [targets.errorCallbackURL, "INVALID_ERROR_CALLBACK_URL"],
    [targets.newUserCallbackURL, "INVALID_NEW_USER_CALLBACK_URL"],
  ] as const;
  for (const [url, code] of checks) {
    if (url && !isTrustedCallbackURL(url)) throw authError(code);
  }
}
