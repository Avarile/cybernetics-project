import { Module } from "@nestjs/common";
import { EmailRepository } from "./email.repository";
import { TRANSACTIONAL_EMAIL_HANDLERS } from "./transactional-email.handlers";

// Worker-side transactional email handlers (discovered via @CeleryTaskHandler).
@Module({
  providers: [EmailRepository, ...TRANSACTIONAL_EMAIL_HANDLERS],
})
export class EmailModule {}
