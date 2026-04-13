import { IsEmail, IsOptional, IsString, MaxLength } from 'class-validator'

export class EnrollTicketDto {
  @IsString()
  @MaxLength(64)
  organizationSlug!: string

  @IsString()
  @MaxLength(64)
  siteSlug!: string

  @IsString()
  @MaxLength(64)
  queueSlug!: string

  @IsEmail()
  email!: string

  @IsString()
  @MaxLength(80)
  givenName!: string

  @IsString()
  @MaxLength(80)
  familyName!: string

  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string

  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
