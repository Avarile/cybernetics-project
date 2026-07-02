import { IsHexColor, IsIn, IsOptional, IsString, MaxLength, MinLength } from "class-validator";
import { STATE_GROUP } from "../state.schema";

export class CreateStateDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name!: string;

  @IsString()
  color!: string;

  @IsOptional()
  @IsIn(STATE_GROUP as unknown as string[])
  group?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsString()
  external_source?: string;

  @IsOptional()
  @IsString()
  external_id?: string;
}

export class UpdateStateDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  name?: string;

  @IsOptional()
  @IsString()
  color?: string;

  @IsOptional()
  @IsIn(STATE_GROUP as unknown as string[])
  group?: string;

  @IsOptional()
  @IsString()
  description?: string;
}
