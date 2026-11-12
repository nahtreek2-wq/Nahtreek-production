import { Injectable, Logger } from "@nestjs/common";
import nodemailer from "nodemailer";

@Injectable()
export class EmailOtpService {
  private readonly logger = new Logger("EmailOtpService");

  isEnabled(): boolean {
    return (
      process.env.APP_ENV === "preview" &&
      process.env.PREVIEW_EMAIL_OTP_ENABLED === "true" &&
      Boolean(process.env.GMAIL_SMTP_USER?.trim()) &&
      Boolean(process.env.GMAIL_SMTP_APP_PASSWORD?.trim())
    );
  }

  async sendOtp(email: string, code: string): Promise<boolean> {
    if (!this.isEnabled()) {
      this.logger.error("Preview Gmail OTP is not configured.");
      return false;
    }
    const user = process.env.GMAIL_SMTP_USER!.trim();
    try {
      const transporter = nodemailer.createTransport({
        service: "gmail",
        auth: {
          user,
          pass: process.env.GMAIL_SMTP_APP_PASSWORD!.replace(/\s/g, ""),
        },
      });
      await transporter.sendMail({
        from: `"${
          process.env.GMAIL_FROM_NAME?.trim() || "NAHTREEK"
        }" <${user}>`,
        to: email,
        subject: "Your NAHTREEK verification code",
        text: `Your NAHTREEK verification code is ${code}. It expires in 5 minutes. Do not share this code.`,
        html: `<div style="font-family:Arial,sans-serif;color:#172033"><h2 style="color:#111F35">NAHTREEK verification</h2><p>Enter this code to continue:</p><p style="font-size:28px;font-weight:700;letter-spacing:6px;color:#111F35">${code}</p><p>This code expires in 5 minutes. Do not share it with anyone.</p></div>`,
      });
      return true;
    } catch {
      this.logger.error("Gmail rejected the Preview OTP request.");
      return false;
    }
  }
}
