import { Type } from 'class-transformer'
import { QueueStatus } from '@prisma/client'
import { IsBoolean, IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator'

export class UpdateQueueSettingsDto {
  @IsOptional()
  @IsEnum(QueueStatus)
  status?: QueueStatus

  @IsOptional()
  @IsBoolean()
  acceptsOnlineCheckIn?: boolean

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(240)
  estimatedServiceMinutes?: number

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(500)
  maxActiveTickets?: number
}
