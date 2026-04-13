import { Injectable, NotFoundException } from '@nestjs/common'

import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class OrganizationsService {
  constructor(private readonly prisma: PrismaService) {}

  async listSites(organizationSlug: string) {
    const organization = await this.prisma.organization.findUnique({
      where: {
        slug: organizationSlug,
      },
      include: {
        sites: {
          include: {
            queues: {
              orderBy: {
                createdAt: 'asc',
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    })

    if (!organization) {
      throw new NotFoundException('Organization not found')
    }

    return {
      id: organization.id,
      slug: organization.slug,
      name: organization.name,
      status: organization.status,
      sites: organization.sites.map((site) => ({
        id: site.id,
        slug: site.slug,
        name: site.name,
        timezone: site.timezone,
        status: site.status,
        publicCheckInEnabled: site.publicCheckInEnabled,
        queues: site.queues.map((queue) => ({
          id: queue.id,
          slug: queue.slug,
          name: queue.name,
          status: queue.status,
          acceptsOnlineCheckIn: queue.acceptsOnlineCheckIn,
          estimatedServiceMinutes: queue.estimatedServiceMinutes,
        })),
      })),
    }
  }
}
