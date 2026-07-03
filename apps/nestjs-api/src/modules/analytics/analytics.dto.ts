import { IsObject, IsOptional, IsString } from "class-validator";

export class AnalyticViewDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsObject()
  query_dict?: Record<string, unknown>;
}
