import nodemailer from "nodemailer";
import { logger } from "./logger";

export interface EmailService {
  sendEmail(email: string, subject: string, message: string): Promise<void>;
}

const resendApiKey = process.env.RESEND_API_KEY;

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM ?? smtpUser;

function resendIsConfigured(): boolean {
  return Boolean(resendApiKey && emailFrom);
}

function smtpIsConfigured(): boolean {
  return Boolean(smtpHost && smtpUser && smtpPass && emailFrom);
}

/**
 * Отправка через HTTP API Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 * Основной способ в проде: хостинги вроде Render (free-tier) блокируют
 * исходящий SMTP (порты 465/587), из-за чего nodemailer просто виснет.
 * HTTP API таких ограничений не имеет.
 */
class ResendEmailService implements EmailService {
  async sendEmail(email: string, subject: string, message: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${resendApiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: emailFrom,
          to: [email],
          subject,
          text: message,
        }),
      });
    } catch (error) {
      logger.error({ err: error }, "Resend: сетевая ошибка при отправке письма");
      throw new Error("Не удалось отправить письмо с кодом. Попробуйте позже.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ status: response.status, body: body.slice(0, 500) }, "Resend: API вернул ошибку");
      throw new Error("Не удалось отправить письмо с кодом. Попробуйте позже.");
    }
  }
}

/**
 * Отправка через SMTP (nodemailer). Резервный способ для локальной
 * разработки, где SMTP не блокируется.
 */
class SmtpEmailService implements EmailService {
  private readonly transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: process.env.SMTP_SECURE !== "false",
    auth: { user: smtpUser, pass: smtpPass },
  });

  async sendEmail(email: string, subject: string, message: string): Promise<void> {
    try {
      await this.transporter.sendMail({
        from: emailFrom,
        to: email,
        subject,
        text: message,
      });
    } catch (error) {
      logger.error({ err: error }, "Email delivery failed");
      throw new Error("Не удалось отправить письмо с кодом. Попробуйте позже.");
    }
  }
}

class DevStubEmailService implements EmailService {
  async sendEmail(email: string, subject: string, message: string): Promise<void> {
    logger.info({ to: email, subject, message }, "[DEV EMAIL] код не отправлен реально (Resend/SMTP не настроены)");
  }
}

if (process.env.NODE_ENV === "production" && !resendIsConfigured() && !smtpIsConfigured()) {
  throw new Error(
    "Email is not configured. Set RESEND_API_KEY (recommended for hosting that blocks SMTP) " +
      "or the SMTP_* variables, plus EMAIL_FROM, in server/.env"
  );
}

/**
 * Приоритет выбора: Resend > SMTP > dev-заглушка.
 * - RESEND_API_KEY задан  → ResendEmailService (прод на Render)
 * - иначе SMTP настроен   → SmtpEmailService (локальная разработка)
 * - иначе                 → DevStubEmailService (без настроек — только лог)
 */
export const emailService: EmailService = resendIsConfigured()
  ? new ResendEmailService()
  : smtpIsConfigured()
    ? new SmtpEmailService()
    : new DevStubEmailService();
