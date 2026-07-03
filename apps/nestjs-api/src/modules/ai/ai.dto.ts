import { IsOptional, IsString } from "class-validator";

// Django reads request.data.get("task", False) / .get("prompt", False) and validates `task` manually
// (returning {error:"Task is required"}), so both are optional here — the controller does the check.
export class AiAssistantDto {
  @IsOptional()
  @IsString()
  task?: string;

  @IsOptional()
  @IsString()
  prompt?: string;
}
