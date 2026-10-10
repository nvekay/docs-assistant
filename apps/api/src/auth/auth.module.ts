import {
  Body,
  CanActivate,
  ForbiddenException,
  Controller,
  ExecutionContext,
  Global,
  HttpCode,
  Inject,
  Injectable,
  Module,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { timingSafeEqual } from 'node:crypto';
import type { AdminRole, LoginResponse } from '@docs-assistant/shared';
import { z } from 'zod';
import { APP_CONFIG, AppConfig } from '../config/config';
import { ZodValidationPipe } from '../common/zod.pipe';

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
type LoginBody = z.infer<typeof loginSchema>;

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

@Controller('auth')
export class AuthController {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly jwt: JwtService,
  ) {}

  /** Single admin account from env: enough for a demo, no user table needed */
  @Post('login')
  @HttpCode(200)
  async login(@Body(new ZodValidationPipe(loginSchema)) body: LoginBody) {
    const role = this.roleFor(body);
    if (!role) throw new UnauthorizedException('Invalid email or password');
    const response: LoginResponse = { accessToken: await this.jwt.signAsync({ sub: role, role }), role };
    return response;
  }

  /** The demo viewer is optional: a public account that can look at the admin panel but not change it */
  private roleFor({ email, password }: LoginBody): AdminRole | null {
    const { ADMIN_EMAIL, ADMIN_PASSWORD, DEMO_VIEWER_EMAIL, DEMO_VIEWER_PASSWORD } = this.config;
    if (safeEqual(email, ADMIN_EMAIL) && safeEqual(password, ADMIN_PASSWORD)) return 'admin';
    if (
      DEMO_VIEWER_EMAIL &&
      DEMO_VIEWER_PASSWORD &&
      safeEqual(email, DEMO_VIEWER_EMAIL) &&
      safeEqual(password, DEMO_VIEWER_PASSWORD)
    ) {
      return 'viewer';
    }
    return null;
  }
}

const READ_METHODS = new Set(['GET', 'HEAD']);

/** Admins can do everything; the demo viewer only gets read requests */
@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const request = ctx.switchToHttp().getRequest<{ method: string; headers: { authorization?: string } }>();
    const header = request.headers.authorization;
    const token = header?.startsWith('Bearer ') ? header.slice(7) : undefined;
    if (!token) throw new UnauthorizedException('Missing admin token');

    let role: string | undefined;
    try {
      role = (await this.jwt.verifyAsync<{ role?: string }>(token)).role;
    } catch {
      throw new UnauthorizedException('Invalid or expired admin token');
    }
    if (role === 'admin') return true;
    if (role === 'viewer') {
      if (READ_METHODS.has(request.method)) return true;
      throw new ForbiddenException('The demo account is read-only');
    }
    throw new UnauthorizedException('Invalid admin token');
  }
}

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) => ({ secret: config.JWT_SECRET, signOptions: { expiresIn: '12h' } }),
    }),
  ],
  controllers: [AuthController],
  providers: [AdminGuard],
  exports: [AdminGuard, JwtModule],
})
export class AuthModule {}
