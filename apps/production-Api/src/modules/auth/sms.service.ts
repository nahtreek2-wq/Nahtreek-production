import { Injectable, Logger } from "@nestjs/common";

type SmsProvider = "fast2sms" | "msg91";

@Injectable()
export class SmsService {
  private readonly logger = new Logger("SmsService");

  // Autofill contract: both apps mark their code fields with Android
  // sms-otp / iOS oneTimeCode, so an arriving SMS fills the code with no
  // typing. Keep the provider templates OTP-first ("<#> 123456 …") and, for
  // silent Android autofill via the SMS Retriever API, append each app's
  // 11-character hash to its template when the production sender is set up.
  async sendOtp(phoneNumber: string, code: string): Promise<boolean> {
    const provider = this.provider();
    try {
      return provider === "msg91"
        ? await this.sendWithMsg91(phoneNumber, code)
        : await this.sendWithFast2Sms(phoneNumber, code);
    } catch {
      this.logger.error("SMS provider request failed.");
      return false;
    }
  }

  private provider(): SmsProvider {
    const configured = process.env.SMS_PROVIDER?.trim().toLowerCase();
    if (configured === "msg91" || configured === "fast2sms") return configured;
    return process.env.MSG91_AUTH_KEY ? "msg91" : "fast2sms";
  }

  // True only when the resolved provider has credentials. The preview demo
  // fallback keys off this so a transient SMS outage never leaks codes.
  isConfigured(): boolean {
    if (this.provider() === "msg91") {
      return Boolean(process.env.MSG91_AUTH_KEY?.trim()) && Boolean(process.env.MSG91_TEMPLATE_ID?.trim());
    }
    return Boolean(process.env.SMS_API_KEY?.trim());
  }

  private async sendWithMsg91(
    phoneNumber: string,
    code: string
  ): Promise<boolean> {
    const authKey = process.env.MSG91_AUTH_KEY?.trim();
    const templateId = process.env.MSG91_TEMPLATE_ID?.trim();
    if (!authKey || !templateId) {
      this.logger.error("MSG91 OTP is not configured.");
      return false;
    }
    const url = new URL("https://control.msg91.com/api/v5/otp");
    url.searchParams.set("template_id", templateId);
    url.searchParams.set("mobile", phoneNumber.replace("+", ""));
    url.searchParams.set("otp", code);
    const response = await fetch(url, {
      method: "POST",
      headers: { authkey: authKey, "content-type": "application/json" },
    });
    const body = (await response.json()) as { type?: string; message?: string };
    if (!response.ok || body.type !== "success") {
      this.logger.error("MSG91 rejected the OTP request.");
      return false;
    }
    return true;
  }

  private async sendWithFast2Sms(
    phoneNumber: string,
    code: string
  ): Promise<boolean> {
    const apiKey = process.env.SMS_API_KEY?.trim();
    if (!apiKey) {
      this.logger.error("Fast2SMS is not configured.");
      return false;
    }
    const url = new URL("https://www.fast2sms.com/dev/bulkV2");
    url.searchParams.set("authorization", apiKey);
    url.searchParams.set("route", "otp");
    url.searchParams.set("variables_values", code);
    url.searchParams.set("numbers", phoneNumber.replace("+", ""));
    const response = await fetch(url);
    const body = (await response.json()) as { return?: boolean };
    if (!response.ok || body.return === false) {
      this.logger.error("Fast2SMS rejected the OTP request.");
      return false;
    }
    return true;
  }
}
