import crypto from "crypto";
import jwt from "jsonwebtoken";
import { PoolClient } from "pg";

const jwtSecret = process.env.JWT_SECRET ?? "";
const refreshPepper = process.env.REFRESH_TOKEN_PEPPER ?? jwtSecret;
const issuer = "ucafe-loyalty";
const audience = "ucafe-api";
const accessTtlMinutes = Number(process.env.JWT_ACCESS_TTL_MINUTES ?? 15);
const refreshTtlDays = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 30);

if (!jwtSecret || !refreshPepper || !Number.isInteger(refreshTtlDays) || refreshTtlDays < 1 || !Number.isInteger(accessTtlMinutes) || accessTtlMinutes < 1) {
  throw new Error("JWT and refresh-session configuration is invalid");
}

export type SessionUser = { id: number; role: string };

export function createAccessToken(user: SessionUser): string {
  return jwt.sign({ userId: user.id, role: user.role, typ: "access" }, jwtSecret, {
    expiresIn: accessTtlMinutes * 60,
    issuer,
    audience,
  });
}

function hashRefreshToken(token: string): string {
  return crypto.createHmac("sha256", refreshPepper).update(token).digest("hex");
}

function newRefreshToken(): { sessionId: string; token: string; hash: string; expiresAt: Date } {
  const sessionId = crypto.randomUUID();
  const secret = crypto.randomBytes(48).toString("base64url");
  const token = `${sessionId}.${secret}`;
  return {
    sessionId,
    token,
    hash: hashRefreshToken(token),
    expiresAt: new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000),
  };
}

export async function createRefreshSession(
  client: PoolClient,
  userId: number,
  request: { ip?: string; userAgent?: string }
): Promise<string> {
  const refresh = newRefreshToken();
  await client.query(
    `INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [refresh.sessionId, userId, refresh.hash, refresh.expiresAt, request.userAgent?.slice(0, 512) ?? null, request.ip ?? null]
  );
  return refresh.token;
}

export async function rotateRefreshSession(
  client: PoolClient,
  token: string,
  request: { ip?: string; userAgent?: string }
): Promise<{ user: SessionUser; refreshToken: string } | null> {
  const tokenHash = hashRefreshToken(token);
  const result = await client.query(
    `SELECT rs.id, rs.user_id, rs.expires_at, rs.revoked_at, rs.replaced_by, u.role
     FROM refresh_sessions rs JOIN users u ON u.id = rs.user_id
     WHERE rs.token_hash = $1 FOR UPDATE`,
    [tokenHash]
  );
  const session = result.rows[0];
  if (!session) return null;

  if (session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
    // A previously rotated token being presented is a reuse signal: revoke all sessions.
    if (session.replaced_by) {
      await client.query("UPDATE refresh_sessions SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL", [session.user_id]);
    }
    return null;
  }

  const refresh = newRefreshToken();
  await client.query(
    `INSERT INTO refresh_sessions (id, user_id, token_hash, expires_at, user_agent, ip_address)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [refresh.sessionId, session.user_id, refresh.hash, refresh.expiresAt, request.userAgent?.slice(0, 512) ?? null, request.ip ?? null]
  );
  await client.query(
    "UPDATE refresh_sessions SET revoked_at = NOW(), replaced_by = $2, last_used_at = NOW() WHERE id = $1",
    [session.id, refresh.sessionId]
  );
  return { user: { id: session.user_id, role: session.role }, refreshToken: refresh.token };
}

export async function revokeRefreshSession(client: PoolClient, token: string): Promise<void> {
  await client.query("UPDATE refresh_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL", [hashRefreshToken(token)]);
}
