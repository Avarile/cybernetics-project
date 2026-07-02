import { Type } from "class-transformer";
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  ValidateNested,
} from "class-validator";
import { ESTIMATE_TYPE } from "../estimate.schema";

// ---- Bulk estimate create (POST /estimates) --------------------------------

export class EstimateMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(ESTIMATE_TYPE as unknown as string[])
  type?: string;

  @IsOptional()
  @IsBoolean()
  last_used?: boolean;
}

export class CreateEstimatePointItemDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  key?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  value?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class CreateEstimateDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => EstimateMetaDto)
  estimate?: EstimateMetaDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreateEstimatePointItemDto)
  estimate_points?: CreateEstimatePointItemDto[];
}

// ---- Bulk estimate update (PATCH /estimates/:estimate_id) -------------------

export class UpdateEstimateMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsIn(ESTIMATE_TYPE as unknown as string[])
  type?: string;
}

export class UpdateEstimatePointItemDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  key?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  value?: string;
}

export class UpdateEstimateDto {
  @IsOptional()
  @ValidateNested()
  @Type(() => UpdateEstimateMetaDto)
  estimate?: UpdateEstimateMetaDto;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateEstimatePointItemDto)
  estimate_points?: UpdateEstimatePointItemDto[];
}

// ---- Single estimate-point endpoints --------------------------------------

export class CreateEstimatePointDto {
  // Presence is enforced in the service (Django rejects missing/zero key or empty value).
  @IsOptional()
  @IsInt()
  @Min(0)
  key?: number;

  @IsOptional()
  @IsString()
  value?: string;
}

export class UpdateEstimatePointDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  key?: number;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  value?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class DeleteEstimatePointDto {
  // When present, Django reassigns issues' estimate_point to this estimate (see service note).
  @IsOptional()
  @IsUUID()
  new_estimate_id?: string;
}
