import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { config } from '../common/config';

/**
 * Protection CSRF pour l'authentification par cookies : toute requête modifiante doit
 *  - provenir d'une origine autorisée (en-tête Origin), OU
 *  - porter l'en-tête personnalisé `X-CAP-CSRF` (impossible à poser depuis un formulaire inter-sites).
 * Les cookies sont en plus SameSite=Lax.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest();
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return true;
    const allowed = config().WEB_ORIGIN.split(',').map((s) => s.trim());
    const origin = req.headers.origin as string | undefined;
    if (origin) {
      if (allowed.includes(origin)) return true;
      throw new ForbiddenException('Origine non autorisée');
    }
    if (req.headers['x-cap-csrf'] === '1') return true;
    throw new ForbiddenException('En-tête CSRF manquant');
  }
}
