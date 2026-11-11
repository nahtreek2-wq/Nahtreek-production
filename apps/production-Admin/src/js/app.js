import { ApiClient } from "./api.js";
import { AuthController } from "./auth.js";
import { byId } from "./dom.js";
import { OverviewController } from "./overview.js";
import { UsersController } from "./users.js";
import { VerificationDesk } from "./verification.js";
import { ActivityController } from "./activity.js";
import { MembershipsController } from "./memberships.js";
import { PaymentsController } from "./payments.js";
import { PayoutsController } from "./payouts.js";
import { SettingsController } from "./settings.js";
import { TicketsDesk } from "./tickets.js";

const config = window.NAHTREEK_ADMIN_CONFIG || {};
const api = new ApiClient(config.apiBaseUrl);
const verification = new VerificationDesk(api);
const users = new UsersController(api);
const tickets = new TicketsDesk(api);
const viewTitles = { overview: "Dashboard", verification: "Verifications", users: "Users", payments: "Payments", memberships: "Memberships", payouts: "Payouts", tickets: "Support", activity: "Activity", settings: "My account" };
let currentView = "overview";

function setMenuState(open) {
  const mobile = window.matchMedia("(max-width: 1000px)").matches;
  const sidebar = byId("admin-sidebar");
  document.body.classList.toggle("menu-open", mobile && open);
  byId("menu-toggle").setAttribute("aria-expanded", String(mobile && open));
  sidebar.inert = mobile && !open;
  sidebar.setAttribute("aria-hidden", String(mobile && !open));
}

function closeMenu() {
  setMenuState(false);
}

function updateAdminName(name) {
  const displayName = name || "Administrator";
  byId("admin-name").textContent = displayName;
  byId("admin-greeting").textContent = displayName.replace(/^NAHTREEK\s+/i, "");
}

function navigate(view) {
  currentView = view;
  document.querySelectorAll(".page-view").forEach((page) => page.classList.toggle("hidden", page.id !== `${view}-view`));
  document.querySelectorAll(".nav-item").forEach((button) => button.classList.toggle("nav-active", button.dataset.view === view));
  if (view === "overview") void overview.load();
  if (view === "verification") void verification.load();
  if (view === "users") void users.load();
  if (view === "payments") void payments.load();
  if (view === "memberships") void memberships.load();
  if (view === "payouts") void payouts.load();
  if (view === "tickets") void tickets.load();
  if (view === "activity") void activity.load();
  if (view === "settings") void settings.load();
  byId("mobile-page-title").textContent = viewTitles[view] || "Operations";
  closeMenu();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

const overview = new OverviewController(api, navigate);
const payments = new PaymentsController(api);
const memberships = new MembershipsController(api);
const payouts = new PayoutsController(api);
const activity = new ActivityController(api);
const settings = new SettingsController(api, updateAdminName);

function showEnvironment() {
  const label = `${config.environment || "unknown"} environment`;
  byId("login-environment").textContent = label;
  byId("dashboard-environment").textContent = label;
}

function hideBoot() {
  byId("boot-view").classList.add("hidden");
}

let idleCountdown = 0;

function closeIdleDialog() {
  window.clearInterval(idleCountdown);
  idleCountdown = 0;
  const dialog = byId("idle-dialog");
  if (dialog.open) dialog.close();
}

function showIdleWarning(remainingMs) {
  const dialog = byId("idle-dialog");
  const label = byId("idle-countdown");
  const update = () => {
    const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
    label.textContent = `Signing out in ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;
  };
  const deadline = Date.now() + remainingMs;
  window.clearInterval(idleCountdown);
  update();
  idleCountdown = window.setInterval(update, 1000);
  if (!dialog.open) dialog.showModal();
}

// Rendered queues hold PII and money rows: on logout the nodes are purged
// so no account data lingers in a hidden DOM on shared machines.
const PURGE_IDS = [
  "queue", "detail", "user-list", "user-detail", "payment-list", "payment-detail",
  "membership-list", "membership-detail", "ai-membership-list", "activity-list",
  "overview-summary", "attention-list", "role-breakdown", "summary",
  "payments-summary", "memberships-summary", "ai-memberships-summary",
  "payouts-summary", "payout-list", "payout-detail", "payout-queue",
  "ticket-queue", "ticket-detail",
];

function purgeDashboard() {
  verification.reset();
  tickets.reset();
  document.querySelectorAll("dialog").forEach((dialog) => { if (dialog.open) dialog.close(); });
  PURGE_IDS.forEach((id) => byId(id).replaceChildren());
}

async function showDashboard(user) {
  const name = user.fullName || "Administrator";
  updateAdminName(name);
  hideBoot();
  byId("login-view").classList.add("hidden");
  byId("dashboard-view").classList.remove("hidden");
  closeIdleDialog();
  auth.startIdleWatch({
    onIdleWarning: (remainingMs) => showIdleWarning(remainingMs),
    onIdle: () => auth.logout("idle"),
  });
  navigate(currentView);
}

function showLogin(reason) {
  closeIdleDialog();
  purgeDashboard();
  hideBoot();
  byId("dashboard-view").classList.add("hidden");
  byId("login-view").classList.remove("hidden");
  byId("password").value = "";
  if (reason === "idle") {
    byId("login-error").textContent = "Signed out after 15 minutes of inactivity. Sign in again to continue.";
  }
}

const auth = new AuthController(api, { onAuthenticated: showDashboard, onLogout: showLogin });
verification.bind();
users.bind();
payments.bind();
memberships.bind();
payouts.bind();
tickets.bind();
overview.bind();
activity.bind();
settings.bind();
document.querySelectorAll(".nav-item").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.view)));
byId("menu-toggle").addEventListener("click", () => {
  setMenuState(!document.body.classList.contains("menu-open"));
});
byId("menu-close").addEventListener("click", closeMenu);
byId("sidebar-backdrop").addEventListener("click", closeMenu);
document.addEventListener("keydown", (event) => { if (event.key === "Escape") closeMenu(); });
window.addEventListener("resize", closeMenu);
byId("login-form").addEventListener("submit", (event) => auth.login(event));
byId("logout-button").addEventListener("click", () => auth.logout());
byId("idle-stay").addEventListener("click", () => {
  auth.resetIdleTimers();
  closeIdleDialog();
});
byId("idle-logout").addEventListener("click", () => auth.logout());
// Any activity while the warning is open both extends the session (via the
// idle watch) and dismisses the stale countdown.
["pointerdown", "keydown"].forEach((name) => document.addEventListener(name, () => {
  if (byId("idle-dialog").open) closeIdleDialog();
}, { passive: true }));
byId("password-toggle").addEventListener("click", () => {
  const field = byId("password");
  const button = byId("password-toggle");
  const show = field.type === "password";
  field.type = show ? "text" : "password";
  button.textContent = show ? "Hide" : "Show";
  button.setAttribute("aria-pressed", String(show));
  field.focus();
});
byId("password").addEventListener("keyup", (event) => {
  const caps = event.getModifierState?.("CapsLock");
  byId("caps-warning").classList.toggle("hidden", !caps);
});
// Press "/" anywhere in the console to jump to the visible search box.
document.addEventListener("keydown", (event) => {
  if (event.key !== "/" || event.metaKey || event.ctrlKey || event.altKey) return;
  if (byId("dashboard-view").classList.contains("hidden")) return;
  const target = event.target;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return;
  if (document.querySelector("dialog[open]")) return;
  const search = document.querySelector(".page-view:not(.hidden) input[type='search']");
  if (search) {
    event.preventDefault();
    search.focus();
  }
});
showEnvironment();
closeMenu();
auth.resume();
