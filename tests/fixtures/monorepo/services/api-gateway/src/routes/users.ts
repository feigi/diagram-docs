import { Router } from "express";
import { z } from "zod";
import { authenticate } from "../middleware/auth";

const UserSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

export const usersRouter = Router();

usersRouter.get("/", authenticate, (_req, res) => {
  res.json([]);
});

export type User = z.infer<typeof UserSchema>;
