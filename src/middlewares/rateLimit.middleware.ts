import rateLimit from "express-rate-limit";

function ms(v: string, fallbackMs: number): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : fallbackMs;
}

export const loginLimiter = rateLimit({
  windowMs: ms(process.env.RL_LOGIN_WINDOW_MS ?? "", 10 * 60 * 1000),
  max: ms(process.env.RL_LOGIN_MAX ?? "", 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many login attempts. Try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

export const refreshLimiter = rateLimit({
  windowMs: ms(process.env.RL_REFRESH_WINDOW_MS ?? "", 5 * 60 * 1000),
  max: ms(process.env.RL_REFRESH_MAX ?? "", 120),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many refresh attempts. Try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});

export const forgotPasswordLimiter = rateLimit({
  windowMs: ms(process.env.RL_FORGOT_PASSWORD_WINDOW_MS ?? "", 10 * 60 * 1000),
  max: ms(process.env.RL_FORGOT_PASSWORD_MAX ?? "", 10),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many password reset requests. Try again later.",
    code: "RATE_LIMIT_EXCEEDED",
  },
});
