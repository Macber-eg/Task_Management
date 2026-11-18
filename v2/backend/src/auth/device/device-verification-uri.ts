import { clientUrl } from "../social/auth-urls";

/** The web app's device screen, where the person enters the user code. */
export function deviceVerificationUri(): string {
  return `${clientUrl().replace(/\/$/, "")}/device`;
}

export function deviceVerificationUris(userCode: string) {
  const verification = new URL(deviceVerificationUri());
  const complete = new URL(verification);
  complete.searchParams.set("user_code", userCode);
  return {
    verificationUri: verification.toString(),
    verificationUriComplete: complete.toString(),
  };
}
