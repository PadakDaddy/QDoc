import { Controller, Get, Param } from '@nestjs/common'

import { OrganizationsService } from './organizations.service'

@Controller('organizations')
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Get(':organizationSlug/sites')
  listSites(@Param('organizationSlug') organizationSlug: string) {
    return this.organizationsService.listSites(organizationSlug)
  }
}
