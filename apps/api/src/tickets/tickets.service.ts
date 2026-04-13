import { randomBytes } from 'node:crypto'

import { ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import {
  NotificationChannel,
  NotificationStatus,
  NotificationTemplate,
  OutboxStatus,
  Prisma,
  TicketEventType,
  TicketSource,
  TicketStatus,
} from '@prisma/client'

import type { RequestUser } from '../common/request-user'
import { PrismaService } from '../prisma/prisma.service'
import { EnrollTicketDto } from './dto/enroll-ticket.dto'
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto'

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.WAITING,
  TicketStatus.NOTIFIED,
  TicketStatus.CALLED,
  TicketStatus.IN_SERVICE,
]

function createPublicTicketId() {
  return `TKT-${randomBytes(4).toString('hex').toUpperCase()}`
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async enroll(input: EnrollTicketDto) {
    const email = input.email.trim().toLowerCase()
    const givenName = input.givenName.trim()
    const familyName = input.familyName.trim()
    const phone = input.phone?.trim() || null
    const note = input.note?.trim() || null

    await this.prisma.$transaction(
      async (tx) => {
        const queue = await tx.queue.findFirst({
          where: {
            slug: input.queueSlug,
            status: 'OPEN',
            acceptsOnlineCheckIn: true,
            site: {
              slug: input.siteSlug,
              organization: {
                slug: input.organizationSlug,
              },
            },
          },
          include: {
            site: {
              include: {
                organization: true,
              },
            },
          },
        })

        if (!queue) {
          throw new NotFoundException('Queue not found or unavailable for online check-in')
        }

        const user = await tx.userAccount.upsert({
          where: { email },
          update: {
            displayName: `${givenName} ${familyName}`,
          },
          create: {
            email,
            displayName: `${givenName} ${familyName}`,
          },
        })

        const patient = await tx.patient.upsert({
          where: {
            organizationId_externalRef: {
              organizationId: queue.site.organizationId,
              externalRef: `email:${email}`,
            },
          },
          update: {
            userAccountId: user.id,
            email,
            phone,
            givenName,
            familyName,
          },
          create: {
            organizationId: queue.site.organizationId,
            userAccountId: user.id,
            externalRef: `email:${email}`,
            email,
            phone,
            givenName,
            familyName,
          },
        })

        const duplicate = await tx.ticket.findFirst({
          where: {
            queueId: queue.id,
            patientId: patient.id,
            status: {
              in: ACTIVE_TICKET_STATUSES,
            },
          },
        })

        if (duplicate) {
          throw new ConflictException('Patient already has an active ticket in this queue')
        }

        const latestTicket = await tx.ticket.findFirst({
          where: {
            queueId: queue.id,
          },
          orderBy: {
            queueNumber: 'desc',
          },
          select: {
            queueNumber: true,
          },
        })

        const nextQueueNumber = (latestTicket?.queueNumber ?? 1000) + 1

        const ticket = await tx.ticket.create({
          data: {
            organizationId: queue.site.organizationId,
            siteId: queue.siteId,
            queueId: queue.id,
            patientId: patient.id,
            publicId: createPublicTicketId(),
            queueNumber: nextQueueNumber,
            source: TicketSource.PATIENT_WEB,
            status: TicketStatus.WAITING,
            note,
          },
        })

        await tx.ticketEvent.create({
          data: {
            ticketId: ticket.id,
            type: TicketEventType.CREATED,
            note: 'Patient check-in completed from the web flow.',
          },
        })

        await tx.notification.create({
          data: {
            organizationId: queue.site.organizationId,
            siteId: queue.siteId,
            patientId: patient.id,
            ticketId: ticket.id,
            channel: NotificationChannel.EMAIL,
            template: NotificationTemplate.QUEUE_JOINED,
            status: NotificationStatus.PENDING,
            address: email,
            subject: 'QDoc queue confirmation',
          },
        })

        await tx.outboxEntry.create({
          data: {
            organizationId: queue.site.organizationId,
            topic: 'notification.queue_joined',
            aggregateType: 'Ticket',
            aggregateId: ticket.id,
            status: OutboxStatus.PENDING,
            payload: {
              queueId: queue.id,
              ticketId: ticket.id,
              patientEmail: email,
            },
          },
        })
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    )

    const patientTickets = await this.listByEmail(email)
    const latest = patientTickets[0]

    if (!latest) {
      throw new NotFoundException('Ticket was created but could not be reloaded')
    }

    return this.getTicket(latest.publicId)
  }

  async listByEmail(email: string) {
    const normalizedEmail = email.trim().toLowerCase()
    return this.prisma.ticket.findMany({
      where: {
        patient: {
          email: normalizedEmail,
        },
      },
      include: {
        patient: true,
        queue: {
          include: {
            site: {
              include: {
                organization: true,
              },
            },
          },
        },
      },
      orderBy: {
        checkedInAt: 'desc',
      },
    })
  }

  async getTicket(publicId: string) {
    const ticket = await this.prisma.ticket.findUnique({
      where: {
        publicId,
      },
      include: {
        patient: true,
        queue: {
          include: {
            site: {
              include: {
                organization: true,
              },
            },
          },
        },
        events: {
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    })

    if (!ticket) {
      throw new NotFoundException('Ticket not found')
    }

    const peopleAhead = await this.prisma.ticket.count({
      where: {
        queueId: ticket.queueId,
        status: {
          in: ACTIVE_TICKET_STATUSES,
        },
        queueNumber: {
          lt: ticket.queueNumber,
        },
      },
    })

    return {
      publicId: ticket.publicId,
      queueNumber: ticket.queueNumber,
      status: ticket.status,
      note: ticket.note,
      checkedInAt: ticket.checkedInAt,
      calledAt: ticket.calledAt,
      serviceStartedAt: ticket.serviceStartedAt,
      completedAt: ticket.completedAt,
      cancelledAt: ticket.cancelledAt,
      patient: {
        id: ticket.patient.id,
        givenName: ticket.patient.givenName,
        familyName: ticket.patient.familyName,
        email: ticket.patient.email,
        phone: ticket.patient.phone,
      },
      queue: {
        id: ticket.queue.id,
        slug: ticket.queue.slug,
        name: ticket.queue.name,
        status: ticket.queue.status,
        estimatedServiceMinutes: ticket.queue.estimatedServiceMinutes,
      },
      site: {
        id: ticket.queue.site.id,
        slug: ticket.queue.site.slug,
        name: ticket.queue.site.name,
        organizationSlug: ticket.queue.site.organization.slug,
      },
      peopleAhead,
      estimatedWaitMinutes: peopleAhead * ticket.queue.estimatedServiceMinutes,
      events: ticket.events.map((event) => ({
        id: event.id,
        type: event.type,
        fromStatus: event.fromStatus,
        toStatus: event.toStatus,
        note: event.note,
        createdAt: event.createdAt,
      })),
    }
  }

  async updateStatus(publicId: string, actor: RequestUser, input: UpdateTicketStatusDto) {
    const ticket = await this.prisma.ticket.findUnique({
      where: {
        publicId,
      },
      include: {
        patient: true,
      },
    })

    if (!ticket) {
      throw new NotFoundException('Ticket not found')
    }

    const membership = actor.memberships.find(
      (item) => item.organizationId === ticket.organizationId && item.status === 'ACTIVE',
    )

    if (!membership) {
      throw new ConflictException('No active membership for the ticket organization')
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: {
          id: ticket.id,
        },
        data: {
          status: input.status,
          note: input.note?.trim() || ticket.note,
          notifiedAt: input.status === TicketStatus.NOTIFIED ? new Date() : ticket.notifiedAt,
          calledAt: input.status === TicketStatus.CALLED ? new Date() : ticket.calledAt,
          serviceStartedAt: input.status === TicketStatus.IN_SERVICE ? new Date() : ticket.serviceStartedAt,
          completedAt: input.status === TicketStatus.COMPLETED ? new Date() : ticket.completedAt,
          cancelledAt: input.status === TicketStatus.CANCELLED ? new Date() : ticket.cancelledAt,
        },
      })

      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          membershipId: membership.id,
          actorUserId: actor.id,
          type: TicketEventType.STATUS_CHANGED,
          fromStatus: ticket.status,
          toStatus: input.status,
          note: input.note?.trim() || null,
        },
      })

      if ((input.status === TicketStatus.CALLED || input.status === TicketStatus.CANCELLED) && ticket.patient.email) {
        const template =
          input.status === TicketStatus.CALLED ? NotificationTemplate.QUEUE_CALLED : NotificationTemplate.QUEUE_CANCELLED

        await tx.notification.create({
          data: {
            organizationId: ticket.organizationId,
            siteId: ticket.siteId,
            patientId: ticket.patientId,
            ticketId: ticket.id,
            channel: NotificationChannel.EMAIL,
            template,
            status: NotificationStatus.PENDING,
            address: ticket.patient.email,
            subject: input.status === TicketStatus.CALLED ? 'QDoc queue update: you are up next' : 'QDoc queue update',
          },
        })
      }
    })

    return this.getTicket(publicId)
  }
}
