import {
  CanActivate,
  ExecutionContext,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common'

import type { AuthenticatedRequest } from '../common/authenticated-request'
import { PrismaService } from '../prisma/prisma.service'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const emailHeader = request.headers['x-qdoc-user-email']
    const email = Array.isArray(emailHeader) ? emailHeader[0] : emailHeader

    if (typeof email !== 'string' || !email.trim()) {
      throw new UnauthorizedException('Missing x-qdoc-user-email header')
    }

    const user = await this.prisma.userAccount.findUnique({
      where: {
        email: email.trim().toLowerCase(),
      },
      include: {
        memberships: {
          include: {
            organization: {
              select: {
                id: true,
                slug: true,
              },
            },
          },
        },
      },
    })

    if (!user) {
      throw new NotFoundException('User account not found for the supplied email header')
    }

    request.user = {
      id: user.id,
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

    return true
  }
}
