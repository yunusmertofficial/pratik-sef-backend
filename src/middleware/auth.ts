import jwt from "jsonwebtoken"
import { Request, Response, NextFunction } from "express"

export type AuthUser = { id: string; email: string; name?: string; avatar?: string }

export const signSession = (user: AuthUser) => {
  const secret = process.env.JWT_SECRET || "dev_secret"
  return jwt.sign({ sub: user.id, email: user.email, name: user.name, avatar: user.avatar }, secret, { expiresIn: "7d" })
}

export const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const header = req.headers.authorization
  if (!header) return res.status(401).json({ error: "Unauthorized" })
  const token = header.replace("Bearer ", "")
  const secret = process.env.JWT_SECRET || "dev_secret"
  try {
    const payload = jwt.verify(token, secret) as any
    ;(req as any).user = { id: payload.sub, email: payload.email, name: payload.name, avatar: payload.avatar }
    next()
  } catch {
    res.status(401).json({ error: "Invalid token" })
  }
}