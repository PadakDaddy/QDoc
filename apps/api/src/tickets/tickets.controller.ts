import { Body, Controller, Get, Param, Patch, Post, UseGuards } from '@nestjs/common'

import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { CurrentUser } from '../common/current-user.decorator'
import type { RequestUser } from '../common/request-user'
import { CancelTicketDto } from './dto/cancel-ticket.dto'
import { EnrollTicketDto } from './dto/enroll-ticket.dto'
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto'
import { TicketsService } from './tickets.service'

@Controller('tickets')
export class TicketsController {
  constructor(private readonly ticketsService: TicketsService) {}

  @Post('enroll')
  enroll(@Body() body: EnrollTicketDto) {
    return this.ticketsService.enroll(body)
  }

  @Get('mine')
  @UseGuards(AuthGuard)
  listMine(@CurrentUser() user: RequestUser) {
    return this.ticketsService.listMine(user)
  }

  @Get('by-email')
  @UseGuards(AuthGuard)
  listByEmail(@CurrentUser() user: RequestUser) {
    return this.ticketsService.listMine(user)
  }

  @Get(':publicId')
  getTicket(@Param('publicId') publicId: string) {
    return this.ticketsService.getTicket(publicId)
  }

  @Patch(':publicId/status')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  updateStatus(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: UpdateTicketStatusDto,
  ) {
    return this.ticketsService.updateStatus(publicId, user, body)
  }

  @Post(':publicId/cancel')
  @UseGuards(AuthGuard)
  cancelTicket(
    @Param('publicId') publicId: string,
    @CurrentUser() user: RequestUser,
    @Body() body: CancelTicketDto,
  ) {
    return this.ticketsService.cancel(publicId, user, body)
  }
}
