import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common'

import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { CreateAuthChallengeDto } from './dto/create-auth-challenge.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('challenges')
  createChallenge(@Body() body: CreateAuthChallengeDto) {
    return this.authService.createChallenge(body)
  }

  @Get('session')
  @UseGuards(AuthGuard)
  getSession(@Headers('x-qdoc-user-email') email: string) {
    return this.authService.getSession(email)
  }
}
