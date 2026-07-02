import { IsArray, IsBoolean, IsIn, IsInt, IsObject, IsOptional, IsString, IsUUID } from "class-validator";
import { PAGE_ACCESS_VALUES } from "../page.schema";

// Input keys mirror PageSerializer / PageDetailSerializer (snake_case): name, access, color, parent,
// is_locked, view_props, logo_props, labels (write-only uuid[]), description_html, description (json).
// description_binary is a passthrough (base64) — the live-service sync path is deferred (phase4).
export class CreatePageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @IsIn(PAGE_ACCESS_VALUES as unknown as number[])
  access?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsUUID()
  parent?: string;

  @IsOptional()
  @IsBoolean()
  is_locked?: boolean;

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  labels?: string[];

  @IsOptional()
  @IsString()
  description_html?: string;

  @IsOptional()
  @IsObject()
  description_json?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  description_binary?: string;
}

export class UpdatePageDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsInt()
  @IsIn(PAGE_ACCESS_VALUES as unknown as number[])
  access?: number;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsUUID()
  parent?: string;

  @IsOptional()
  @IsBoolean()
  is_locked?: boolean;

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  labels?: string[];

  @IsOptional()
  @IsString()
  description_html?: string;

  @IsOptional()
  @IsObject()
  description_json?: Record<string, unknown>;
}

// Body of POST .../pages/:pk/access/ — access defaults to 0 (public) when omitted (Django parity).
export class PageAccessDto {
  @IsOptional()
  @IsInt()
  @IsIn(PAGE_ACCESS_VALUES as unknown as number[])
  access?: number;
}
