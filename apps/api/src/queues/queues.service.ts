import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma, TicketStatus } from '@prisma/client'

import type { RequestUser } from '../common/request-user'
import { PrismaService } from '../prisma/prisma.service'
import { UpdateQueueSettingsDto } from './dto/update-queue-settings.dto'

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.WAITING,
  TicketStatus.NOTIFIED,
  TicketStatus.CALLED,
  TicketStatus.IN_SERVICE,
]

type BoardTicket = Prisma.TicketGetPayload<{
  include: {
    patient: {
      select: {
        id: true
        givenName: true
        familyName: true
        email: true
        phone: true
      }
    }
  }
}>

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
      maxActiveTickets: queue.maxActiveTickets,
      activeTicketCount: queue.tickets.length,
      remainingActiveTicketSlots:
        queue.maxActiveTickets === null ? null : Math.max(queue.maxActiveTickets - queue.tickets.length, 0),
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
      summary: this.buildBoardSummary(tickets),
      currentTicket: this.toBoardTicketPreview(
        tickets.find((ticket) => ticket.status === TicketStatus.IN_SERVICE) ??
          tickets.find((ticket) => ticket.status === TicketStatus.CALLED) ??
          null,
      ),
      tickets: tickets.map((ticket) => this.toBoardTicketPreview(ticket)),
    }
  }

  async updateQueueSettings(
    organizationSlug: string,
    siteSlug: string,
    queueSlug: string,
    actor: RequestUser,
    input: UpdateQueueSettingsDto,
  ) {
    const membership = actor.memberships.find(
      (item) => item.organizationSlug === organizationSlug && item.status === 'ACTIVE',
    )

    if (!membership) {
      throw new ForbiddenException('Active organization membership not found for this queue')
    }

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
      select: {
        id: true,
      },
    })

    if (!queue) {
      throw new NotFoundException('Queue not found')
    }

    const nextMaxActiveTickets = input.maxActiveTickets === 0 ? null : input.maxActiveTickets

    if (nextMaxActiveTickets !== undefined && nextMaxActiveTickets !== null) {
      const activeTicketCount = await this.prisma.ticket.count({
        where: {
          queueId: queue.id,
          status: {
            in: ACTIVE_TICKET_STATUSES,
          },
        },
      })

      if (nextMaxActiveTickets < activeTicketCount) {
        throw new ForbiddenException('Queue capacity cannot be reduced below the current active ticket count')
      }
    }

    await this.prisma.queue.update({
      where: {
        id: queue.id,
      },
      data: {
        status: input.status,
        acceptsOnlineCheckIn: input.acceptsOnlineCheckIn,
        estimatedServiceMinutes: input.estimatedServiceMinutes,
        maxActiveTickets: nextMaxActiveTickets,
      },
    })

    return this.getQueue(organizationSlug, siteSlug, queueSlug)
  }

  private buildBoardSummary(tickets: BoardTicket[]) {
    return {
      activeTicketCount: tickets.length,
      waitingCount: tickets.filter((ticket) => ticket.status === TicketStatus.WAITING).length,
      notifiedCount: tickets.filter((ticket) => ticket.status === TicketStatus.NOTIFIED).length,
      calledCount: tickets.filter((ticket) => ticket.status === TicketStatus.CALLED).length,
      inServiceCount: tickets.filter((ticket) => ticket.status === TicketStatus.IN_SERVICE).length,
    }
  }

  private toBoardTicketPreview(ticket: BoardTicket | null) {
    if (!ticket) {
      return null
    }

    return {
      id: ticket.id,
      publicId: ticket.publicId,
      queueNumber: ticket.queueNumber,
      status: ticket.status,
      checkedInAt: ticket.checkedInAt,
      patient: ticket.patient,
    }
  }
}
