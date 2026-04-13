import { Module } from '@nestjs/common'
import { ConfigModule } from '@nestjs/config'

import { AuthModule } from './auth/auth.module'
import { HealthController } from './health/health.controller'
import { OrganizationsModule } from './organizations/organizations.module'
import { PrismaModule } from './prisma/prisma.module'
import { QueuesModule } from './queues/queues.module'
import { TicketsModule } from './tickets/tickets.module'

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      expandVariables: true,
    }),
    PrismaModule,
    AuthModule,
    OrganizationsModule,
    QueuesModule,
    TicketsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
