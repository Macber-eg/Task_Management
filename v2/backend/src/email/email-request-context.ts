import { parseUserAgent, type UserAgentDevice } from "./parse-user-agent";

export type EmailRequestContext = {
  requestedAt: Date;
  device?: UserAgentDevice;
};

/** When and from which kind of device a sign-in or recovery email was asked for. */
export function getEmailRequestContext(
  userAgent: string | null | undefined,
): EmailRequestContext {
  return {
    requestedAt: new Date(),
    device: parseUserAgent(userAgent),
  };
}
