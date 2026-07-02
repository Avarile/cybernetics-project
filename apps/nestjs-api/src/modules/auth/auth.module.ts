import { Module } from "@nestjs/common";
import { AuthService } from "./auth.service";
import { CredentialsController } from "./credentials.controller";

@Module({
  controllers: [CredentialsController],
  providers: [AuthService],
})
export class AuthModule {}
