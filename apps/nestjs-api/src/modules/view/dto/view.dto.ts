import { IsDateString, IsNumber, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

// Writable fields only. IssueViewSerializer marks workspace/project/query/owned_by/access/is_locked
// read-only, so those are never accepted from the client. JSON fields are validated loosely as objects.

export class CreateViewDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  display_filters?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  display_properties?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rich_filters?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  archived_at?: string;
}

export class UpdateViewDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  filters?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  display_filters?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  display_properties?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  rich_filters?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsNumber()
  sort_order?: number;

  @IsOptional()
  @IsDateString()
  archived_at?: string;
}
