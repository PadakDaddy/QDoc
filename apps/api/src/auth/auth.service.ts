import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import { Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common'
import {
  NotificationChannel,
  NotificationTemplate,
  OutboxStatus,
  type AuthChallenge,
  type AuthSession,
  type UserAccount,
} from '@prisma/client'

import type { RequestUser } from '../common/request-user'
import { PrismaService } from '../prisma/prisma.service'
import { CreateAuthChallengeDto } from './dto/create-auth-challenge.dto'
import { VerifyAuthChallengeDto } from './dto/verify-auth-challenge.dto'

const CHALLENGE_WINDOW_MS = 15 * 60 * 1000
const SESSION_WINDOW_MS = 30 * 24 * 60 * 60 * 1000

function hashValue(value: string) {
  return createHash('sha256').update(value).digest('hex')
}

function randomToken(bytes = 16) {
  return randomBytes(bytes).toString('hex')
}

function randomCode() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

function safeHashCompare(rawValue: string, expectedHash: string | null) {
  if (!expectedHash) {
    return false
  }

  const rawHash = hashValue(rawValue)
  return timingSafeEqual(Buffer.from(rawHash), Buffer.from(expectedHash))
}

type SessionIdentity = {
  session: AuthSession
  user: UserAccount & {
    memberships: Array<{
      id: string
      organizationId: string
      role: 'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER'
      status: 'INVITED' | 'ACTIVE' | 'SUSPENDED'
      organization: {
        id: string
        slug: string
        name: string
        status: 'ACTIVE' | 'INACTIVE'
      }
    }>
  }
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

    const previewToken = randomToken(16)
    const previewCode = randomCode()
    const expiresAt = new Date(Date.now() + CHALLENGE_WINDOW_MS)

    const challenge = await this.prisma.authChallenge.create({
      data: {
        userAccountId: user.id,
        email,
        purpose: input.purpose,
        tokenHash: hashValue(previewToken),
        codeHash: hashValue(previewCode),
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
          previewCode,
        },
      },
    })

    const response = {
      challengeId: challenge.id,
      email,
      purpose: input.purpose,
      expiresAt: challenge.expiresAt.toISOString(),
    }

    if ((process.env.NODE_ENV ?? 'development').toLowerCase() !== 'production') {
      return {
        ...response,
        previewToken,
        previewCode,
      }
    }

    return response
  }

  async verifyChallenge(challengeId: string, input: VerifyAuthChallengeDto) {
    if (!input.token && !input.code) {
      throw new UnauthorizedException('Either token or code is required')
    }

    const challenge = await this.prisma.authChallenge.findUnique({
      where: {
        id: challengeId,
      },
      include: {
        userAccount: true,
      },
    })

    if (!challenge || !challenge.userAccount) {
      throw new NotFoundException('Auth challenge not found')
    }

    const challengeUser = challenge.userAccount

    this.assertChallengeUsable(challenge)

    const tokenMatches = input.token ? safeHashCompare(input.token, challenge.tokenHash) : false
    const codeMatches = input.code ? safeHashCompare(input.code, challenge.codeHash) : false

    if (!tokenMatches && !codeMatches) {
      throw new UnauthorizedException('Auth challenge verification failed')
    }

    const sessionToken = randomToken(24)
    const sessionHash = hashValue(sessionToken)
    const sessionExpiresAt = new Date(Date.now() + SESSION_WINDOW_MS)

    await this.prisma.$transaction(async (tx) => {
      await tx.authChallenge.update({
        where: {
          id: challenge.id,
        },
        data: {
          consumedAt: new Date(),
        },
      })

      await tx.userAccount.update({
        where: {
          id: challenge.userAccountId!,
        },
        data: {
          emailVerifiedAt: challengeUser.emailVerifiedAt ?? new Date(),
          lastLoginAt: new Date(),
        },
      })

      await tx.authSession.updateMany({
        where: {
          userAccountId: challenge.userAccountId!,
          revokedAt: null,
          expiresAt: {
            gt: new Date(),
          },
        },
        data: {
          revokedAt: new Date(),
        },
      })

      await tx.authSession.create({
        data: {
          userAccountId: challenge.userAccountId!,
          challengeId: challenge.id,
          tokenHash: sessionHash,
          expiresAt: sessionExpiresAt,
          lastUsedAt: new Date(),
        },
      })
    })

    const session = await this.getSessionByToken(sessionToken)

    return {
      sessionToken,
      expiresAt: session.session.expiresAt.toISOString(),
      ...this.toSessionResponse(session.user),
    }
  }

  async getSession(token: string) {
    const session = await this.getSessionByToken(token)

    return {
      session: {
        id: session.session.id,
        expiresAt: session.session.expiresAt.toISOString(),
      },
      ...this.toSessionResponse(session.user),
    }
  }

  async getSessionFromUserContext(user: RequestUser) {
    const session = await this.prisma.authSession.findUnique({
      where: {
        id: user.sessionId,
      },
      include: {
        userAccount: {
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
        },
      },
    })

    if (!session) {
      throw new NotFoundException('Session not found')
    }

    if (session.revokedAt || session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session is no longer active')
    }

    return {
      session: {
        id: session.id,
        expiresAt: session.expiresAt.toISOString(),
      },
      ...this.toSessionResponse(session.userAccount),
    }
  }

  async revokeSession(token: string | undefined, user: RequestUser) {
    const existing = token
      ? await this.prisma.authSession.findUnique({
          where: {
            tokenHash: hashValue(token),
          },
        })
      : await this.prisma.authSession.findUnique({
          where: {
            id: user.sessionId,
          },
        })

    if (!existing || existing.revokedAt || existing.expiresAt <= new Date()) {
      throw new NotFoundException('Session not found')
    }

    if (existing.userAccountId !== user.id) {
      throw new UnauthorizedException('Cannot revoke a session that belongs to another user')
    }

    await this.prisma.authSession.update({
      where: {
        id: existing.id,
      },
      data: {
        revokedAt: new Date(),
      },
    })

    return {
      revoked: true,
      sessionId: existing.id,
    }
  }

  async authenticateSession(token: string): Promise<RequestUser> {
    const session = await this.getSessionByToken(token)
    return this.toRequestUser(session.session, session.user)
  }

  private async getSessionByToken(token: string): Promise<SessionIdentity> {
    const sessionHash = hashValue(token)
    const session = await this.prisma.authSession.findUnique({
      where: {
        tokenHash: sessionHash,
      },
      include: {
        userAccount: {
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
        },
      },
    })

    if (!session) {
      throw new UnauthorizedException('Session token is invalid')
    }

    if (session.revokedAt) {
      throw new UnauthorizedException('Session has been revoked')
    }

    if (session.expiresAt <= new Date()) {
      throw new UnauthorizedException('Session has expired')
    }

    await this.prisma.authSession.update({
      where: {
        id: session.id,
      },
      data: {
        lastUsedAt: new Date(),
      },
    })

    return {
      session,
      user: session.userAccount,
    }
  }

  private assertChallengeUsable(challenge: AuthChallenge) {
    if (challenge.consumedAt) {
      throw new UnauthorizedException('Auth challenge has already been used')
    }

    if (challenge.expiresAt <= new Date()) {
      throw new UnauthorizedException('Auth challenge has expired')
    }
  }

  private toRequestUser(session: AuthSession, user: SessionIdentity['user']): RequestUser {
    return {
      id: user.id,
      sessionId: session.id,
      email: user.email,
      displayName: user.displayName,
      memberships: user.memberships.map((membership) => ({
        id: membership.id,
        organizationId: membership.organizationId,
        organizationSlug: membership.organization.slug,
        role: membership.role,
        status: membership.status,
      })),
    }
  }

  private toSessionResponse(user: SessionIdentity['user']) {
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
