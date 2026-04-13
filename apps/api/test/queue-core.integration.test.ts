import assert from 'node:assert/strict'
import test from 'node:test'

import { ConflictException, ForbiddenException } from '@nestjs/common'
import { NotificationStatus, OutboxStatus, TicketSource, TicketStatus } from '@prisma/client'

import type { RequestUser } from '../src/common/request-user'
import { QueuesService } from '../src/queues/queues.service'
import { TicketsService } from '../src/tickets/tickets.service'

type State = ReturnType<typeof createState>

function createState() {
  return {
    organizations: [
      {
        id: 'org-1',
        slug: 'qdoc-demo',
        name: 'QDoc Demo Clinic Group',
        status: 'ACTIVE',
      },
    ],
    sites: [
      {
        id: 'site-1',
        organizationId: 'org-1',
        slug: 'downtown-clinic',
        name: 'Downtown Walk-In Clinic',
        timezone: 'America/Toronto',
        status: 'ACTIVE',
        publicCheckInEnabled: true,
      },
    ],
    departments: [
      {
        id: 'dept-1',
        siteId: 'site-1',
        slug: 'general-care',
        name: 'General Care',
        description: 'Primary beta department',
      },
    ],
    queues: [
      {
        id: 'queue-1',
        siteId: 'site-1',
        departmentId: 'dept-1',
        slug: 'walk-in',
        name: 'Walk-In Queue',
        description: 'Primary queue',
        status: 'OPEN',
        acceptsOnlineCheckIn: true,
        estimatedServiceMinutes: 10,
        maxActiveTickets: 3,
      },
    ],
    userAccounts: [
      {
        id: 'user-owner',
        email: 'owner@qdoc.local',
        displayName: 'Clinic Owner',
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLoginAt: null,
      },
      {
        id: 'user-patient',
        email: 'patient@qdoc.local',
        displayName: 'Demo Patient',
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLoginAt: null,
      },
      {
        id: 'user-other',
        email: 'other@qdoc.local',
        displayName: 'Other Patient',
        emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
        lastLoginAt: null,
      },
    ],
    memberships: [
      {
        id: 'membership-1',
        organizationId: 'org-1',
        userAccountId: 'user-owner',
        role: 'OWNER',
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01T00:00:00.000Z'),
      },
    ],
    patients: [
      {
        id: 'patient-1',
        organizationId: 'org-1',
        userAccountId: 'user-patient',
        externalRef: 'email:patient@qdoc.local',
        email: 'patient@qdoc.local',
        phone: '+1-555-0100',
        givenName: 'Demo',
        familyName: 'Patient',
      },
      {
        id: 'patient-2',
        organizationId: 'org-1',
        userAccountId: 'user-other',
        externalRef: 'email:other@qdoc.local',
        email: 'other@qdoc.local',
        phone: '+1-555-0101',
        givenName: 'Other',
        familyName: 'Visitor',
      },
    ],
    tickets: [
      {
        id: 'ticket-1',
        organizationId: 'org-1',
        siteId: 'site-1',
        queueId: 'queue-1',
        patientId: 'patient-2',
        publicId: 'TKT-DEMO-1001',
        queueNumber: 1001,
        source: TicketSource.PATIENT_WEB,
        status: TicketStatus.WAITING,
        note: 'Existing patient ahead.',
        checkedInAt: new Date('2026-01-01T10:00:00.000Z'),
        notifiedAt: null,
        calledAt: null,
        serviceStartedAt: null,
        completedAt: null,
        cancelledAt: null,
      },
      {
        id: 'ticket-2',
        organizationId: 'org-1',
        siteId: 'site-1',
        queueId: 'queue-1',
        patientId: 'patient-1',
        publicId: 'TKT-DEMO-1002',
        queueNumber: 1002,
        source: TicketSource.PATIENT_WEB,
        status: TicketStatus.WAITING,
        note: 'Need prescription renewal.',
        checkedInAt: new Date('2026-01-01T10:05:00.000Z'),
        notifiedAt: null,
        calledAt: null,
        serviceStartedAt: null,
        completedAt: null,
        cancelledAt: null,
      },
    ],
    ticketEvents: [
      {
        id: 'event-1',
        ticketId: 'ticket-1',
        membershipId: null,
        actorUserId: 'user-other',
        type: 'CREATED',
        fromStatus: null,
        toStatus: null,
        note: 'Seed ticket created.',
        payload: null,
        createdAt: new Date('2026-01-01T10:00:00.000Z'),
      },
      {
        id: 'event-2',
        ticketId: 'ticket-2',
        membershipId: null,
        actorUserId: 'user-patient',
        type: 'CREATED',
        fromStatus: null,
        toStatus: null,
        note: 'Seed ticket created.',
        payload: null,
        createdAt: new Date('2026-01-01T10:05:00.000Z'),
      },
    ],
    notifications: [] as Array<Record<string, unknown>>,
    outboxEntries: [] as Array<Record<string, unknown>>,
  }
}

function createPrisma(state: State) {
  const findOrganization = (organizationId: string) => state.organizations.find((item) => item.id === organizationId) ?? null
  const findSite = (siteId: string) => state.sites.find((item) => item.id === siteId) ?? null
  const findDepartment = (departmentId: string | null) =>
    departmentId ? state.departments.find((item) => item.id === departmentId) ?? null : null
  const findPatient = (patientId: string) => state.patients.find((item) => item.id === patientId) ?? null

  const hydrateTicket = (ticket: (typeof state.tickets)[number]) => {
    const patient = findPatient(ticket.patientId)
    const queue = state.queues.find((item) => item.id === ticket.queueId)
    const site = queue ? findSite(queue.siteId) : null
    const organization = site ? findOrganization(site.organizationId) : null

    if (!patient || !queue || !site || !organization) {
      throw new Error('Failed to hydrate ticket')
    }

    return {
      ...ticket,
      patient,
      queue: {
        ...queue,
        site: {
          ...site,
          organization,
        },
      },
      events: state.ticketEvents
        .filter((event) => event.ticketId === ticket.id)
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime()),
    }
  }

  const hydrateQueue = (queue: (typeof state.queues)[number]) => {
    const site = findSite(queue.siteId)
    const department = findDepartment(queue.departmentId)

    if (!site) {
      throw new Error('Failed to hydrate queue')
    }

    return {
      ...queue,
      site: {
        ...site,
      },
      department,
      tickets: state.tickets.filter(
        (ticket) =>
          ticket.queueId === queue.id &&
          [TicketStatus.WAITING, TicketStatus.NOTIFIED, TicketStatus.CALLED, TicketStatus.IN_SERVICE].includes(
            ticket.status,
          ),
      ),
    }
  }

  const prisma: any = {
    $transaction: async (callback: (tx: typeof prisma) => unknown) => callback(prisma),
    queue: {
      findFirst: async (args: any) => {
        const queue = state.queues.find((candidate) => {
          if (args.where?.id && candidate.id !== args.where.id) {
            return false
          }
          if (args.where?.slug && candidate.slug !== args.where.slug) {
            return false
          }
          if (args.where?.status && candidate.status !== args.where.status) {
            return false
          }
          if (
            args.where?.acceptsOnlineCheckIn !== undefined &&
            candidate.acceptsOnlineCheckIn !== args.where.acceptsOnlineCheckIn
          ) {
            return false
          }

          const site = findSite(candidate.siteId)
          const organization = site ? findOrganization(site.organizationId) : null
          if (!site || !organization) {
            return false
          }

          if (args.where?.site?.slug && site.slug !== args.where.site.slug) {
            return false
          }
          if (args.where?.site?.status && site.status !== args.where.site.status) {
            return false
          }
          if (
            args.where?.site?.publicCheckInEnabled !== undefined &&
            site.publicCheckInEnabled !== args.where.site.publicCheckInEnabled
          ) {
            return false
          }
          if (args.where?.site?.organization?.slug && organization.slug !== args.where.site.organization.slug) {
            return false
          }
          if (args.where?.site?.organization?.status && organization.status !== args.where.site.organization.status) {
            return false
          }

          return true
        })

        if (!queue) {
          return null
        }

        if (args.select?.id) {
          return { id: queue.id }
        }

        return hydrateQueue(queue)
      },
      update: async (args: any) => {
        const queue = state.queues.find((candidate) => candidate.id === args.where.id)
        if (!queue) {
          throw new Error('Queue not found')
        }

        Object.assign(queue, args.data)
        return queue
      },
    },
    userAccount: {
      upsert: async (args: any) => {
        const existing = state.userAccounts.find((account) => account.email === args.where.email)
        if (existing) {
          Object.assign(existing, args.update)
          return existing
        }

        const created = {
          id: `user-${state.userAccounts.length + 1}`,
          email: args.create.email,
          displayName: args.create.displayName ?? null,
          emailVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
          lastLoginAt: null,
        }
        state.userAccounts.push(created)
        return created
      },
    },
    patient: {
      upsert: async (args: any) => {
        const key = args.where.organizationId_externalRef
        const existing = state.patients.find(
          (patient) => patient.organizationId === key.organizationId && patient.externalRef === key.externalRef,
        )
        if (existing) {
          Object.assign(existing, args.update)
          return existing
        }

        const created = {
          id: `patient-${state.patients.length + 1}`,
          ...args.create,
        }
        state.patients.push(created)
        return created
      },
    },
    ticket: {
      findFirst: async (args: any) => {
        let matches = [...state.tickets]
        if (args.where?.queueId) {
          matches = matches.filter((ticket) => ticket.queueId === args.where.queueId)
        }
        if (args.where?.patientId) {
          matches = matches.filter((ticket) => ticket.patientId === args.where.patientId)
        }
        if (args.where?.status?.in) {
          matches = matches.filter((ticket) => args.where.status.in.includes(ticket.status))
        }

        if (args.orderBy?.queueNumber === 'desc') {
          matches.sort((left, right) => right.queueNumber - left.queueNumber)
        }

        const match = matches[0] ?? null
        if (!match) {
          return null
        }

        if (args.select?.queueNumber) {
          return { queueNumber: match.queueNumber }
        }

        return match
      },
      findUnique: async (args: any) => {
        const ticket = state.tickets.find((candidate) => candidate.publicId === args.where.publicId) ?? null
        return ticket ? hydrateTicket(ticket) : null
      },
      findMany: async (args: any) => {
        let matches = [...state.tickets]
        if (args.where?.OR) {
          matches = matches.filter((ticket) =>
            args.where.OR.some((clause: any) => {
              const patient = findPatient(ticket.patientId)
              return (
                (clause.patient?.userAccountId && patient?.userAccountId === clause.patient.userAccountId) ||
                (clause.patient?.email && patient?.email === clause.patient.email)
              )
            }),
          )
        }

        matches.sort((left, right) => right.checkedInAt.getTime() - left.checkedInAt.getTime())
        return matches.map((ticket) => hydrateTicket(ticket))
      },
      count: async (args: any) => {
        return state.tickets.filter((ticket) => {
          if (args.where?.queueId && ticket.queueId !== args.where.queueId) {
            return false
          }
          if (args.where?.status?.in && !args.where.status.in.includes(ticket.status)) {
            return false
          }
          if (
            args.where?.queueNumber?.lt !== undefined &&
            !(ticket.queueNumber < Number(args.where.queueNumber.lt))
          ) {
            return false
          }

          return true
        }).length
      },
      create: async (args: any) => {
        const created = {
          id: `ticket-${state.tickets.length + 1}`,
          checkedInAt: new Date('2026-01-01T10:10:00.000Z'),
          notifiedAt: null,
          calledAt: null,
          serviceStartedAt: null,
          completedAt: null,
          cancelledAt: null,
          ...args.data,
        }
        state.tickets.push(created)
        return created
      },
      update: async (args: any) => {
        const ticket = state.tickets.find((candidate) => candidate.id === args.where.id)
        if (!ticket) {
          throw new Error('Ticket not found')
        }

        Object.assign(ticket, args.data)
        return ticket
      },
    },
    ticketEvent: {
      create: async (args: any) => {
        const created = {
          id: `event-${state.ticketEvents.length + 1}`,
          payload: null,
          createdAt: new Date('2026-01-01T10:15:00.000Z'),
          ...args.data,
        }
        state.ticketEvents.push(created)
        return created
      },
    },
    notification: {
      create: async (args: any) => {
        const created = {
          id: `notification-${state.notifications.length + 1}`,
          status: NotificationStatus.PENDING,
          ...args.data,
        }
        state.notifications.push(created)
        return created
      },
    },
    outboxEntry: {
      create: async (args: any) => {
        const created = {
          id: `outbox-${state.outboxEntries.length + 1}`,
          status: OutboxStatus.PENDING,
          ...args.data,
        }
        state.outboxEntries.push(created)
        return created
      },
    },
  }

  return prisma
}

function createServices() {
  const state = createState()
  const prisma = createPrisma(state)

  return {
    state,
    queuesService: new QueuesService(prisma as any),
    ticketsService: new TicketsService(prisma as any),
  }
}

function createStaffUser(): RequestUser {
  return {
    id: 'user-owner',
    sessionId: 'session-owner',
    email: 'owner@qdoc.local',
    displayName: 'Clinic Owner',
    memberships: [
      {
        id: 'membership-1',
        organizationId: 'org-1',
        organizationSlug: 'qdoc-demo',
        role: 'OWNER',
        status: 'ACTIVE',
      },
    ],
  }
}

function createPatientUser(): RequestUser {
  return {
    id: 'user-patient',
    sessionId: 'session-patient',
    email: 'patient@qdoc.local',
    displayName: 'Demo Patient',
    memberships: [],
  }
}

test('public ticket lookup omits private patient contact details', async () => {
  const { ticketsService } = createServices()

  const ticket = await ticketsService.getTicket('TKT-DEMO-1002')

  assert.equal(ticket.status, TicketStatus.WAITING)
  assert.deepEqual(ticket.patient, {
    givenName: 'Demo',
    familyNameInitial: 'P',
  })
  assert.equal('events' in ticket, false)
})

test('patient self-cancel updates the ticket and queues a notification', async () => {
  const { state, ticketsService } = createServices()

  const ticket = await ticketsService.cancel('TKT-DEMO-1002', createPatientUser(), {
    note: 'No longer needed today.',
  })

  assert.equal(ticket.status, TicketStatus.CANCELLED)
  assert.equal(state.tickets.find((item) => item.publicId === 'TKT-DEMO-1002')?.status, TicketStatus.CANCELLED)
  assert.equal(state.notifications.length, 1)
  assert.equal(state.outboxEntries.length, 1)
})

test('staff transition rules reject invalid lifecycle jumps', async () => {
  const { ticketsService } = createServices()

  await assert.rejects(
    () =>
      ticketsService.updateStatus('TKT-DEMO-1002', createStaffUser(), {
        status: TicketStatus.COMPLETED,
      }),
    ConflictException,
  )
})

test('enroll creates a waiting ticket with notification and outbox records', async () => {
  const { state, ticketsService } = createServices()

  const ticket = await ticketsService.enroll({
    organizationSlug: 'qdoc-demo',
    siteSlug: 'downtown-clinic',
    queueSlug: 'walk-in',
    email: 'newpatient@qdoc.local',
    givenName: 'New',
    familyName: 'Patient',
    phone: '+1-555-0102',
    note: 'Checking in from the beta flow.',
  })

  assert.equal(ticket.status, TicketStatus.WAITING)
  assert.equal(ticket.queueNumber, 1003)
  assert.equal(ticket.patient.email, 'newpatient@qdoc.local')
  assert.equal(state.notifications.length, 1)
  assert.equal(state.outboxEntries.length, 1)
})

test('queue settings cannot reduce capacity below the active ticket count', async () => {
  const { queuesService } = createServices()

  await assert.rejects(
    () =>
      queuesService.updateQueueSettings('qdoc-demo', 'downtown-clinic', 'walk-in', createStaffUser(), {
        maxActiveTickets: 1,
      }),
    ForbiddenException,
  )
})
