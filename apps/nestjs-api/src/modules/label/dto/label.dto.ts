import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from "class-validator";

export class CreateLabelDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsUUID()
  parent?: string;

  @IsOptional()
  @IsString()
  description?: string;
}

export class UpdateLabelDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsUUID()
  parent?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
