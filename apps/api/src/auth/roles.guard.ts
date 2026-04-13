import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common'
import { Reflector } from '@nestjs/core'

import type { AuthenticatedRequest } from '../common/authenticated-request'
import { ROLES_KEY } from './roles.decorator'

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext) {
    const requiredRoles = this.reflector.getAllAndOverride<Array<'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER'>>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ])

    if (!requiredRoles || requiredRoles.length === 0) {
      return true
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const user = request.user

    if (!user) {
      throw new ForbiddenException('Missing authenticated user context')
    }

    const hasRole = user.memberships.some(
      (membership) => membership.status === 'ACTIVE' && requiredRoles.includes(membership.role),
    )

    if (!hasRole) {
      throw new ForbiddenException('User does not have the required membership role')
    }

    return true
  }
}
