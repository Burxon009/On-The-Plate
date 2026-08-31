import nodemailer from "nodemailer";
import { logger } from "./logger";

export interface EmailService {
  sendEmail(email: string, subject: string, message: string): Promise<void>;
}

const brevoApiKey = process.env.BREVO_API_KEY;
const resendApiKey = process.env.RESEND_API_KEY;

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM ?? smtpUser;

function brevoIsConfigured(): boolean {
  return Boolean(brevoApiKey && emailFrom);
}

function resendIsConfigured(): boolean {
  return Boolean(resendApiKey && emailFrom);
}

function smtpIsConfigured(): boolean {
  return Boolean(smtpHost && smtpUser && smtpPass && emailFrom);
}

/**
 * EMAIL_FROM хранится в SMTP-формате: `On the plate <burhanruziev@gmail.com>`
 * или просто `burhanruziev@gmail.com`. Brevo ожидает name и email раздельно.
 */
function parseSender(raw: string | undefined): { name?: string; email: string } {
  const value = (raw ?? "").trim();
  const angle = value.match(/^(.*?)<([^>]+)>\s*$/);
  if (angle) {
    const name = angle[1].trim().replace(/^"+|"+$/g, "").trim();
    return { name: name || undefined, email: angle[2].trim() };
  }
  return { email: value };
}

/**
 * Отправка через HTTP API Brevo (https://developers.brevo.com/reference/sendtransacemail).
 *
 * Основной провайдер: работает через single sender verification (подтверждение
 * одного email-адреса), домен не нужен. Хостинги вроде Render (free-tier)
 * блокируют исходящий SMTP — HTTP API таких ограничений не имеет.
 */
class BrevoEmailService implements EmailService {
  private readonly sender = parseSender(emailFrom);

  async sendEmail(email: string, subject: string, message: string): Promise<void> {
    let response: Response;
    try {
      response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": brevoApiKey as string,
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          sender: this.sender.name
            ? { email: this.sender.email, name: this.sender.name }
            : { email: this.sender.email },
          to: [{ email }],
          subject,
          textContent: message,
        }),
      });
    } catch (error) {
      logger.error({ err: error }, "Brevo: сетевая ошибка при отправке письма");
      throw new Error("Не удалось отправить письмо с кодом. Попробуйте позже.");
    }

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      logger.error({ status: response.status, body: body.slice(0, 500) }, "Brevo: API вернул ошибку");
      throw new Error("Не удалось отправить письмо с кодом. Попробуйте позже.");
    }
  }
}

/**
 * Отправка через HTTP API Resend (https://resend.com/docs/api-reference/emails/send-email).
 *
 * Оставлено на будущее: если появится подтверждённый домен, Resend может
 * стать предпочтительнее. Без домена он шлёт письма только владельцу
 * аккаунта, поэтому приоритет ниже Brevo.
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
    logger.info({ to: email, subject, message }, "[DEV EMAIL] код не отправлен реально (Brevo/Resend/SMTP не настроены)");
  }
}

if (
  process.env.NODE_ENV === "production" &&
  !brevoIsConfigured() &&
  !resendIsConfigured() &&
  !smtpIsConfigured()
) {
  throw new Error(
    "Email is not configured. Set BREVO_API_KEY (recommended) or RESEND_API_KEY " +
      "or the SMTP_* variables, plus EMAIL_FROM, in server/.env"
  );
}

/**
 * Приоритет выбора: Brevo > Resend > SMTP > dev-заглушка.
 * - BREVO_API_KEY задан   → BrevoEmailService (прод — работает без домена)
 * - иначе RESEND_API_KEY  → ResendEmailService (на будущее, нужен домен)
 * - иначе SMTP настроен   → SmtpEmailService (локальная разработка)
 * - иначе                 → DevStubEmailService (без настроек — только лог)
 */
export const emailService: EmailService = brevoIsConfigured()
  ? new BrevoEmailService()
  : resendIsConfigured()
    ? new ResendEmailService()
    : smtpIsConfigured()
      ? new SmtpEmailService()
      : new DevStubEmailService();
