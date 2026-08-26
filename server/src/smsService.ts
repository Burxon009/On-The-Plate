/**
 * Абстракция отправки SMS.
 *
 * Сейчас — DEV-заглушка (код возвращается вызывающему коду,
 * а не реально отправляется). Когда подключим провайдера
 * (Eskiz, Twilio и т.п.), меняем только тело sendSms —
 * весь остальной код (authRoutes, verifyCode) трогать не нужно.
 */

export interface SmsService {
  sendSms(phone: string, message: string): Promise<void>;
}

class DevStubSmsService implements SmsService {
  async sendSms(phone: string, message: string): Promise<void> {
    // В деве просто логируем — реальная отправка не выполняется.
    console.log(`📱 [DEV SMS] → ${phone}: ${message}`);
  }
}

/**
 * Пример того, как будет выглядеть реальный провайдер (Eskiz.uz).
 * Раскомментировать и подключить, когда будут учётные данные.
 *
 * class EskizSmsService implements SmsService {
 *   async sendSms(phone: string, message: string): Promise<void> {
 *     const token = process.env.ESKIZ_TOKEN;
 *     await fetch("https://notify.eskiz.uz/api/message/sms/send", {
 *       method: "POST",
 *       headers: {
 *         Authorization: `Bearer ${token}`,
 *         "Content-Type": "application/json",
 *       },
 *       body: JSON.stringify({
 *         mobile_phone: phone.replace("+", ""),
 *         message,
 *         from: "4546",
 *       }),
 *     });
 *   }
 * }
 */

export const smsService: SmsService = new DevStubSmsService();
