import pino from "pino";
import { env } from "./env.js";

const isProd = env.NODE_ENV === "production";
const isTest = env.NODE_ENV === "test";

const level =
  process.env.LOG_LEVEL ?? (isTest ? "silent" : isProd ? "info" : "debug");

const options: pino.LoggerOptions = {
  name: env.APP_NAME,
  level,
  base: {
    app: env.APP_NAME,
    env: env.NODE_ENV,
  },
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      "res.headers['set-cookie']",
      "authorization",
      "cookie",
      "password",
      "accessToken",
      "refreshToken",
    ],
    censor: "[Redacted]",
  },
};

if (!isProd && !isTest) {
  options.transport = {
    target: "pino-pretty",
    options: {
      colorize: true,
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
    },
  };
}

export const logger = pino(options);
