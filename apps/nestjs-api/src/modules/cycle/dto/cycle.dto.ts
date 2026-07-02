import { IsDateString, IsInt, IsObject, IsOptional, IsString, MaxLength, MinLength } from "class-validator";

// Mirrors CycleWriteSerializer (fields="__all__", read_only=[workspace, project, owned_by, archived_at]).
export class CreateCycleDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_id?: string;

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  timezone?: string;
}

export class UpdateCycleDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsDateString()
  start_date?: string;

  @IsOptional()
  @IsDateString()
  end_date?: string;

  @IsOptional()
  @IsInt()
  sort_order?: number;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_source?: string;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  external_id?: string;

  @IsOptional()
  @IsObject()
  view_props?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  logo_props?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(255)
  timezone?: string;
}
