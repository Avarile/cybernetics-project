import type { Database } from "../../infra/database/drizzle.module";
import { instances } from "../../infra/database/schema";
import { AuthError, AUTHENTICATION_ERROR_CODES } from "../../infra/auth/error-codes";

/**
 * `if instance is None or not instance.is_setup_done` -- the first check in every Django auth view
 * (check.py::EmailCheckEndpoint, email.py::SignInAuthEndpoint/SignUpAuthEndpoint, magic.py's three
 * endpoints). Extracted here so it's one implementation shared across the auth surface instead of
 * copy-pasted per call site -- see EmailProvider.assertInstanceSetup and
 * MagicGenerateController.assertInstanceSetup, which predate this helper and still duplicate it
 * (Task 6 migrates them onto this).
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
