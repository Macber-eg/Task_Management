import { Injectable } from "@nestjs/common";

/**
 * The fixed endpoints of the built-in providers. A provider class of its own
 * so integration tests can point them at a local fake.
 */
@Injectable()
export class SocialProviderEndpoints {
  github = {
    authorize: "https://github.com/login/oauth/authorize",
    token: "https://github.com/login/oauth/access_token",
    user: "https://api.github.com/user",
    emails: "https://api.github.com/user/emails",
  };

  google = {
    authorize: "https://accounts.google.com/o/oauth2/v2/auth",
    token: "https://oauth2.googleapis.com/token",
  };

  discord = {
    authorize: "https://discord.com/api/oauth2/authorize",
    token: "https://discord.com/api/oauth2/token",
    user: "https://discord.com/api/users/@me",
  };
}
