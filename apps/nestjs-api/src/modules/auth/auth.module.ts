import { Module } from "@nestjs/common";
import { CsrfService } from "../../infra/auth/csrf.service";
import { AuthService } from "./auth.service";
import { CredentialsController } from "./credentials.controller";
import { CsrfController } from "./csrf.controller";

@Module({
  controllers: [CredentialsController, CsrfController],
  providers: [AuthService, CsrfService],
  exports: [CsrfService],
})
export class AuthModule {}
