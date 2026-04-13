import { Module } from '@nestjs/common'

import { AuthModule } from '../auth/auth.module'
import { QueuesController } from './queues.controller'
import { QueuesService } from './queues.service'

@Module({
  imports: [AuthModule],
  controllers: [QueuesController],
  providers: [QueuesService],
  exports: [QueuesService],
})
export class QueuesModule {}
