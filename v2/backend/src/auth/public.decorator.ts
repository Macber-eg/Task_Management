import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "auth:public";

/** Marks a route (or controller) that needs no credentials. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
