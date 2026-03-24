import express from "express";
import { registerRoutes } from "./routes/index";

export const app = express();
registerRoutes(app);
app.listen(3000);
