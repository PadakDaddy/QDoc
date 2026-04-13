import { createHash, randomBytes } from 'node:crypto'

import { Injectable, NotFoundException } from '@nestjs/common'
import { NotificationChannel, NotificationTemplate, OutboxStatus } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { CreateAuthChallengeDto } from './dto/create-auth-challenge.dto'

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService) {}

  async createChallenge(input: CreateAuthChallengeDto) {
    const email = input.email.trim().toLowerCase()
    const organization =
      input.organizationSlug && input.organizationSlug.trim()
        ? await this.prisma.organization.findUnique({
            where: { slug: input.organizationSlug.trim() },
          })
        : null

    if (input.organizationSlug && !organization) {
      throw new NotFoundException('Organization not found for auth challenge')
    }

    const user = await this.prisma.userAccount.upsert({
      where: { email },
      update: {},
      create: {
        email,
      },
    })

    const previewToken = randomBytes(16).toString('hex')
    const tokenHash = hashValue(previewToken)
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000)

    const challenge = await this.prisma.authChallenge.create({
      data: {
        userAccountId: user.id,
        email,
        purpose: input.purpose,
        tokenHash,
        expiresAt,
      },
    })

    if (organization) {
      await this.prisma.notification.create({
        data: {
          organizationId: organization.id,
          channel: NotificationChannel.EMAIL,
          template: NotificationTemplate.SIGN_IN_LINK,
          status: 'PENDING',
          address: email,
          subject: 'QDoc sign-in link',
          payload: {
            challengeId: challenge.id,
            purpose: input.purpose,
            expiresAt: expiresAt.toISOString(),
          },
        },
      })
    }

    await this.prisma.outboxEntry.create({
      data: {
        organizationId: organization?.id,
        topic: 'notification.email.requested',
        aggregateType: 'AuthChallenge',
        aggregateId: challenge.id,
        status: OutboxStatus.PENDING,
        payload: {
          challengeId: challenge.id,
          email,
          purpose: input.purpose,
          previewToken,
        },
      },
    })

    return {
      challengeId: challenge.id,
      email,
      purpose: input.purpose,
      expiresAt: challenge.expiresAt.toISOString(),
      previewToken,
    }
  }

  async getSession(email: string) {
    const normalizedEmail = email.trim().toLowerCase()
    const user = await this.prisma.userAccount.findUnique({
      where: { email: normalizedEmail },
      include: {
        memberships: {
          include: {
            organization: {
              select: {
                id: true,
                slug: true,
                name: true,
                status: true,
              },
            },
          },
          orderBy: {
            createdAt: 'asc',
          },
        },
      },
    })

    if (!user) {
      throw new NotFoundException('Session user not found')
    }

    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
      },
      memberships: user.memberships.map((membership) => ({
        id: membership.id,
        role: membership.role,
        status: membership.status,
        organization: membership.organization,
      })),
    }
  }
}
