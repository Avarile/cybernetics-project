import { Module } from "@nestjs/common";
import { CsrfService } from "../../infra/auth/csrf.service";
import { AuthService } from "./auth.service";
import { CredentialsController } from "./credentials.controller";
import { CsrfController } from "./csrf.controller";
import { EmailCheckController } from "./email-check.controller";
import { EmailProvider } from "./email.provider";
import { MagicCodeService } from "./magic/magic-code.service";
import { MagicCredentialsController } from "./magic/magic-credentials.controller";
import { MagicGenerateController } from "./magic/magic-generate.controller";
import { CredentialsSpaceController } from "./spaces/credentials-space.controller";

@Module({
  controllers: [
    CredentialsController,
    CredentialsSpaceController,
    CsrfController,
    EmailCheckController,
    MagicCredentialsController,
    MagicGenerateController,
  ],
  providers: [AuthService, CsrfService, EmailProvider, MagicCodeService],
  exports: [CsrfService],
})
export class AuthModule {}
