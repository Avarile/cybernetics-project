import { IsBoolean, IsOptional, IsString, IsUrl } from "class-validator";

export class CreateWebhookDto {
  @IsString()
  @IsUrl({ require_tld: false })
  url!: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  project?: boolean;

  @IsOptional()
  @IsBoolean()
  issue?: boolean;

  @IsOptional()
  @IsBoolean()
  module?: boolean;

  @IsOptional()
  @IsBoolean()
  cycle?: boolean;

  @IsOptional()
  @IsBoolean()
  issue_comment?: boolean;
}

export class UpdateWebhookDto {
  @IsOptional()
  @IsString()
  @IsUrl({ require_tld: false })
  url?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsBoolean()
  project?: boolean;

  @IsOptional()
  @IsBoolean()
  issue?: boolean;

  @IsOptional()
  @IsBoolean()
  module?: boolean;

  @IsOptional()
  @IsBoolean()
  cycle?: boolean;

  @IsOptional()
  @IsBoolean()
  issue_comment?: boolean;
}
