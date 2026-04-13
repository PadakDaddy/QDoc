import 'reflect-metadata'

import { ValidationPipe } from '@nestjs/common'
import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'

async function bootstrap() {
  const app = await NestFactory.create(AppModule)
  app.setGlobalPrefix('api')
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  )

  const port = Number(process.env.PORT ?? 4000)
  await app.listen(port)

  const host = process.env.HOST ?? 'localhost'
  console.log(`QDoc API listening on http://${host}:${port}/api`)
}

void bootstrap()
