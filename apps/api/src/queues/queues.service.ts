import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { TicketStatus } from '@prisma/client'

import type { RequestUser } from '../common/request-user'
import { PrismaService } from '../prisma/prisma.service'

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.WAITING,
  TicketStatus.NOTIFIED,
  TicketStatus.CALLED,
  TicketStatus.IN_SERVICE,
]

@Injectable()
export class QueuesService {
  constructor(private readonly prisma: PrismaService) {}

  async getQueue(organizationSlug: string, siteSlug: string, queueSlug: string) {
    const queue = await this.prisma.queue.findFirst({
      where: {
        slug: queueSlug,
        site: {
          slug: siteSlug,
          organization: {
            slug: organizationSlug,
          },
        },
      },
      include: {
        site: {
          select: {
            id: true,
            slug: true,
            name: true,
            timezone: true,
          },
        },
        department: {
          select: {
            id: true,
            slug: true,
            name: true,
          },
        },
        tickets: {
          where: {
            status: {
              in: ACTIVE_TICKET_STATUSES,
            },
          },
          select: {
            id: true,
          },
        },
      },
    })

    if (!queue) {
      throw new NotFoundException('Queue not found')
    }

    return {
      id: queue.id,
      slug: queue.slug,
      name: queue.name,
      status: queue.status,
      description: queue.description,
      acceptsOnlineCheckIn: queue.acceptsOnlineCheckIn,
      estimatedServiceMinutes: queue.estimatedServiceMinutes,
      activeTicketCount: queue.tickets.length,
      site: queue.site,
      department: queue.department,
    }
  }

  async getQueueBoard(organizationSlug: string, siteSlug: string, queueSlug: string, actor: RequestUser) {
    const queue = await this.getQueue(organizationSlug, siteSlug, queueSlug)
    const membership = actor.memberships.find(
      (item) => item.organizationSlug === organizationSlug && item.status === 'ACTIVE',
    )

    if (!membership) {
      throw new ForbiddenException('Active organization membership not found for this queue board')
    }

    const tickets = await this.prisma.ticket.findMany({
      where: {
        queue: {
          slug: queueSlug,
          site: {
            slug: siteSlug,
            organization: {
              slug: organizationSlug,
            },
          },
        },
        status: {
          in: ACTIVE_TICKET_STATUSES,
        },
      },
      include: {
        patient: {
          select: {
            id: true,
            givenName: true,
            familyName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        queueNumber: 'asc',
      },
    })

    return {
      ...queue,
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        publicId: ticket.publicId,
        queueNumber: ticket.queueNumber,
        status: ticket.status,
        checkedInAt: ticket.checkedInAt,
        patient: ticket.patient,
      })),
    }
  }
}
