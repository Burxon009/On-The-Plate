import { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";

const JWT_SECRET: string = process.env.JWT_SECRET ?? "";

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET не задан в .env");
}

export interface AuthRequest extends Request {
  user?: {
    userId: number;
    role: string;
  };
}

export function authMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  const authHeader = req.headers.authorization;

  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({
      message: "Требуется авторизация",
    });
  }

  const token = authHeader.slice(7);

  try {
    const decoded = jwt.verify(token, JWT_SECRET, {
      issuer: "ucafe-loyalty",
      audience: "ucafe-api",
    });

    if (typeof decoded === "string") {
      return res.status(401).json({
        message: "Некорректный токен",
      });
    }

    if (
      typeof decoded.userId !== "number" ||
      typeof decoded.role !== "string" ||
      decoded.typ !== "access"
    ) {
      return res.status(401).json({
        message: "Некорректные данные токена",
      });
    }

    req.user = {
      userId: decoded.userId,
      role: decoded.role,
    };

    next();
  } catch {
    return res.status(401).json({
      message: "Недействительный или просроченный токен",
    });
  }
}
