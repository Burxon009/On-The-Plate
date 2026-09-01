import { logger } from "./logger";

/**
 * Тонкий HTTP-клиент к Telegram Gateway API (https://core.telegram.org/gateway/api).
 *
 * Отличие от emailService: Telegram Gateway сам ГЕНЕРИРУЕТ код и сам его
 * ПРОВЕРЯЕТ. Мы не видим код и не храним его хеш — только `request_id`,
 * по которому потом вызываем checkVerificationStatus с введённым кодом.
 */

const gatewayToken = process.env.TELEGRAM_GATEWAY_TOKEN;
const GATEWAY_BASE = "https://gatewayapi.telegram.org";

export function telegramGatewayIsConfigured(): boolean {
  return Boolean(gatewayToken);
}

/** Ошибка на стороне Telegram Gateway (плохой токен, недоставка, сеть и т.п.). */
export class TelegramGatewayError extends Error {}

export interface DeliveryStatus {
  status: "sent" | "delivered" | "read" | "expired" | "revoked";
  updated_at: number;
}

export interface VerificationStatus {
  status:
    | "code_valid"
    | "code_invalid"
    | "code_max_attempts_exceeded"
    | "expired";
  updated_at: number;
  code_entered?: string;
}

export interface RequestStatus {
  request_id: string;
  phone_number: string;
  request_cost: number;
  is_refunded?: boolean;
  remaining_balance?: number;
  delivery_status?: DeliveryStatus;
  verification_status?: VerificationStatus;
  payload?: string;
}

async function call<T>(
  method: string,
  body: Record<string, unknown>
): Promise<T> {
  if (!gatewayToken) {
    throw new TelegramGatewayError("TELEGRAM_GATEWAY_TOKEN не задан");
  }

  let response: Response;
  try {
    response = await fetch(`${GATEWAY_BASE}/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${gatewayToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
  } catch (error) {
    logger.error({ err: error, method }, "Telegram Gateway: сетевая ошибка");
    throw new TelegramGatewayError("Не удалось связаться с Telegram Gateway");
  }

  let json: { ok?: boolean; result?: T; error?: string };
  try {
    json = (await response.json()) as typeof json;
  } catch {
    throw new TelegramGatewayError(
      `Telegram Gateway вернул не-JSON (HTTP ${response.status})`
    );
  }

  if (!json.ok || json.result === undefined) {
    logger.warn(
      { method, status: response.status, error: json.error },
      "Telegram Gateway: ответ с ошибкой"
    );
    throw new TelegramGatewayError(
      json.error || `Telegram Gateway ошибка (HTTP ${response.status})`
    );
  }

  return json.result;
}

/**
 * Отправить сообщение с кодом подтверждения. Telegram сам генерирует
 * 6-значный код (`code_length: 6`) и хранит его у себя.
 *
 * @param phoneNumber номер в формате E.164, например +998901234567
 * @returns RequestStatus (нужен `request_id` для последующей проверки)
 */
export async function sendVerificationMessage(
  phoneNumber: string,
  options: { ttlSeconds?: number } = {}
): Promise<RequestStatus> {
  return call<RequestStatus>("sendVerificationMessage", {
    phone_number: phoneNumber,
    code_length: 6,
    ttl: options.ttlSeconds ?? 300,
  });
}

/**
 * Проверить код, введённый пользователем. Проверку выполняет Telegram —
 * мы передаём `request_id` (из sendVerificationMessage) и введённый код,
 * получаем `verification_status.status`:
 *   code_valid | code_invalid | code_max_attempts_exceeded | expired
 */
export async function checkVerificationStatus(
  requestId: string,
  code: string
): Promise<RequestStatus> {
  return call<RequestStatus>("checkVerificationStatus", {
    request_id: requestId,
    code,
  });
}

/**
 * Проверить возможность доставки на номер (не тратит деньги; для своего
 * номера возвращает бесплатный `request_id`). Пока не используется в
 * основном потоке — оставлено на случай оптимизации стоимости.
 */
export async function checkSendAbility(
  phoneNumber: string
): Promise<RequestStatus> {
  return call<RequestStatus>("checkSendAbility", { phone_number: phoneNumber });
}
