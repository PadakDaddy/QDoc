import { IsOptional, IsString, MaxLength } from 'class-validator'

export class CancelTicketDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string
}
