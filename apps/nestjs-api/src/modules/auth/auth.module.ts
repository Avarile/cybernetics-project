import { Module } from "@nestjs/common";
import { CsrfService } from "../../infra/auth/csrf.service";
import { AuthService } from "./auth.service";
import { CredentialsController } from "./credentials.controller";
import { CsrfController } from "./csrf.controller";
import { EmailCheckController } from "./email-check.controller";
import { EmailProvider } from "./email.provider";
import { CredentialsSpaceController } from "./spaces/credentials-space.controller";

@Module({
  controllers: [CredentialsController, CredentialsSpaceController, CsrfController, EmailCheckController],
  providers: [AuthService, CsrfService, EmailProvider],
  exports: [CsrfService],
})
export class AuthModule {}
