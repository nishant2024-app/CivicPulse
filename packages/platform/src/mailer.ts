import nodemailer from "nodemailer";
import type { Logger } from "pino";

export interface EmailMessage {
  to: string;
  subject: string;
  text: string;
  /** Short machine-readable name, e.g. "password-reset". Safe to log. */
  template: string;
}

export interface Mailer {
  readonly driver: string;
  send(message: EmailMessage): Promise<void>;
}

/**
 * Development mailer: writes the message to the log instead of sending it.
 * Bodies can contain single-use links, so they are logged only outside production.
 */
export function createLogMailer(logger: Logger, options: { logBodies: boolean }): Mailer {
  return {
    driver: "log",
    async send(message) {
      logger.info(
        {
          email: {
            to: message.to,
            subject: message.subject,
            template: message.template,
            ...(options.logBodies ? { text: message.text } : {}),
          },
        },
        "email (log driver, not sent)",
      );
    },
  };
}

/** SMTP delivery: Mailpit in the demo cluster, or any provider's SMTP relay. */
export function createSmtpMailer(url: string, from: string): Mailer {
  const transport = nodemailer.createTransport({
    url,
    connectionTimeout: 5000,
    socketTimeout: 10_000,
  });
  return {
    driver: "smtp",
    async send(message) {
      await transport.sendMail({
        from,
        to: message.to,
        subject: message.subject,
        text: message.text,
      });
    },
  };
}
