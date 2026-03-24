import type { Express } from "express";
import { usersRouter } from "./users";

export function registerRoutes(app: Express): void {
  app.use("/users", usersRouter);
}
