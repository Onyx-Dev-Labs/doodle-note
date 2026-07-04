import { organizationClient } from "better-auth/client/plugins";
import { createAuthClient } from "better-auth/react";

/** Browser-side auth client; same-origin base URL. */
export const authClient = createAuthClient({
  plugins: [organizationClient()],
});
