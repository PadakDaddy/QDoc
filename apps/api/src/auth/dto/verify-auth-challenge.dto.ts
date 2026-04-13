import { IsOptional, IsString, Length, ValidateIf } from 'class-validator'

export class VerifyAuthChallengeDto {
  @ValidateIf((body: VerifyAuthChallengeDto) => !body.code)
  @IsString()
  @Length(16, 128)
  token?: string

  @ValidateIf((body: VerifyAuthChallengeDto) => !body.token)
  @IsString()
  @Length(6, 6)
  code?: string
}
