import type { Request } from 'express'

import type { RequestUser } from './request-user'

export type AuthenticatedRequest = Request & {
  user?: RequestUser
}
