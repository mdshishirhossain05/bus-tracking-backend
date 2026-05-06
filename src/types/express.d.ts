import type { UserRole } from "../generated/prisma/index.js";
import type { Logger } from "pino";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        role: UserRole;
        sessionId: string;
      };

      user?: {
        id: string;
        role: string;
        sessionId?: string;
      };

      requestId?: string;
      log?: Logger;
    }
  }
}

export {};
