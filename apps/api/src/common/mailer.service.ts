import { Injectable, Logger } from '@nestjs/common';
import { config } from './config';

/**
 * ADAPTATEUR E-MAIL — NON OPÉRATIONNEL en phase 1.
 * Aucun e-mail n'est réellement envoyé. En développement/test, le message est journalisé
 * (y compris le lien contenant le jeton) pour permettre de tester les flux.
 * En production, le contenu n'est PAS journalisé (les jetons sont des secrets) : un SMTP/API réel doit être branché ici.
 */
@Injectable()
export class MailerService {
  private log = new Logger('Mailer');
  /** Dernier message par destinataire — utilisé uniquement par les tests. */
  readonly outbox: { to: string; subject: string; text: string }[] = [];

  async send(to: string, subject: string, text: string) {
    if (config().NODE_ENV === 'production') {
      this.log.warn(`E-mail "${subject}" non envoyé : aucun fournisseur d'e-mail configuré.`);
      return;
    }
    this.outbox.push({ to, subject, text });
    if (config().NODE_ENV === 'development') this.log.log(`[DEV] À: ${to} | ${subject}\n${text}`);
  }
}
