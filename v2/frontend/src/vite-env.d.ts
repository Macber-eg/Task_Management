/// <reference types="vite/client" />
/// <reference types="vite/types/importMeta.d.ts" />

declare const __APP_VERSION__: string;

interface ImportMetaEnv {
  /** Backend base URL; empty means same origin. The only variable the app reads. */
  readonly VITE_API_URL?: string;
}

interface CookieStoreCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  priority?: "Low" | "Medium" | "High";
}

interface CookieStore {
  get(name: string): Promise<CookieStoreCookie | null>;
  getAll(name?: string): Promise<CookieStoreCookie[]>;
  set(cookie: {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    maxAge?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    priority?: "Low" | "Medium" | "High";
  }): Promise<void>;
  delete(
    name: string,
    options?: { path?: string; domain?: string },
  ): Promise<void>;
}

declare const cookieStore: CookieStore;

interface CookieStoreCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  maxAge?: number;
  secure?: boolean;
  httpOnly?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
  priority?: "Low" | "Medium" | "High";
}

interface CookieStore {
  get(name: string): Promise<CookieStoreCookie | null>;
  getAll(name?: string): Promise<CookieStoreCookie[]>;
  set(cookie: {
    name: string;
    value: string;
    domain?: string;
    path?: string;
    expires?: number;
    maxAge?: number;
    secure?: boolean;
    httpOnly?: boolean;
    sameSite?: "Strict" | "Lax" | "None";
    priority?: "Low" | "Medium" | "High";
  }): Promise<void>;
  delete(
    name: string,
    options?: { path?: string; domain?: string },
  ): Promise<void>;
}
