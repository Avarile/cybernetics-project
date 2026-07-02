import {
  IsArray,
  IsDateString,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from "class-validator";
import { MODULE_STATUS } from "../module.schema";

export class CreateModuleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  description_text?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  description_html?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  start_date?: string | null;

  @IsOptional()
  @IsDateString()
  target_date?: string | null;

  @IsOptional()
  @IsIn(MODULE_STATUS as unknown as string[])
  status?: string;

  @IsOptional()
  @IsUUID()
  lead_id?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  member_ids?: string[];

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  external_source?: string;

  @IsOptional()
  @IsString()
  external_id?: string;
}

export class UpdateModuleDto {
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
  description_text?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  description_html?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  start_date?: string | null;

  @IsOptional()
  @IsDateString()
  target_date?: string | null;

  @IsOptional()
  @IsIn(MODULE_STATUS as unknown as string[])
  status?: string;

  @IsOptional()
  @IsUUID()
  lead_id?: string | null;

  @IsOptional()
  @IsArray()
  @IsUUID(undefined, { each: true })
  member_ids?: string[];

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  external_source?: string;

  @IsOptional()
  @IsString()
  external_id?: string;
}
