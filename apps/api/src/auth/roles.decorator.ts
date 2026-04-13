import { SetMetadata } from '@nestjs/common'

export const ROLES_KEY = 'roles'
export const Roles = (...roles: Array<'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER'>) => SetMetadata(ROLES_KEY, roles)
