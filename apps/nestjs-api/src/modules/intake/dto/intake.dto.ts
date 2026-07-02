import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from "class-validator";
import { INTAKE_ISSUE_STATUS_VALUES } from "../intake.schema";

// ---- Intake (IntakeViewSet) ------------------------------------------------

export class CreateIntakeDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;
}

export class UpdateIntakeDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsBoolean()
  is_default?: boolean;

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;
}

// ---- IntakeIssue (IntakeIssueViewSet) --------------------------------------

// The nested `issue` payload. Fields are lenient (name/priority optional) so the service can
// reproduce Django's exact error messages ("Name is required" / "Invalid priority").
export class IntakeIssueInnerDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  priority?: string;

  @IsOptional()
  @IsString()
  description_html?: string;

  @IsOptional()
  @IsObject()
  description?: Record<string, unknown>;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  target_date?: string;

  @IsOptional()
  @IsUUID()
  estimate_point?: string;

  @IsOptional()
  @IsUUID()
  parent?: string;

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  assignees?: string[];

  @IsOptional()
  @IsArray()
  @IsUUID("all", { each: true })
  labels?: string[];
}

export class CreateIntakeIssueDto {
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IntakeIssueInnerDto)
  issue?: IntakeIssueInnerDto;
}

export class UpdateIntakeIssueDto {
  // intake-issue fields (IntakeIssueSerializer writable set)
  @IsOptional()
  @IsInt()
  @IsIn(INTAKE_ISSUE_STATUS_VALUES as unknown as number[])
  status?: number;

  @IsOptional()
  @IsDateString()
  snoozed_till?: string;

  @IsOptional()
  @IsUUID()
  duplicate_to?: string;

  @IsOptional()
  @IsString()
  source?: string;

  // nested issue update (optional)
  @IsOptional()
  @IsObject()
  @ValidateNested()
  @Type(() => IntakeIssueInnerDto)
  issue?: IntakeIssueInnerDto;
}
