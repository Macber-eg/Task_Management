import { extendZodWithOpenApi } from "@asteasolutions/zod-to-openapi";
import { z } from "zod";

// Adds `.openapi()` to every Zod schema. Schemas must import `z` from here so
// the extension is installed before the first schema is built.
extendZodWithOpenApi(z);

export { z };
