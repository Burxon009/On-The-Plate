import nodemailer from "nodemailer";

export interface EmailService {
  sendEmail(email: string, subject: string, message: string): Promise<void>;
}

const smtpHost = process.env.SMTP_HOST;
const smtpPort = Number(process.env.SMTP_PORT ?? 465);
const smtpUser = process.env.SMTP_USER;
const smtpPass = process.env.SMTP_PASS;
const emailFrom = process.env.EMAIL_FROM ?? smtpUser;

function smtpIsConfigured(): boolean {
  return Boolean(smtpHost && smtpUser && smtpPass && emailFrom);
}

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
      console.error("Email delivery failed:", error);
      throw new Error("Не удалось отправить письмо с кодом. Попробуйте позже.");
    }
  }
}

class DevStubEmailService implements EmailService {
  async sendEmail(email: string, subject: string, message: string): Promise<void> {
    console.log(`📧 [DEV EMAIL] → ${email} | ${subject}: ${message}`);
  }
}

if (process.env.NODE_ENV === "production" && !smtpIsConfigured()) {
  throw new Error(
    "SMTP is not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS and EMAIL_FROM in server/.env"
  );
}

export const emailService: EmailService = smtpIsConfigured()
  ? new SmtpEmailService()
  : new DevStubEmailService();
