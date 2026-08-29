/**
 * Абстракция отправки Email.
 *
 * Сейчас — DEV-заглушка (код возвращается вызывающему коду,
 * а не реально отправляется). Когда подключим провайдера
 * (SendGrid, Resend, Amazon SES и т.п.), меняем только тело
 * sendEmail — весь остальной код (authRoutes, verificationService)
 * трогать не нужно.
 */

export interface EmailService {
  sendEmail(email: string, subject: string, message: string): Promise<void>;
}

class DevStubEmailService implements EmailService {
  async sendEmail(
    email: string,
    subject: string,
    message: string
  ): Promise<void> {
    // В деве просто логируем — реальная отправка не выполняется.
    console.log(`📧 [DEV EMAIL] → ${email} | ${subject}: ${message}`);
  }
}

/**
 * Пример того, как будет выглядеть реальный провайдер (Resend).
 * Раскомментировать и подключить, когда будут учётные данные.
 *
 * class ResendEmailService implements EmailService {
 *   async sendEmail(email: string, subject: string, message: string): Promise<void> {
 *     const apiKey = process.env.RESEND_API_KEY;
 *     await fetch("https://api.resend.com/emails", {
 *       method: "POST",
 *       headers: {
 *         Authorization: `Bearer ${apiKey}`,
 *         "Content-Type": "application/json",
 *       },
 *       body: JSON.stringify({
 *         from: "On the plate <noreply@yourdomain.com>",
 *         to: email,
 *         subject,
 *         text: message,
 *       }),
 *     });
 *   }
 * }
 */

export const emailService: EmailService = new DevStubEmailService();
