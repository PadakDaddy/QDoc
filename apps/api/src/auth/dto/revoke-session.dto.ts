import { IsOptional, IsString, MaxLength } from 'class-validator'

export class RevokeSessionDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  sessionToken?: string
}
