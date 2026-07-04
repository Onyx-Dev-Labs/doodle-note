import { getDb } from "@repo/db";

import { createAuth } from "./create-auth";

/** App-wide Better Auth instance over the shared database client. */
export const auth = createAuth(getDb());
