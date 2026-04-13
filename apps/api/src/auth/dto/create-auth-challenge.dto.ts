import { IsEmail, IsEnum, IsOptional, IsString, MaxLength } from 'class-validator'

import { AuthChallengePurpose } from '@prisma/client'

export class CreateAuthChallengeDto {
  @IsEmail()
  email!: string

  @IsEnum(AuthChallengePurpose)
  purpose!: AuthChallengePurpose

  @IsOptional()
  @IsString()
  @MaxLength(64)
  organizationSlug?: string
}
