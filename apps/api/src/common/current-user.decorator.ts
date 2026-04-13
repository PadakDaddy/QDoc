import { createParamDecorator, ExecutionContext } from '@nestjs/common'

import type { AuthenticatedRequest } from './authenticated-request'

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext) => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>()
  return request.user
})
