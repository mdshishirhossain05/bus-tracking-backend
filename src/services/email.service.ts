import nodemailer from "nodemailer";
import { env } from "../config/env.js";
import { AppError } from "../utils/appError.js";

function isSmtpConfigured() {
  return Boolean(
    env.SMTP_HOST?.trim() &&
    env.SMTP_USER?.trim() &&
    env.SMTP_PASS?.trim() &&
    env.SMTP_FROM?.trim(),
  );
}

function createTransporter() {
  if (!isSmtpConfigured()) {
    if (env.NODE_ENV === "production") {
      throw new AppError({
        statusCode: 500,
        code: "SMTP_NOT_CONFIGURED",
        message: "Email verification service is not configured.",
      });
    }

    return null;
  }

  return nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: {
      user: env.SMTP_USER,
      pass: env.SMTP_PASS,
    },
  });
}

export async function sendPassengerRegistrationOtpEmail(params: {
  to: string;
  otp: string;
  expiresInMinutes: number;
}) {
  const transporter = createTransporter();

  if (!transporter) {
    console.info(
      `[DEV ONLY] Passenger registration OTP for ${params.to}: ${params.otp}`,
    );
    return;
  }

  await transporter.sendMail({
    from: env.SMTP_FROM,
    to: params.to,
    subject: "Your passenger registration verification code",
    text: [
      "Your passenger registration verification code is:",
      "",
      params.otp,
      "",
      `This code will expire in ${params.expiresInMinutes} minutes.`,
      "",
      "If you did not request this code, you can safely ignore this email.",
    ].join("\n"),
    html: `
      <div style="font-family:Arial,sans-serif;line-height:1.6;color:#0f172a">
        <h2>Passenger registration verification</h2>
        <p>Your verification code is:</p>
        <div style="font-size:28px;font-weight:700;letter-spacing:6px;background:#f1f5f9;border-radius:12px;padding:14px 18px;display:inline-block">
          ${params.otp}
        </div>
        <p>This code will expire in <strong>${params.expiresInMinutes} minutes</strong>.</p>
        <p style="color:#64748b">If you did not request this code, you can safely ignore this email.</p>
      </div>
    `,
  });
}
