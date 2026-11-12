import { byId, setBusy } from "./dom.js";

const TOKEN_KEY = "nahtreekAdminToken";
const REFRESH_KEY = "nahtreekAdminRefreshToken";
// Inactive admin tabs sign out automatically: money and PII views must not
// sit open unattended. A warning precedes the logout by two minutes.
export const IDLE_TIMEOUT_MS = 15 * 60_000;
export const IDLE_WARN_MS = 13 * 60_000;
const IDLE_EVENTS = ["pointerdown", "keydown", "submit"];
const MAX_LOGIN_COOLDOWN_MS = 10_000;

export function loginCooldownMs(failedAttempts) {
  return Math.min(Math.max(failedAttempts, 1) * 2000, MAX_LOGIN_COOLDOWN_MS);
}

export class AuthController {
  constructor(api, callbacks) {
    this.api = api;
    this.callbacks = callbacks;
    this.failedAttempts = 0;
    this.idleTimer = 0;
    this.warnTimer = 0;
    this.onIdle = null;
    this.onIdleWarning = null;
    this.handleActivity = () => this.resetIdleTimers();
    this.api.onUnauthorized = () => this.logout();
    // Refresh rotates the pair, so every silent refresh must persist the new
    // tokens — otherwise a reload reuses a revoked refresh token and logs out.
    this.api.onTokensRefreshed = (accessToken, refreshToken) => {
      sessionStorage.setItem(TOKEN_KEY, accessToken);
      sessionStorage.setItem(REFRESH_KEY, refreshToken);
    };
    this.codeStep = false;
    this.identifier = "";
    this.byEmail = true;
    this.resendAt = 0;
  }

  // OTP-only sign-in. Preview verifies the admin email address; production
  // verifies the admin mobile number. No passwords exist anywhere.
  bindLogin() {
    this.byEmail =
      (window.NAHTREEK_ADMIN_CONFIG || {}).environment !== "production";
    byId("login-identifier-label").textContent = this.byEmail
      ? "Email address"
      : "Mobile number";
    byId("login-identifier").setAttribute(
      "inputmode",
      this.byEmail ? "email" : "tel"
    );
    byId("login-form").addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.codeStep) void this.verifyCode();
      else void this.sendCode();
    });
    byId("login-resend").addEventListener("click", () => void this.sendCode());
    byId("login-back").addEventListener("click", () => this.showIdentifierStep());
    byId("login-code").addEventListener("input", (event) => {
      const clean = event.target.value.replace(/\D/g, "").slice(0, 6);
      if (clean !== event.target.value) event.target.value = clean;
    });
  }

  showIdentifierStep() {
    this.codeStep = false;
    this.identifier = "";
    byId("login-code").value = "";
    byId("login-error").textContent = "";
    byId("login-code-error").textContent = "";
    byId("login-code-step").classList.add("hidden");
    byId("login-identifier-step").classList.remove("hidden");
    byId("login-identifier").focus();
  }

  showCodeStep() {
    this.codeStep = true;
    byId("login-error").textContent = "";
    byId("login-code-error").textContent = "";
    byId("login-code-hint").textContent = `Enter the 6-digit code sent to ${
      this.byEmail ? this.identifier : `mobile ending ${this.identifier.slice(-4)}`
    }.`;
    byId("login-identifier-step").classList.add("hidden");
    byId("login-code-step").classList.remove("hidden");
    byId("login-code").focus();
  }

  readIdentifier() {
    const raw = byId("login-identifier").value.trim();
    if (this.byEmail) {
      if (
        raw.length > 254 ||
        raw.includes("..") ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)
      )
        throw new Error("Enter a valid email address.");
      return raw.toLowerCase();
    }
    if (raw.replace(/\D/g, "").length < 10)
      throw new Error("Enter a valid mobile number.");
    return raw;
  }

  async sendCode() {
    const button = byId("login-send-code");
    if (Date.now() < this.resendAt) {
      byId(this.codeStep ? "login-code-error" : "login-error").textContent =
        "Please wait 30 seconds before sending another code.";
      return;
    }
    setBusy(button, true, "Sending…");
    try {
      if (!this.codeStep) this.identifier = this.readIdentifier();
      await this.api.request(
        this.byEmail ? "/auth/email-otp/request" : "/auth/otp/request",
        {
          method: "POST",
          body: JSON.stringify(
            this.byEmail
              ? { email: this.identifier }
              : { phoneNumber: this.identifier }
          ),
        }
      );
      this.resendAt = Date.now() + 30_000;
      this.failedAttempts = 0;
      this.showCodeStep();
    } catch (error) {
      byId(this.codeStep ? "login-code-error" : "login-error").textContent =
        error.message;
    } finally {
      setBusy(button, false);
    }
  }

  async verifyCode() {
    const button = byId("login-verify");
    const code = byId("login-code").value.trim();
    byId("login-code-error").textContent = "";
    if (!/^\d{6}$/.test(code)) {
      byId("login-code-error").textContent = "Enter the 6-digit verification code.";
      return;
    }
    setBusy(button, true, "Verifying…");
    let failed = false;
    try {
      const result = await this.api.request("/auth/otp/verify", {
        method: "POST",
        body: JSON.stringify(
          this.byEmail
            ? { email: this.identifier, code }
            : { phoneNumber: this.identifier, code }
        ),
      });
      this.requireAdministrator(result.user);
      this.api.setTokens(result.accessToken, result.refreshToken);
      sessionStorage.setItem(TOKEN_KEY, result.accessToken);
      if (result.refreshToken) sessionStorage.setItem(REFRESH_KEY, result.refreshToken);
      this.failedAttempts = 0;
      await this.callbacks.onAuthenticated(result.user);
    } catch (error) {
      failed = true;
      this.failedAttempts += 1;
      byId("login-code").value = "";
      byId("login-code-error").textContent = error.message;
    } finally {
      setBusy(button, false);
    }
    if (!failed) return;
    // Gentle client-side throttle on top of the server guard: slow down
    // rapid code guessing without locking out a mistyped code.
    // Runs after setBusy restores the label so the countdown text survives.
    const cooldown = loginCooldownMs(this.failedAttempts);
    button.disabled = true;
    button.textContent = `Try again in ${Math.ceil(cooldown / 1000)}s`;
    window.setTimeout(() => {
      button.disabled = false;
      button.textContent = button.dataset.label || "Verify and sign in";
      byId("login-code").focus();
    }, cooldown);
  }

  startIdleWatch({ onIdle, onIdleWarning }) {
    this.stopIdleWatch();
    this.onIdle = onIdle;
    this.onIdleWarning = onIdleWarning;
    IDLE_EVENTS.forEach((name) => document.addEventListener(name, this.handleActivity, { passive: true }));
    this.resetIdleTimers();
  }

  stopIdleWatch() {
    IDLE_EVENTS.forEach((name) => document.removeEventListener(name, this.handleActivity));
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.warnTimer);
    this.idleTimer = 0;
    this.warnTimer = 0;
  }

  resetIdleTimers() {
    if (!this.onIdle) return;
    window.clearTimeout(this.idleTimer);
    window.clearTimeout(this.warnTimer);
    const warning = this.onIdleWarning;
    const idle = this.onIdle;
    this.warnTimer = window.setTimeout(() => warning?.(IDLE_TIMEOUT_MS - IDLE_WARN_MS), IDLE_WARN_MS);
    this.idleTimer = window.setTimeout(() => idle?.(), IDLE_TIMEOUT_MS);
  }

  async resume() {
    const token = sessionStorage.getItem(TOKEN_KEY);
    // No stored session: leave the boot splash for the sign-in form.
    if (!token) {
      this.callbacks.onLogout();
      return;
    }
    // /auth/me goes through the silent-refresh path, so a reload with an
    // expired access token still resumes when the refresh token is valid.
    this.api.setTokens(token, sessionStorage.getItem(REFRESH_KEY));
    try {
      const user = await this.api.request("/auth/me");
      this.requireAdministrator(user);
      await this.callbacks.onAuthenticated(user);
    } catch {
      this.logout();
    }
  }

  requireAdministrator(user) {
    if (!user?.roles?.includes("ADMIN")) {
      throw new Error("This account is not authorised for administration");
    }
  }

  logout(reason) {
    this.stopIdleWatch();
    this.api.clearTokens();
    sessionStorage.removeItem(TOKEN_KEY);
    sessionStorage.removeItem(REFRESH_KEY);
    this.callbacks.onLogout(reason);
  }
}
