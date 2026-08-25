import { createStart, createCsrfMiddleware } from "@tanstack/react-start";

import { renderErrorPage } from "./lib/error-page";
import { attachSupabaseAuth } from "@/integrations/supabase/auth-attacher";
import { toStartMiddleware } from "@/lib/middleware/to-start";
import { withLovableErrors } from "@/lib/lovable-middleware/with-lovable-errors";

// Replaces the hand-rolled errorMiddleware. Same behaviour, but it also sees
// the way out, which is what lets it recover an error h3 already flattened —
// previously done by sniffing response bodies in src/server.ts.
const errorMiddleware = toStartMiddleware([withLovableErrors({ renderPage: renderErrorPage })]);

// Start installs this automatically when src/start.ts is absent; defining the
// file opts out, so re-add it explicitly to keep server functions protected
// from cross-site requests.
const csrfMiddleware = createCsrfMiddleware({
  filter: (ctx) => ctx.handlerType === "serverFn",
});

export const startInstance = createStart(() => ({
  functionMiddleware: [attachSupabaseAuth],
  // Order matters: errors outermost, CSRF within — same as before.
  requestMiddleware: [errorMiddleware, csrfMiddleware],
}));
