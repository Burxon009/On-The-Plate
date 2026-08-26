import { Response, NextFunction } from "express";
import { AuthRequest } from "./authMiddleware";

export function adminMiddleware(
  req: AuthRequest,
  res: Response,
  next: NextFunction
) {
  if (!req.user) {
    return res.status(401).json({
      message: "Требуется авторизация",
    });
  }

  if (req.user.role !== "admin") {
    return res.status(403).json({
      message: "Доступ только для администратора",
    });
  }

  next();
}