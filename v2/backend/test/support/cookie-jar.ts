/**
 * A minimal browser cookie store for tests: remembers what responses set and
 * sends back only the cookies whose `Path` covers the request, which is what
 * keeps the refresh token away from non-auth routes.
 */
export class CookieJar {
  private readonly cookies = new Map<string, { value: string; path: string }>();

  store(response: Response): void {
    for (const header of response.headers.getSetCookie()) {
      const [pair = "", ...attributes] = header.split(";");
      const separator = pair.indexOf("=");
      const name = pair.slice(0, separator).trim();
      const value = pair.slice(separator + 1).trim();
      const pathAttribute = attributes
        .map((attribute) => attribute.trim())
        .find((attribute) => attribute.toLowerCase().startsWith("path="));
      const path = pathAttribute ? pathAttribute.slice(5) : "/";
      const expired = attributes.some((attribute) =>
        /^expires=thu, 01 jan 1970/i.test(attribute.trim()),
      );
      if (!value || expired) this.cookies.delete(name);
      else this.cookies.set(name, { value, path });
    }
  }

  header(requestPath: string): string {
    return [...this.cookies]
      .filter(([, cookie]) => requestPath.startsWith(cookie.path))
      .map(([name, cookie]) => `${name}=${cookie.value}`)
      .join("; ");
  }

  get(name: string): string | undefined {
    return this.cookies.get(name)?.value;
  }

  set(name: string, value: string, path = "/"): void {
    this.cookies.set(name, { value, path });
  }

  delete(name: string): void {
    this.cookies.delete(name);
  }

  names(): string[] {
    return [...this.cookies.keys()];
  }
}
