import { Module } from '@nestjs/common'

import { AuthGuard } from './auth.guard'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RolesGuard } from './roles.guard'

@Module({
  controllers: [AuthController],
  providers: [
    AuthGuard,
    RolesGuard,
    AuthService,
  ],
  exports: [AuthGuard, AuthService, RolesGuard],
})
export class AuthModule {}
