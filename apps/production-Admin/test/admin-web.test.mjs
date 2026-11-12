import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { ApiClient, ApiError } from "../src/js/api.js";
import { IDLE_TIMEOUT_MS, IDLE_WARN_MS, loginCooldownMs } from "../src/js/auth.js";
import { safeHttpUrl, timeAgo } from "../src/js/dom.js";
import { availablePaymentActions, formatPaisa as formatPaymentPaisa, moneyConfirmWord, paymentStatusLabel } from "../src/js/payments.js";
import { aiEngineLabel, aiSummaryCards, formatPaisa as formatMembershipPaisa, membershipStatusLabel } from "../src/js/memberships.js";
import { replyAuthorLabel, ticketStatusLabel } from "../src/js/tickets.js";
import { formatPaisa as formatPayoutPaisa, payoutStatusLabel } from "../src/js/payouts.js";

test("ApiClient sends the administrator bearer token", async () => {
  let received;
  const api = new ApiClient("https://api.example.test/api/v1/", async (url, options) => {
    received = { url, options };
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  api.setToken("test-token");
  await api.request("/admin/verifications");
  assert.equal(received.url, "https://api.example.test/api/v1/admin/verifications");
  assert.equal(received.options.headers.authorization, "Bearer test-token");
});

test("ApiClient reports API validation messages", async () => {
  const api = new ApiClient("https://api.example.test", async () => new Response(
    JSON.stringify({ message: ["Document is required", "City is required"] }),
    { status: 422, headers: { "content-type": "application/json" } },
  ));
  await assert.rejects(() => api.request("/test"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.message, "Document is required. City is required");
    assert.equal(error.status, 422);
    return true;
  });
});

test("ApiClient default fetch preserves the browser-style receiver", async () => {
  const originalFetch = globalThis.fetch;
  const receiver = globalThis;
  globalThis.fetch = function fetchWithRequiredReceiver() {
    assert.equal(this, receiver);
    return Promise.resolve(new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };
  try {
    const api = new ApiClient("https://api.example.test");
    await api.request("/receiver-check");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("ApiClient caches repeated reads and invalidates admin data after a mutation", async () => {
  let calls = 0;
  const api = new ApiClient("https://api.example.test", async () => {
    calls += 1;
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  const first = await api.get("/admin/overview", { ttl: 10_000 });
  const second = await api.get("/admin/overview", { ttl: 10_000 });
  assert.equal(first.call, 1);
  assert.equal(second.call, 1);
  assert.equal(calls, 1);
  await api.request("/admin/users/example/status", { method: "PATCH", body: "{}" });
  const refreshed = await api.get("/admin/overview", { ttl: 10_000 });
  assert.equal(refreshed.call, 3);
});

test("build contains official branding and generated environment config", async () => {
  const [html, config] = await Promise.all([
    readFile(new URL("../dist/index.html", import.meta.url), "utf8"),
    readFile(new URL("../dist/config.js", import.meta.url), "utf8"),
  ]);
  assert.match(html, /assets\/nahtreek-logo\.png/);
  assert.match(html, /User management/);
  assert.match(html, /OPERATIONS OVERVIEW/);
  assert.match(html, /id="menu-toggle"/);
  assert.match(html, /data-view="activity"/);
  assert.match(html, /data-view="tickets"/);
  assert.match(html, /id="ticket-reply-form"/);
  assert.match(html, /data-view="settings"/);
  assert.match(html, /id="user-edit-dialog"/);
  assert.doesNotMatch(html, /__NAHTREEK_API_ORIGIN__/);
  assert.match(html, /connect-src 'self'/);
  assert.match(html, /object-src 'none'/);
  assert.match(html, /upgrade-insecure-requests/);
  assert.match(html, /id="login-identifier-step"/);
  assert.match(html, /id="login-code-step"/);
  assert.match(html, /id="login-code"/);
  assert.match(html, /autocomplete="one-time-code"/);
  assert.match(html, /id="login-resend"/);
  assert.match(html, /id="login-back"/);
  assert.doesNotMatch(html, /id="password-toggle"/);
  assert.doesNotMatch(html, /id="caps-warning"/);
  assert.match(html, /id="money-confirm"/);
  assert.match(html, /id="idle-dialog"/);
  assert.match(html, /id="idle-stay"/);
  assert.match(html, /id="idle-logout"/);
  if ((process.env.ADMIN_ENV || "preview") === "production") {
    assert.match(config, /"environment":"production"/);
    assert.match(config, /"apiBaseUrl":"https:\/\/api\.nahtreek\.com\/api\/v1"/);
    assert.match(html, /connect-src 'self' https:\/\/api\.nahtreek\.com;/);
  } else {
    assert.match(config, /"environment":"preview"/);
    assert.match(config, /"apiBaseUrl":"\/backend"/);
    assert.match(html, /connect-src 'self'\s*;/);
  }
});

test("money helpers label statuses, format rupees and gate actions", () => {
  assert.equal(paymentStatusLabel("RELEASE_PENDING"), "Release pending");
  assert.equal(paymentStatusLabel("REFUNDED"), "Refunded");
  assert.equal(membershipStatusLabel("PAST_DUE"), "Past due");
  assert.equal(formatPaymentPaisa(200000), "₹2,000");
  assert.equal(formatMembershipPaisa(39900), "₹399");
  assert.equal(formatMembershipPaisa(9900), "₹99");
  assert.deepEqual(aiSummaryCards({ active: 2, mrrPaisa: 19800, feePaisa: 9900 }), [
    ["Active AI subscribers", 2, "₹198 monthly recurring", "success"],
    ["AI plan price", "₹99", "per month, Home app", "navy"],
  ]);
  assert.deepEqual(availablePaymentActions("RELEASE_PENDING"), ["release"]);
  assert.deepEqual(availablePaymentActions("DISPUTED"), ["resolve-release", "resolve-refund"]);
  assert.deepEqual(availablePaymentActions("HELD"), ["refund"]);
  assert.deepEqual(availablePaymentActions("RELEASED"), []);
  assert.deepEqual(availablePaymentActions("REFUNDED"), []);
  assert.deepEqual(availablePaymentActions("REFUND_PENDING"), []);
});

test("build ships the money operations views", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /data-view="payments"/);
  assert.match(html, /data-view="memberships"/);
  assert.match(html, /id="payments-view"/);
  assert.match(html, /id="memberships-view"/);
  assert.match(html, /id="payment-status-filter"/);
  assert.match(html, /id="membership-status-filter"/);
  assert.match(html, /id="ai-memberships-summary"/);
  assert.match(html, /id="ai-membership-status-filter"/);
  assert.match(html, /id="ai-membership-list"/);
  assert.match(html, /HOME APP REVENUE/);
  assert.match(html, /id="ai-engine-status"/);
  assert.equal(aiEngineLabel(null), "AI engine: checking…");
  assert.equal(aiEngineLabel({engine: "guided-fallback"}), "AI engine: guided mode (no hosted model)");
  assert.match(aiEngineLabel({engine: "hosted-model", model: "m", ok: true, latencyMs: 42, vision: "supported"}), /live \(m, 42ms\) · photo vision on/);
  assert.match(aiEngineLabel({engine: "hosted-model", ok: false, vision: "untested"}), /unreachable/);
  assert.match(html, /id="money-dialog"/);
  assert.match(html, /MONEY OPERATIONS/);
  assert.match(html, /RECURRING REVENUE/);
});

test("ApiClient silently refreshes once on 401 and retries with the new token", async () => {
  const seen = [];
  const api = new ApiClient("https://api.example.test", async (url, options) => {
    seen.push({ url, authorization: options.headers.authorization });
    if (url.endsWith("/auth/refresh")) {
      assert.equal(JSON.parse(options.body).refreshToken, "refresh-one");
      return new Response(JSON.stringify({ accessToken: "access-two", refreshToken: "refresh-two" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (options.headers.authorization === "Bearer access-two") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  });
  let refreshed;
  api.onTokensRefreshed = (accessToken, refreshToken) => { refreshed = { accessToken, refreshToken }; };
  let loggedOut = false;
  api.onUnauthorized = () => { loggedOut = true; };
  api.setTokens("access-one", "refresh-one");
  const data = await api.request("/admin/overview");
  assert.deepEqual(data, { ok: true });
  assert.deepEqual(refreshed, { accessToken: "access-two", refreshToken: "refresh-two" });
  assert.equal(loggedOut, false);
  assert.equal(seen.filter((call) => call.url.endsWith("/auth/refresh")).length, 1);
});

test("ApiClient logs out when the refresh token is rejected", async () => {
  const api = new ApiClient("https://api.example.test", async (url) => {
    if (url.endsWith("/auth/refresh")) {
      return new Response(JSON.stringify({ message: "Session revoked" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  });
  let loggedOut = false;
  api.onUnauthorized = () => { loggedOut = true; };
  api.setTokens("access-stale", "refresh-revoked");
  await assert.rejects(() => api.request("/admin/overview"), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 401);
    return true;
  });
  assert.equal(loggedOut, true);
});

test("ApiClient shares one refresh across concurrent 401s", async () => {
  let refreshCalls = 0;
  const api = new ApiClient("https://api.example.test", async (url, options) => {
    if (url.endsWith("/auth/refresh")) {
      refreshCalls += 1;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return new Response(JSON.stringify({ accessToken: "access-new", refreshToken: "refresh-new" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    if (options.headers.authorization === "Bearer access-new") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  });
  api.setTokens("access-stale", "refresh-shared");
  const [first, second] = await Promise.all([api.request("/admin/one"), api.request("/admin/two")]);
  assert.deepEqual(first, { ok: true });
  assert.deepEqual(second, { ok: true });
  assert.equal(refreshCalls, 1);
});

test("ApiClient never refreshes on auth-endpoint failures", async () => {
  let refreshCalls = 0;
  const api = new ApiClient("https://api.example.test", async (url) => {
    if (url.endsWith("/auth/refresh")) refreshCalls += 1;
    return new Response(JSON.stringify({ message: "Invalid credentials" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  });
  let loggedOut = false;
  api.onUnauthorized = () => { loggedOut = true; };
  api.setTokens("access-stale", "refresh-unused");
  await assert.rejects(() => api.request("/auth/otp/verify", { method: "POST", body: "{}" }));
  assert.equal(refreshCalls, 0);
  assert.equal(loggedOut, true);
});

test("safeHttpUrl only allows https and same-origin links", () => {
  assert.equal(safeHttpUrl("https://storage.example.test/proof.jpg"), "https://storage.example.test/proof.jpg");
  assert.equal(safeHttpUrl("  https://storage.example.test/a b  "), "https://storage.example.test/a%20b");
  assert.equal(safeHttpUrl("/backend/files/proof.jpg"), "/backend/files/proof.jpg");
  assert.equal(safeHttpUrl("http://storage.example.test/proof.jpg"), "");
  assert.equal(safeHttpUrl("javascript:alert(document.domain)"), "");
  assert.equal(safeHttpUrl("JaVaScRiPt:alert(1)"), "");
  assert.equal(safeHttpUrl("data:text/html,<script>alert(1)</script>"), "");
  assert.equal(safeHttpUrl("//evil.example.test/proof.jpg"), "");
  assert.equal(safeHttpUrl(""), "");
  assert.equal(safeHttpUrl(null), "");
  assert.equal(safeHttpUrl(42), "");
});

test("money movements require the right typed confirmation word", () => {
  assert.equal(moneyConfirmWord("refund"), "REFUND");
  assert.equal(moneyConfirmWord("resolve-refund"), "REFUND");
  assert.equal(moneyConfirmWord("resolve-release"), "RELEASE");
});

test("idle logout warns before it signs out, and login cools down progressively", () => {
  assert.ok(IDLE_WARN_MS < IDLE_TIMEOUT_MS);
  assert.equal(IDLE_TIMEOUT_MS - IDLE_WARN_MS, 2 * 60_000);
  assert.equal(loginCooldownMs(1), 2000);
  assert.equal(loginCooldownMs(3), 6000);
  assert.equal(loginCooldownMs(99), 10_000);
});

test("timeAgo renders friendly relative timestamps", () => {
  const now = Date.now();
  assert.equal(timeAgo(new Date(now - 10_000).toISOString()), "Just now");
  assert.equal(timeAgo(new Date(now - 5 * 60_000).toISOString()), "5 min ago");
  assert.equal(timeAgo(new Date(now - 3 * 3_600_000).toISOString()), "3 hr ago");
  assert.equal(timeAgo(new Date(now - 2 * 86_400_000).toISOString()), "2 days ago");
  assert.equal(timeAgo("not-a-date"), "Date unavailable");
});

test("ApiClient clears money caches by path prefix after mutations", async () => {
  let calls = 0;
  const api = new ApiClient("https://api.example.test", async () => {
    calls += 1;
    return new Response(JSON.stringify({ call: calls }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  await api.get("/payments/admin/summary", { ttl: 60_000 });
  await api.get("/payments/admin/summary", { ttl: 60_000 });
  assert.equal(calls, 1);
  api.clearCache("/payments");
  await api.get("/payments/admin/summary", { ttl: 60_000 });
  assert.equal(calls, 2);
});

test("support desk labels statuses and authors plainly", () => {
  assert.equal(ticketStatusLabel("OPEN"), "Open");
  assert.equal(ticketStatusLabel("ANSWERED"), "Answered");
  assert.equal(ticketStatusLabel("RESOLVED"), "Resolved");
  assert.equal(ticketStatusLabel("WEIRD"), "WEIRD");
  assert.equal(replyAuthorLabel("ADMIN"), "Support");
  assert.equal(replyAuthorLabel("USER"), "User");
});

test("payout desk labels statuses and formats rupees", () => {
  assert.equal(payoutStatusLabel("PENDING"), "Pending");
  assert.equal(payoutStatusLabel("NOT_SUBMITTED"), "Not submitted");
  assert.equal(payoutStatusLabel("SUSPENDED"), "Suspended");
  assert.equal(formatPayoutPaisa(19999), "₹200");
  assert.equal(formatPayoutPaisa(250000), "₹2,500");
});

test("build ships the payouts view", async () => {
  const html = await readFile(new URL("../dist/index.html", import.meta.url), "utf8");
  assert.match(html, /data-view="payouts"/);
  assert.match(html, /id="payouts-view"/);
  assert.match(html, /id="payout-status-filter"/);
  assert.match(html, /id="payout-list"/);
  assert.match(html, /id="payout-detail"/);
  assert.match(html, /id="payout-queue"/);
  assert.match(html, /EARNINGS QUEUE/);
});
