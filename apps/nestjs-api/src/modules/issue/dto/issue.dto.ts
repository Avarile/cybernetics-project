import { IsArray, IsBoolean, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";
import { ISSUE_PRIORITY } from "../../../infra/database/schema/_types";

// Input keys mirror IssueCreateSerializer (snake_case): name, state, priority, description_html,
// description (json), start_date, target_date, estimate_point, parent, assignees, labels, is_draft.
export class CreateIssueDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsUUID()
  state?: string;

  @IsOptional()
  @IsIn(ISSUE_PRIORITY as unknown as string[])
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

  @IsOptional()
  @IsBoolean()
  is_draft?: boolean;
}

export class UpdateIssueDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsUUID()
  state?: string;

  @IsOptional()
  @IsIn(ISSUE_PRIORITY as unknown as string[])
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
}
