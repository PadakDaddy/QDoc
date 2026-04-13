import { Controller, Get, Param, UseGuards } from '@nestjs/common'

import { AuthGuard } from '../auth/auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { CurrentUser } from '../common/current-user.decorator'
import type { RequestUser } from '../common/request-user'
import { QueuesService } from './queues.service'

@Controller('organizations/:organizationSlug/sites/:siteSlug/queues')
export class QueuesController {
  constructor(private readonly queuesService: QueuesService) {}

  @Get(':queueSlug')
  getQueue(
    @Param('organizationSlug') organizationSlug: string,
    @Param('siteSlug') siteSlug: string,
    @Param('queueSlug') queueSlug: string,
  ) {
    return this.queuesService.getQueue(organizationSlug, siteSlug, queueSlug)
  }

  @Get(':queueSlug/board')
  @UseGuards(AuthGuard, RolesGuard)
  @Roles('OWNER', 'ADMIN', 'STAFF')
  getQueueBoard(
    @Param('organizationSlug') organizationSlug: string,
    @Param('siteSlug') siteSlug: string,
    @Param('queueSlug') queueSlug: string,
    @CurrentUser() user: RequestUser,
  ) {
    return this.queuesService.getQueueBoard(organizationSlug, siteSlug, queueSlug, user)
  }
}
