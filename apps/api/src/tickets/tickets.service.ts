import { randomBytes } from 'node:crypto'

import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
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
import { CancelTicketDto } from './dto/cancel-ticket.dto'
import { EnrollTicketDto } from './dto/enroll-ticket.dto'
import { UpdateTicketStatusDto } from './dto/update-ticket-status.dto'

const ACTIVE_TICKET_STATUSES: TicketStatus[] = [
  TicketStatus.WAITING,
  TicketStatus.NOTIFIED,
  TicketStatus.CALLED,
  TicketStatus.IN_SERVICE,
]

const STAFF_TRANSITIONS: Record<TicketStatus, TicketStatus[]> = {
  [TicketStatus.WAITING]: [TicketStatus.NOTIFIED, TicketStatus.CALLED, TicketStatus.CANCELLED, TicketStatus.NO_SHOW],
  [TicketStatus.NOTIFIED]: [TicketStatus.CALLED, TicketStatus.CANCELLED, TicketStatus.NO_SHOW],
  [TicketStatus.CALLED]: [TicketStatus.IN_SERVICE, TicketStatus.CANCELLED, TicketStatus.NO_SHOW],
  [TicketStatus.IN_SERVICE]: [TicketStatus.COMPLETED, TicketStatus.CANCELLED],
  [TicketStatus.COMPLETED]: [],
  [TicketStatus.NO_SHOW]: [],
  [TicketStatus.CANCELLED]: [],
}

const SELF_SERVICE_CANCELLABLE_STATUSES = new Set<TicketStatus>([
  TicketStatus.WAITING,
  TicketStatus.NOTIFIED,
  TicketStatus.CALLED,
])

const STATUS_NOTIFICATION_CONFIG: Partial<
  Record<
    TicketStatus,
    {
      template: NotificationTemplate
      topic: string
      subject: string
    }
  >
> = {
  [TicketStatus.NOTIFIED]: {
    template: NotificationTemplate.QUEUE_ALMOST_READY,
    topic: 'notification.queue_almost_ready',
    subject: 'QDoc queue update: almost ready',
  },
  [TicketStatus.CALLED]: {
    template: NotificationTemplate.QUEUE_CALLED,
    topic: 'notification.queue_called',
    subject: 'QDoc queue update: you are up next',
  },
  [TicketStatus.CANCELLED]: {
    template: NotificationTemplate.QUEUE_CANCELLED,
    topic: 'notification.queue_cancelled',
    subject: 'QDoc queue update',
  },
}

type TicketDetails = Prisma.TicketGetPayload<{
  include: {
    patient: true
    queue: {
      include: {
        site: {
          include: {
            organization: true
          }
        }
      }
    }
    events: {
      orderBy: {
        createdAt: 'asc'
      }
    }
  }
}>

function createPublicTicketId() {
  return `TKT-${randomBytes(4).toString('hex').toUpperCase()}`
}

function normalizeOptionalText(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed : null
}

function isActiveTicketStatus(status: TicketStatus) {
  return ACTIVE_TICKET_STATUSES.includes(status)
}

function toFamilyNameInitial(familyName: string) {
  return familyName.trim().charAt(0).toUpperCase() || null
}

@Injectable()
export class TicketsService {
  constructor(private readonly prisma: PrismaService) {}

  async enroll(input: EnrollTicketDto) {
    const email = input.email.trim().toLowerCase()
    const givenName = input.givenName.trim()
    const familyName = input.familyName.trim()
    const phone = normalizeOptionalText(input.phone)
    const note = normalizeOptionalText(input.note)

    const publicId = await this.prisma.$transaction(
      async (tx) => {
        const queue = await tx.queue.findFirst({
          where: {
            slug: input.queueSlug,
            status: 'OPEN',
            acceptsOnlineCheckIn: true,
            site: {
              slug: input.siteSlug,
              status: 'ACTIVE',
              publicCheckInEnabled: true,
              organization: {
                slug: input.organizationSlug,
                status: 'ACTIVE',
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

        if (queue.maxActiveTickets !== null) {
          const activeTicketCount = await tx.ticket.count({
            where: {
              queueId: queue.id,
              status: {
                in: ACTIVE_TICKET_STATUSES,
              },
            },
          })

          if (activeTicketCount >= queue.maxActiveTickets) {
            throw new ConflictException('Queue has reached its active ticket limit')
          }
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
            actorUserId: user.id,
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

        return ticket.publicId
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      },
    )

    return this.getTicketForOwner(publicId)
  }

  async listMine(actor: RequestUser) {
    const email = actor.email.trim().toLowerCase()
    const tickets = await this.prisma.ticket.findMany({
      where: {
        OR: [{ patient: { userAccountId: actor.id } }, { patient: { email } }],
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
      orderBy: [{ checkedInAt: 'desc' }],
    })

    return Promise.all(
      tickets.map((ticket) => this.serializeTicket(ticket, { includePrivatePatientDetails: true, includeEvents: false })),
    )
  }

  async getTicket(publicId: string) {
    const ticket = await this.getTicketOrThrow(publicId)
    return this.serializeTicket(ticket, { includePrivatePatientDetails: false, includeEvents: false })
  }

  async cancel(publicId: string, actor: RequestUser, input: CancelTicketDto) {
    const ticket = await this.getTicketOrThrow(publicId)

    if (!this.isTicketOwner(ticket, actor)) {
      throw new ForbiddenException('You can only cancel your own active ticket')
    }

    if (!SELF_SERVICE_CANCELLABLE_STATUSES.has(ticket.status)) {
      throw new ConflictException('This ticket can no longer be cancelled by the patient')
    }

    await this.applyStatusTransition(ticket, {
      nextStatus: TicketStatus.CANCELLED,
      note: normalizeOptionalText(input.note),
      actorUserId: actor.id,
      membershipId: null,
    })

    return this.getTicketForOwner(publicId)
  }

  async updateStatus(publicId: string, actor: RequestUser, input: UpdateTicketStatusDto) {
    const ticket = await this.getTicketOrThrow(publicId)
    const membership = actor.memberships.find(
      (item) => item.organizationId === ticket.organizationId && item.status === 'ACTIVE',
    )

    if (!membership) {
      throw new ForbiddenException('No active membership for the ticket organization')
    }

    this.assertStaffTransitionAllowed(ticket.status, input.status)

    await this.applyStatusTransition(ticket, {
      nextStatus: input.status,
      note: normalizeOptionalText(input.note),
      actorUserId: actor.id,
      membershipId: membership.id,
    })

    return this.getTicketForOwner(publicId)
  }

  private async getTicketForOwner(publicId: string) {
    const ticket = await this.getTicketOrThrow(publicId)
    return this.serializeTicket(ticket, { includePrivatePatientDetails: true, includeEvents: true })
  }

  private async getTicketOrThrow(publicId: string) {
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

    return ticket
  }

  private async serializeTicket(
    ticket: TicketDetails,
    options: {
      includePrivatePatientDetails: boolean
      includeEvents: boolean
    },
  ) {
    const peopleAhead = isActiveTicketStatus(ticket.status)
      ? await this.prisma.ticket.count({
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
      : 0

    const response = {
      publicId: ticket.publicId,
      queueNumber: ticket.queueNumber,
      status: ticket.status,
      note: options.includePrivatePatientDetails ? ticket.note : null,
      checkedInAt: ticket.checkedInAt,
      notifiedAt: ticket.notifiedAt,
      calledAt: ticket.calledAt,
      serviceStartedAt: ticket.serviceStartedAt,
      completedAt: ticket.completedAt,
      cancelledAt: ticket.cancelledAt,
      patient: options.includePrivatePatientDetails
        ? {
            id: ticket.patient.id,
            givenName: ticket.patient.givenName,
            familyName: ticket.patient.familyName,
            email: ticket.patient.email,
            phone: ticket.patient.phone,
          }
        : {
            givenName: ticket.patient.givenName,
            familyNameInitial: toFamilyNameInitial(ticket.patient.familyName),
          },
      queue: {
        id: ticket.queue.id,
        slug: ticket.queue.slug,
        name: ticket.queue.name,
        status: ticket.queue.status,
        acceptsOnlineCheckIn: ticket.queue.acceptsOnlineCheckIn,
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
    }

    if (!options.includeEvents) {
      return response
    }

    return {
      ...response,
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

  private isTicketOwner(ticket: TicketDetails, actor: RequestUser) {
    return (
      ticket.patient.userAccountId === actor.id ||
      ticket.patient.email?.trim().toLowerCase() === actor.email.trim().toLowerCase()
    )
  }

  private assertStaffTransitionAllowed(currentStatus: TicketStatus, nextStatus: TicketStatus) {
    if (currentStatus === nextStatus) {
      throw new ConflictException('Ticket is already in the requested status')
    }

    const allowedStatuses = STAFF_TRANSITIONS[currentStatus]
    if (!allowedStatuses.includes(nextStatus)) {
      throw new ConflictException(`Cannot move a ticket from ${currentStatus} to ${nextStatus}`)
    }
  }

  private async applyStatusTransition(
    ticket: TicketDetails,
    input: {
      nextStatus: TicketStatus
      note: string | null
      actorUserId: string
      membershipId: string | null
    },
  ) {
    const statusUpdate = this.buildStatusUpdate(ticket, input.nextStatus, input.note)

    await this.prisma.$transaction(async (tx) => {
      await tx.ticket.update({
        where: {
          id: ticket.id,
        },
        data: statusUpdate,
      })

      await tx.ticketEvent.create({
        data: {
          ticketId: ticket.id,
          membershipId: input.membershipId,
          actorUserId: input.actorUserId,
          type: TicketEventType.STATUS_CHANGED,
          fromStatus: ticket.status,
          toStatus: input.nextStatus,
          note: input.note,
        },
      })

      const notificationConfig =
        ticket.patient.email && STATUS_NOTIFICATION_CONFIG[input.nextStatus]
          ? STATUS_NOTIFICATION_CONFIG[input.nextStatus]
          : null

      if (!notificationConfig || !ticket.patient.email) {
        return
      }

      await tx.notification.create({
        data: {
          organizationId: ticket.organizationId,
          siteId: ticket.siteId,
          patientId: ticket.patientId,
          ticketId: ticket.id,
          channel: NotificationChannel.EMAIL,
          template: notificationConfig.template,
          status: NotificationStatus.PENDING,
          address: ticket.patient.email,
          subject: notificationConfig.subject,
          payload: {
            publicId: ticket.publicId,
            queueNumber: ticket.queueNumber,
            nextStatus: input.nextStatus,
          },
        },
      })

      await tx.outboxEntry.create({
        data: {
          organizationId: ticket.organizationId,
          topic: notificationConfig.topic,
          aggregateType: 'Ticket',
          aggregateId: ticket.id,
          status: OutboxStatus.PENDING,
          payload: {
            ticketId: ticket.id,
            publicId: ticket.publicId,
            nextStatus: input.nextStatus,
            address: ticket.patient.email,
          },
        },
      })
    })
  }

  private buildStatusUpdate(ticket: TicketDetails, nextStatus: TicketStatus, note: string | null) {
    const now = new Date()

    return {
      status: nextStatus,
      note: note ?? ticket.note,
      notifiedAt: nextStatus === TicketStatus.NOTIFIED ? ticket.notifiedAt ?? now : ticket.notifiedAt,
      calledAt: nextStatus === TicketStatus.CALLED ? ticket.calledAt ?? now : ticket.calledAt,
      serviceStartedAt:
        nextStatus === TicketStatus.IN_SERVICE ? ticket.serviceStartedAt ?? now : ticket.serviceStartedAt,
      completedAt: nextStatus === TicketStatus.COMPLETED ? ticket.completedAt ?? now : ticket.completedAt,
      cancelledAt: nextStatus === TicketStatus.CANCELLED ? ticket.cancelledAt ?? now : ticket.cancelledAt,
    }
  }
}
