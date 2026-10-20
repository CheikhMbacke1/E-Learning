import { Body, Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { config } from '../common/config';
import { ZodPipe } from '../common/zod.pipe';
import { ACCESS_COOKIE, REFRESH_COOKIE } from './auth.guard';
import { emailOnlySchema, loginSchema, registerSchema, resetSchema, tokenSchema } from './auth.schemas';
import { AuthService, Tokens } from './auth.service';
import { AuthUser } from './auth.types';
import { CurrentUser, Public } from './decorators';

const strict = () => ({ default: { limit: config().AUTH_THROTTLE_LIMIT, ttl: 60_000 } });

@Controller('auth')
export class AuthController {
  constructor(private auth: AuthService) {}

  private ctx(req: Request) { return { ip: req.ip, userAgent: req.headers['user-agent'] }; }

  private setCookies(res: Response, t: Tokens) {
    const secure = config().NODE_ENV === 'production';
    res.cookie(ACCESS_COOKIE, t.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: config().ACCESS_TOKEN_TTL_SECONDS * 1000 });
    res.cookie(REFRESH_COOKIE, t.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/api/auth', expires: t.refreshExpiresAt });
  }
  private clearCookies(res: Response) {
    res.clearCookie(ACCESS_COOKIE, { path: '/' });
    res.clearCookie(REFRESH_COOKIE, { path: '/api/auth' });
  }

  @Public() @Throttle(strict()) @Post('register')
  async register(@Body(new ZodPipe(registerSchema)) body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.register(body, this.ctx(req));
    if (r.verificationRequired) return { verificationRequired: true, message: 'Un e-mail de confirmation vous a été envoyé.' };
    this.setCookies(res, r.tokens);
    return { verificationRequired: false, user: await this.auth.me(r.userId) };
  }

  @Public() @Throttle(strict()) @HttpCode(200) @Post('login')
  async login(@Body(new ZodPipe(loginSchema)) body: any, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const r = await this.auth.login(body.email, body.password, this.ctx(req));
    this.setCookies(res, r.tokens);
    return { user: await this.auth.me(r.userId) };
  }

  @Public() @HttpCode(200) @Post('refresh')
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    try {
      this.setCookies(res, await this.auth.refresh(req.cookies?.[REFRESH_COOKIE], this.ctx(req)));
    } catch (e) { this.clearCookies(res); throw e; }
    return { ok: true };
  }

  @HttpCode(200) @Post('logout')
  async logout(@CurrentUser() u: AuthUser, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(u.sessionId);
    this.clearCookies(res);
    return { ok: true };
  }

  @Get('me')
  me(@CurrentUser() u: AuthUser) {
    return this.auth.me(u.id).then((user) => ({ user, permissions: u.permissions }));
  }

  @Public() @Throttle(strict()) @HttpCode(200) @Post('verify-email')
  async verifyEmail(@Body(new ZodPipe(tokenSchema)) body: any) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @Public() @Throttle(strict()) @HttpCode(200) @Post('request-password-reset')
  async requestReset(@Body(new ZodPipe(emailOnlySchema)) body: any, @Req() req: Request) {
    await this.auth.requestPasswordReset(body.email, this.ctx(req));
    return { message: 'Si un compte existe pour cette adresse, un e-mail de réinitialisation a été envoyé.' };
  }

  @Public() @Throttle(strict()) @HttpCode(200) @Post('reset-password')
  async reset(@Body(new ZodPipe(resetSchema)) body: any, @Req() req: Request) {
    await this.auth.resetPassword(body.token, body.password, this.ctx(req));
    return { ok: true };
  }
}
