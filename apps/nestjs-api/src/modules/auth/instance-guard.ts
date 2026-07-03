import type { Database } from "../../infra/database/drizzle.module";
import { instances } from "../../infra/database/schema";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../infra/auth/error-codes";

/**
 * `if instance is None or not instance.is_setup_done` -- the check from Django's
 * check.py::EmailCheckEndpoint / email.py::SignInAuthEndpoint & SignUpAuthEndpoint. Django only wires
 * it into magic.py on MagicGenerateEndpoint, not MagicSignInEndpoint/MagicSignUpEndpoint; here it's
 * applied uniformly across every auth entry point (EmailProvider, MagicGenerateController, the magic
 * credentials controllers) as consistent hardening -- a deliberate, harmless broadening of Django's
 * coverage. Extracted here so it's one implementation shared across the auth surface instead of
 * copy-pasted per call site.
 */
export async function assertInstanceSetup(db: Database): Promise<void> {
  const [instance] = await db.select().from(instances).limit(1);
  if (!instance || !instance.isSetupDone) {
    throw new AuthError({
      code: AUTHENTICATION_ERROR_CODES.INSTANCE_NOT_CONFIGURED,
      message: "INSTANCE_NOT_CONFIGURED",
    });
  }
}
