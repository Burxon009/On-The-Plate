import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
} from "@simplewebauthn/typescript-types";
import { pool } from "./db";

/**
 * Биометрическая разблокировка (Face ID / отпечаток) через WebAuthn.
 *
 * Как и PIN — это НЕ вход, а "замок" поверх активной сессии. Все вызовы
 * идут под authMiddleware: userId мы уже знаем из сессии, поэтому
 * credentials не-resident (без passkey-хранилища на устройстве),
 * authenticatorAttachment = platform (встроенная биометрия телефона).
 *
 * Крипто целиком на @simplewebauthn — вручную ничего не считаем.
 */

const RP_ID = process.env.WEBAUTHN_RP_ID ?? "localhost";
const RP_NAME = process.env.WEBAUTHN_RP_NAME ?? "On the plate";
// Разрешённые origin'ы (может быть несколько через запятую — dev + prod).
const RP_ORIGINS = (process.env.WEBAUTHN_RP_ORIGIN ?? "http://localhost:4200")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export class WebAuthnError extends Error {}

type Purpose = "register" | "authenticate";

interface CredentialRow {
  id: number;
  credential_id: string; // base64url
  public_key: string; // base64url
  counter: string; // BIGINT → строка из pg
  transports: string[] | null;
}

function b64urlToBytes(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}

function bytesToB64url(value: Uint8Array): string {
  return Buffer.from(value).toString("base64url");
}

async function saveChallenge(
  userId: number,
  challenge: string,
  purpose: Purpose
): Promise<void> {
  await pool.query(
    `INSERT INTO webauthn_challenges (user_id, challenge, purpose, expires_at)
     VALUES ($1, $2, $3, NOW() + make_interval(secs => $4))
     ON CONFLICT (user_id) DO UPDATE
       SET challenge = EXCLUDED.challenge,
           purpose = EXCLUDED.purpose,
           expires_at = EXCLUDED.expires_at`,
    [userId, challenge, purpose, CHALLENGE_TTL_MS / 1000]
  );
}

async function takeChallenge(userId: number, purpose: Purpose): Promise<string> {
  const res = await pool.query(
    `DELETE FROM webauthn_challenges
      WHERE user_id = $1 AND purpose = $2 AND expires_at > NOW()
      RETURNING challenge`,
    [userId, purpose]
  );
  const challenge = res.rows[0]?.challenge as string | undefined;
  if (!challenge) {
    throw new WebAuthnError("Сессия подтверждения истекла. Попробуйте ещё раз.");
  }
  return challenge;
}

async function loadCredentials(userId: number): Promise<CredentialRow[]> {
  const res = await pool.query(
    `SELECT id, credential_id, public_key, counter, transports
       FROM webauthn_credentials
      WHERE user_id = $1
      ORDER BY id`,
    [userId]
  );
  return res.rows;
}

export async function hasCredentials(userId: number): Promise<boolean> {
  const res = await pool.query(
    "SELECT 1 FROM webauthn_credentials WHERE user_id = $1 LIMIT 1",
    [userId]
  );
  return res.rows.length > 0;
}

export async function listCredentials(
  userId: number
): Promise<{ id: number; createdAt: string; lastUsedAt: string | null }[]> {
  const res = await pool.query(
    `SELECT id, created_at, last_used_at
       FROM webauthn_credentials
      WHERE user_id = $1
      ORDER BY id`,
    [userId]
  );
  return res.rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    lastUsedAt: r.last_used_at,
  }));
}

export async function deleteAllCredentials(userId: number): Promise<void> {
  await pool.query("DELETE FROM webauthn_credentials WHERE user_id = $1", [userId]);
  await pool.query("DELETE FROM webauthn_challenges WHERE user_id = $1", [userId]);
}

/* ── Регистрация нового устройства ──────────────────────────────────── */

export async function getRegistrationOptions(userId: number) {
  const userRes = await pool.query(
    "SELECT email, phone, name FROM users WHERE id = $1",
    [userId]
  );
  const user = userRes.rows[0];
  if (!user) throw new WebAuthnError("Пользователь не найден");

  const existing = await loadCredentials(userId);

  const options = await generateRegistrationOptions({
    rpName: RP_NAME,
    rpID: RP_ID,
    userID: String(userId),
    userName: user.email || user.phone || `user-${userId}`,
    userDisplayName: user.name || user.email || user.phone || `user-${userId}`,
    attestationType: "none",
    excludeCredentials: existing.map((c) => ({
      id: b64urlToBytes(c.credential_id),
      type: "public-key",
      transports: (c.transports ?? undefined) as
        | AuthenticatorTransportFuture[]
        | undefined,
    })),
    authenticatorSelection: {
      authenticatorAttachment: "platform",
      residentKey: "discouraged",
      requireResidentKey: false,
      userVerification: "required",
    },
  });

  await saveChallenge(userId, options.challenge, "register");
  return options;
}

export async function verifyRegistration(
  userId: number,
  response: RegistrationResponseJSON
): Promise<void> {
  if (!response || typeof response !== "object") {
    throw new WebAuthnError("Нет ответа браузера");
  }

  const expectedChallenge = await takeChallenge(userId, "register");

  let verification;
  try {
    verification = await verifyRegistrationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
    });
  } catch {
    throw new WebAuthnError("Не удалось подтвердить биометрию");
  }

  if (!verification.verified || !verification.registrationInfo) {
    throw new WebAuthnError("Биометрия не подтверждена");
  }

  const { credentialID, credentialPublicKey, counter } =
    verification.registrationInfo;

  await pool.query(
    `INSERT INTO webauthn_credentials (user_id, credential_id, public_key, counter, transports)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (credential_id) DO NOTHING`,
    [
      userId,
      bytesToB64url(credentialID),
      bytesToB64url(credentialPublicKey),
      counter,
      response.response?.transports ?? null,
    ]
  );
}

/* ── Разблокировка биометрией ──────────────────────────────────────── */

export async function getAuthenticationOptions(userId: number) {
  const creds = await loadCredentials(userId);
  if (creds.length === 0) {
    throw new WebAuthnError("Биометрия не настроена");
  }

  const options = await generateAuthenticationOptions({
    rpID: RP_ID,
    allowCredentials: creds.map((c) => ({
      id: b64urlToBytes(c.credential_id),
      type: "public-key",
      transports: (c.transports ?? undefined) as
        | AuthenticatorTransportFuture[]
        | undefined,
    })),
    userVerification: "required",
  });

  await saveChallenge(userId, options.challenge, "authenticate");
  return options;
}

export async function verifyAuthentication(
  userId: number,
  response: AuthenticationResponseJSON
): Promise<void> {
  if (!response || typeof response !== "object" || typeof response.id !== "string") {
    throw new WebAuthnError("Нет ответа браузера");
  }

  const expectedChallenge = await takeChallenge(userId, "authenticate");

  const creds = await loadCredentials(userId);
  const cred = creds.find((c) => c.credential_id === response.id);
  if (!cred) {
    throw new WebAuthnError("Неизвестное устройство");
  }

  let verification;
  try {
    verification = await verifyAuthenticationResponse({
      response,
      expectedChallenge,
      expectedOrigin: RP_ORIGINS,
      expectedRPID: RP_ID,
      requireUserVerification: true,
      authenticator: {
        credentialID: b64urlToBytes(cred.credential_id),
        credentialPublicKey: b64urlToBytes(cred.public_key),
        counter: Number(cred.counter),
        transports: (cred.transports ?? undefined) as
          | AuthenticatorTransportFuture[]
          | undefined,
      },
    });
  } catch {
    throw new WebAuthnError("Не удалось проверить биометрию");
  }

  if (!verification.verified) {
    throw new WebAuthnError("Биометрия не подтверждена");
  }

  await pool.query(
    `UPDATE webauthn_credentials
        SET counter = $2, last_used_at = NOW()
      WHERE id = $1`,
    [cred.id, verification.authenticationInfo.newCounter]
  );
}
