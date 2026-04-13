import { Module } from '@nestjs/common'
import { APP_GUARD } from '@nestjs/core'

import { AuthGuard } from './auth.guard'
import { AuthController } from './auth.controller'
import { AuthService } from './auth.service'
import { RolesGuard } from './roles.guard'

@Module({
  controllers: [AuthController],
  providers: [
    AuthGuard,
    AuthService,
    {
      provide: APP_GUARD,
      useClass: RolesGuard,
    },
  ],
  exports: [AuthGuard, AuthService],
})
export class AuthModule {}
