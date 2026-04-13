import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

async function main() {
  const organization = await prisma.organization.upsert({
    where: { slug: 'qdoc-demo' },
    update: {
      name: 'QDoc Demo Clinic Group',
      status: 'ACTIVE',
    },
    create: {
      slug: 'qdoc-demo',
      name: 'QDoc Demo Clinic Group',
      status: 'ACTIVE',
    },
  })

  const staffUser = await prisma.userAccount.upsert({
    where: { email: 'owner@qdoc.local' },
    update: {
      displayName: 'Clinic Owner',
    },
    create: {
      email: 'owner@qdoc.local',
      displayName: 'Clinic Owner',
      emailVerifiedAt: new Date(),
    },
  })

  await prisma.membership.upsert({
    where: {
      organizationId_userAccountId: {
        organizationId: organization.id,
        userAccountId: staffUser.id,
      },
    },
    update: {
      role: 'OWNER',
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
    create: {
      organizationId: organization.id,
      userAccountId: staffUser.id,
      role: 'OWNER',
      status: 'ACTIVE',
      activatedAt: new Date(),
    },
  })

  const site = await prisma.site.upsert({
    where: {
      organizationId_slug: {
        organizationId: organization.id,
        slug: 'downtown-clinic',
      },
    },
    update: {
      name: 'Downtown Walk-In Clinic',
      timezone: 'America/Toronto',
      status: 'ACTIVE',
      publicCheckInEnabled: true,
    },
    create: {
      organizationId: organization.id,
      slug: 'downtown-clinic',
      name: 'Downtown Walk-In Clinic',
      timezone: 'America/Toronto',
      status: 'ACTIVE',
      publicCheckInEnabled: true,
      checkInInstructions: 'Please arrive when your queue status shows that you are almost ready.',
    },
  })

  const department = await prisma.department.upsert({
    where: {
      siteId_slug: {
        siteId: site.id,
        slug: 'general-care',
      },
    },
    update: {
      name: 'General Care',
    },
    create: {
      siteId: site.id,
      slug: 'general-care',
      name: 'General Care',
      description: 'Core walk-in queue for the private beta.',
    },
  })

  const queue = await prisma.queue.upsert({
    where: {
      siteId_slug: {
        siteId: site.id,
        slug: 'walk-in',
      },
    },
    update: {
      name: 'Walk-In Queue',
      departmentId: department.id,
      status: 'OPEN',
      estimatedServiceMinutes: 10,
      acceptsOnlineCheckIn: true,
    },
    create: {
      siteId: site.id,
      departmentId: department.id,
      slug: 'walk-in',
      name: 'Walk-In Queue',
      description: 'Primary queue for patient self check-in during the beta.',
      status: 'OPEN',
      estimatedServiceMinutes: 10,
      acceptsOnlineCheckIn: true,
    },
  })

  const patientUser = await prisma.userAccount.upsert({
    where: { email: 'patient@qdoc.local' },
    update: {
      displayName: 'Demo Patient',
    },
    create: {
      email: 'patient@qdoc.local',
      displayName: 'Demo Patient',
      emailVerifiedAt: new Date(),
    },
  })

  const patient = await prisma.patient.upsert({
    where: {
      organizationId_externalRef: {
        organizationId: organization.id,
        externalRef: 'demo-patient',
      },
    },
    update: {
      email: 'patient@qdoc.local',
      phone: '+1-555-0100',
      givenName: 'Demo',
      familyName: 'Patient',
      userAccountId: patientUser.id,
    },
    create: {
      organizationId: organization.id,
      userAccountId: patientUser.id,
      externalRef: 'demo-patient',
      email: 'patient@qdoc.local',
      phone: '+1-555-0100',
      givenName: 'Demo',
      familyName: 'Patient',
    },
  })

  const ticket = await prisma.ticket.upsert({
    where: { publicId: 'TKT-DEMO-1001' },
    update: {
      organizationId: organization.id,
      siteId: site.id,
      queueId: queue.id,
      patientId: patient.id,
      queueNumber: 1001,
      status: 'WAITING',
    },
    create: {
      organizationId: organization.id,
      siteId: site.id,
      queueId: queue.id,
      patientId: patient.id,
      publicId: 'TKT-DEMO-1001',
      queueNumber: 1001,
      source: 'PATIENT_WEB',
      status: 'WAITING',
      note: 'Seed ticket for initial queue lifecycle development.',
    },
  })

  const createdEvent = await prisma.ticketEvent.findFirst({
    where: {
      ticketId: ticket.id,
      type: 'CREATED',
      note: 'Seed ticket created.',
    },
  })

  if (!createdEvent) {
    await prisma.ticketEvent.create({
      data: {
        ticketId: ticket.id,
        type: 'CREATED',
        note: 'Seed ticket created.',
      },
    })
  }

  const joinedNotification = await prisma.notification.findFirst({
    where: {
      ticketId: ticket.id,
      template: 'QUEUE_JOINED',
      channel: 'EMAIL',
      address: 'patient@qdoc.local',
    },
  })

  if (!joinedNotification) {
    await prisma.notification.create({
      data: {
        organizationId: organization.id,
        siteId: site.id,
        patientId: patient.id,
        ticketId: ticket.id,
        channel: 'EMAIL',
        template: 'QUEUE_JOINED',
        status: 'PENDING',
        address: 'patient@qdoc.local',
        subject: 'You joined the QDoc queue',
      },
    })
  }
}

main()
  .then(async () => {
    await prisma.$disconnect()
  })
  .catch(async (error) => {
    console.error(error)
    await prisma.$disconnect()
    process.exit(1)
  })
