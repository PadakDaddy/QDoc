import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common'

import { CurrentUser } from '../common/current-user.decorator'
import type { RequestUser } from '../common/request-user'
import { AuthGuard } from './auth.guard'
import { AuthService } from './auth.service'
import { CreateAuthChallengeDto } from './dto/create-auth-challenge.dto'
import { RevokeSessionDto } from './dto/revoke-session.dto'
import { VerifyAuthChallengeDto } from './dto/verify-auth-challenge.dto'

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('challenges')
  createChallenge(@Body() body: CreateAuthChallengeDto) {
    return this.authService.createChallenge(body)
  }

  @Post('challenges/:challengeId/verify')
  verifyChallenge(@Param('challengeId') challengeId: string, @Body() body: VerifyAuthChallengeDto) {
    return this.authService.verifyChallenge(challengeId, body)
  }

  @Get('session')
  @UseGuards(AuthGuard)
  getSession(@CurrentUser() user: RequestUser) {
    return this.authService.getSessionFromUserContext(user)
  }

  @Post('session/revoke')
  @UseGuards(AuthGuard)
  revokeSession(@Body() body: RevokeSessionDto, @CurrentUser() user: RequestUser) {
    return this.authService.revokeSession(body.sessionToken, user)
  }
}
