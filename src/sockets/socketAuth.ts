import type { Socket } from "socket.io";
import { verifyAccessToken } from "../utils/jwt.js";

type SocketAuthData = {
  userId: string;
  role: string;
  sessionId: string;
};

function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};

  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const eqIndex = part.indexOf("=");
        if (eqIndex === -1) return [part, ""];
        const key = part.slice(0, eqIndex).trim();
        const value = decodeURIComponent(part.slice(eqIndex + 1).trim());
        return [key, value];
      }),
  );
}

export function authenticateSocket(socket: Socket) {
  const cookieHeader = socket.handshake.headers.cookie;
  const cookies = parseCookies(cookieHeader);

  const cookieToken = cookies.access_token;
  const authToken =
    typeof socket.handshake.auth?.token === "string"
      ? socket.handshake.auth.token.trim()
      : null;

  const bearerHeader =
    typeof socket.handshake.headers.authorization === "string"
      ? socket.handshake.headers.authorization
      : null;

  const bearerToken =
    bearerHeader && bearerHeader.startsWith("Bearer ")
      ? bearerHeader.slice(7).trim()
      : null;

  const token = cookieToken || authToken || bearerToken;

  if (!token) {
    throw new Error("NO_AUTH_TOKEN");
  }

  const payload = verifyAccessToken(token);

  if (payload.type !== "access") {
    throw new Error("INVALID_TOKEN_TYPE");
  }

  const auth: SocketAuthData = {
    userId: payload.userId,
    role: payload.role,
    sessionId: payload.sessionId,
  };

  socket.data.auth = auth;
}
