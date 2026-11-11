import { actionButton, byId, element, information, section, showToast, skeletonCards, skeletonRows } from "./dom.js";

export const payoutStatusLabel = (status) => String(status || "").replaceAll("_", " ").toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
export const formatPaisa = (paisa) => `₹${Math.round((paisa || 0) / 100).toLocaleString("en-IN")}`;
const formatDate = (value) => value ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(new Date(value)) : "Not yet";

export class PayoutsController {
  constructor(api) {
    this.api = api;
    this.selectedId = "";
    this.selectedAccount = null;
    this.rows = [];
    this.loaded = false;
  }

  bind() {
    byId("payouts-refresh").addEventListener("click", () => this.load(true));
    byId("payout-status-filter").addEventListener("change", () => this.load(true));
  }

  async load(force = false) {
    if (this.loaded && !force) return;
    byId("payout-list-status").textContent = "Loading payout accounts…";
    byId("payout-queue-status").textContent = "Loading earnings queue…";
    skeletonCards(byId("payouts-summary"));
    skeletonRows(byId("payout-list"), 4);
    skeletonRows(byId("payout-queue"), 4);
    const query = new URLSearchParams({ limit: "50" });
    const status = byId("payout-status-filter").value;
    if (status) query.set("status", status);
    try {
      const [queue, list] = await Promise.all([
        this.api.get("/payments/admin/payout-queue", { ttl: 15_000, force }),
        this.api.get(`/payments/admin/payout-accounts?${query}`, { ttl: 15_000, force }),
      ]);
      this.renderSummary(queue.totals);
      this.renderQueue(queue.data);
      this.renderList(list.data, list.meta.total);
      this.rows = list.data;
      this.loaded = true;
      if (this.selectedId && list.data.some((account) => account.id === this.selectedId)) await this.select(this.selectedId, false);
    } catch (error) {
      byId("payout-list-status").textContent = error.message;
      byId("payout-queue-status").textContent = error.message;
    }
  }

  renderSummary(totals) {
    const cards = [
      ["To release now", formatPaisa(totals.pendingReleasePaisa), "Confirmed work awaiting payout", "success"],
      ["Stuck releases", formatPaisa(totals.stuckPaisa), "Missing payout account or failed transfer", "warning"],
      ["Released lifetime", formatPaisa(totals.releasedLifetimePaisa), "Paid out to professionals", "navy"],
    ];
    const summary = byId("payouts-summary");
    summary.replaceChildren();
    cards.forEach(([label, value, caption, tone]) => {
      const card = element("article", `metric-card tone-${tone}`);
      card.append(element("span", "metric-label", label), element("strong", "", value), element("small", "", caption));
      summary.append(card);
    });
  }

  renderQueue(rows) {
    byId("payout-queue-status").textContent = rows.length ? `${rows.length} professional${rows.length === 1 ? "" : "s"} holding money` : "Nobody holds releasable money right now.";
    const list = byId("payout-queue");
    list.replaceChildren();
    rows.forEach((row) => {
      const item = element("div", "queue-item user-item");
      const copy = element("span", "user-item-copy");
      const name = element("span", "user-name-line");
      name.append(element("strong", "", row.professionalName), element("span", `badge ${row.payoutAccountStatus}`, payoutStatusLabel(row.payoutAccountStatus)));
      copy.append(name,
        element("small", "", `To release ${formatPaisa(row.pendingReleasePaisa)} · stuck ${formatPaisa(row.stuckPaisa)} · lifetime ${formatPaisa(row.releasedLifetimePaisa)}`),
        element("small", "muted", `${row.phoneNumber || "No phone"} · ${row.upiId || (row.accountLast4 ? `••••${row.accountLast4}` : "no payout details")}`));
      item.append(copy);
      list.append(item);
    });
  }

  renderList(accounts, total) {
    byId("payout-list-status").textContent = `${total} payout account${total === 1 ? "" : "s"}`;
    const list = byId("payout-list");
    list.replaceChildren();
    if (!accounts.length) {
      list.append(element("div", "empty-row", "No payout accounts match this filter."));
      return;
    }
    accounts.forEach((account) => {
      const button = element("button", `queue-item user-item${account.id === this.selectedId ? " active" : ""}`);
      button.type = "button";
      button.dataset.accountId = account.id;
      const copy = element("span", "user-item-copy");
      const name = element("span", "user-name-line");
      name.append(element("strong", "", account.professionalName), element("span", `badge ${account.status}`, payoutStatusLabel(account.status)));
      copy.append(name, element("small", "", `${account.maskedAccountNumber || account.upiId || "No details"} · ${account.bankName || "bank unknown"}`),
        element("small", "muted", formatDate(account.updatedAt)));
      button.append(copy);
      button.addEventListener("click", () => this.select(account.id));
      list.append(button);
    });
  }

  async select(id, scroll = true) {
    this.selectedId = id;
    document.querySelectorAll("#payout-list .user-item").forEach((item) => item.classList.toggle("active", item.dataset.accountId === id));
    this.selectedAccount = this.rows.find((account) => account.id === id) || null;
    if (!this.selectedAccount) {
      byId("payout-detail").replaceChildren(element("div", "empty-row error", "That account is no longer in this list. Refresh to reload."));
      return;
    }
    this.renderDetail(this.selectedAccount);
    if (scroll && window.matchMedia("(max-width: 1100px)").matches) byId("payout-detail").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  renderDetail(account) {
    const detail = byId("payout-detail");
    detail.replaceChildren();
    const heading = element("div", "user-detail-heading");
    const identityCopy = element("div");
    identityCopy.append(element("h2", "", account.professionalName), element("p", "muted", `${account.phoneNumber || "No phone"}`));
    heading.append(identityCopy, element("span", `badge ${account.status}`, payoutStatusLabel(account.status)));
    const info = element("div", "info-grid");
    info.append(
      information("Holder", account.accountHolderName || "Not provided"),
      information("Bank", account.bankName || "Not provided"),
      information("Account", account.maskedAccountNumber || "Not provided"),
      information("IFSC", account.ifsc || "Not provided"),
      information("UPI id", account.upiId || "Not provided"),
      information("Route ref", account.providerAccountRef || "Not linked"),
      information("Submitted", formatDate(account.updatedAt)),
      information("Review note", account.rejectionReason || "None"),
    );
    detail.append(heading, info);
    if (account.status === "PENDING") {
      detail.append(section("Link Razorpay Route account",
        element("p", "muted", "After onboarding the professional in the Razorpay Route dashboard, paste the linked-account reference to activate payouts.")));
      detail.append(this.linkForm(account));
      detail.append(this.reviewForm(account, "reject"));
    }
    if (account.status === "ACTIVE") detail.append(this.reviewForm(account, "suspend"));
    if (account.status === "REJECTED" || account.status === "SUSPENDED") {
      const controls = element("div", "detail-actions");
      controls.append(actionButton("Clear for re-review", "secondary", () => this.review(account, "clear", "")));
      detail.append(controls);
    }
  }

  linkForm(account) {
    const form = element("form", "inline-form");
    const refInput = element("input"); refInput.placeholder = "Route linked-account ref (acc_…)"; refInput.required = true; refInput.setAttribute("aria-label", "Route linked-account reference");
    const nameInput = element("input"); nameInput.value = account.accountHolderName || ""; nameInput.setAttribute("aria-label", "Account holder name");
    const submit = actionButton("Link & activate", "primary", null);
    form.append(refInput, nameInput, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      submit.disabled = true;
      try {
        await this.api.request("/payments/payout-accounts", {method: "POST", body: JSON.stringify({
          professionalProfileId: account.professionalProfileId, providerAccountRef: refInput.value.trim(),
          accountHolderName: nameInput.value.trim() || account.accountHolderName,
          bankName: account.bankName, accountLast4: account.accountLast4})});
        this.api.clearCache("/payments");
        this.loaded = false;
        await this.load(true);
        showToast("Payout account linked and activated", "success");
      } catch (error) {
        showToast(error.message, "error");
      } finally {
        submit.disabled = false;
      }
    });
    return form;
  }

  reviewForm(account, decision) {
    const form = element("form", "inline-form");
    const reasonInput = element("input");
    reasonInput.placeholder = decision === "reject" ? "Reason (shown to the professional)…" : "Suspension reason…";
    reasonInput.required = true;
    reasonInput.setAttribute("aria-label", "Review reason");
    const submit = actionButton(decision === "reject" ? "Reject submission" : "Suspend payouts", "danger", null);
    form.append(reasonInput, submit);
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      await this.review(account, decision, reasonInput.value);
    });
    return form;
  }

  async review(account, decision, note) {
    try {
      await this.api.request(`/payments/admin/payout-accounts/${account.id}/review`, {method: "POST", body: JSON.stringify({decision, note})});
      this.api.clearCache("/payments");
      this.loaded = false;
      await this.load(true);
      showToast(decision === "clear" ? "Account cleared for re-review" : `Account ${decision}ed`, "success");
    } catch (error) {
      showToast(error.message, "error");
    }
  }
}
