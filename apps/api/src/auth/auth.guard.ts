import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common'

import type { AuthenticatedRequest } from '../common/authenticated-request'
import { AuthService } from './auth.service'

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
    const token = this.readToken(request)

    if (!token) {
      throw new UnauthorizedException('Missing session token')
    }

    request.user = await this.authService.authenticateSession(token)
    return true
  }

  private readToken(request: AuthenticatedRequest) {
    const authorization = request.headers.authorization
    if (typeof authorization === 'string' && authorization.toLowerCase().startsWith('bearer ')) {
      const [, token] = authorization.split(' ')
      if (token?.trim()) {
        return token.trim()
      }
    }

    const sessionHeader = request.headers['x-qdoc-session-token']
    const token = Array.isArray(sessionHeader) ? sessionHeader[0] : sessionHeader
    return typeof token === 'string' && token.trim() ? token.trim() : null
  }
}
