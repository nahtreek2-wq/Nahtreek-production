import {byId, element, showToast, skeletonRows} from "./dom.js";

export const ticketStatusLabel = (status) =>
  ({OPEN: "Open", ANSWERED: "Answered", RESOLVED: "Resolved"}[status] || status || "Unknown");

export const replyAuthorLabel = (role) => (role === "ADMIN" ? "Support" : "User");

export class TicketsDesk {
  constructor(api) {
    this.api = api;
    this.selectedId = "";
    this.tickets = [];
  }

  bind() {
    byId("ticket-status-filter").addEventListener("change", () => this.load(true));
    byId("ticket-refresh").addEventListener("click", () => this.load(true));
    byId("ticket-reply-form").addEventListener("submit", (event) => this.submitReply(event));
    byId("ticket-resolve").addEventListener("click", () => this.resolveSelected());
  }

  reset() {
    this.selectedId = "";
    this.tickets = [];
    byId("ticket-queue").replaceChildren();
    byId("ticket-detail").replaceChildren();
  }

  async load(force = false) {
    byId("ticket-queue-status").textContent = "Loading support requests…";
    skeletonRows(byId("ticket-queue"), 6);
    const status = byId("ticket-status-filter").value;
    try {
      const query = new URLSearchParams({limit: "100"});
      if (status) query.set("status", status);
      const page = await this.api.get(`/admin/tickets?${query}`, {ttl: 15_000, force});
      this.tickets = page.data ?? [];
      this.renderQueue(page.meta?.total ?? this.tickets.length);
      const stillThere = this.tickets.some((item) => item.id === this.selectedId);
      if (this.selectedId && stillThere) this.renderDetail(this.selectedId);
      else if (this.tickets.length) this.renderDetail(this.tickets[0].id);
      else byId("ticket-detail").replaceChildren(element("div", "empty-row", "No support requests match this filter."));
    } catch (error) {
      byId("ticket-queue-status").textContent = error.message;
    }
  }

  renderQueue(total) {
    const queue = byId("ticket-queue");
    queue.replaceChildren();
    byId("ticket-queue-status").textContent =
      total === 0 ? "Queue is clear." : `${total} request${total === 1 ? "" : "s"}`;
    for (const ticket of this.tickets) {
      const name = ticket.user?.displayName || ticket.user?.email || "Unknown user";
      const button = element("button", `queue-item${ticket.id === this.selectedId ? " active" : ""}`);
      button.type = "button";
      button.dataset.ticketId = ticket.id;
      const head = element("div", "queue-head");
      head.append(
        element("strong", "", ticket.subject || "(no subject)"),
        element("span", `badge ${ticket.status}`, ticketStatusLabel(ticket.status)),
      );
      const meta = element("div", "queue-meta");
      meta.append(element("span", "", name));
      if (ticket.bookingRef) meta.append(element("span", "", `Ref ${ticket.bookingRef}`));
      button.append(head, meta);
      button.addEventListener("click", () => this.renderDetail(ticket.id));
      queue.append(button);
    }
  }

  renderDetail(id) {
    this.selectedId = id;
    const ticket = this.tickets.find((item) => item.id === id);
    const detail = byId("ticket-detail");
    detail.replaceChildren();
    if (!ticket) return;
    document.querySelectorAll("#ticket-queue .queue-item").forEach((item) =>
      item.classList.toggle("active", item.dataset.ticketId === id));
    const title = element("div", "detail-title");
    const copy = element("div");
    copy.append(
      element("h2", "", ticket.subject || "(no subject)"),
      element("div", "muted", `${ticket.user?.displayName || "Unknown user"} · ${ticket.user?.email || "no email"}`),
    );
    title.append(copy);
    detail.append(title, element("p", "", ticket.message || ""));
    const thread = element("div", "thread");
    for (const reply of ticket.replies ?? []) {
      const row = element("div", `thread-row ${reply.authorRole === "ADMIN" ? "thread-admin" : "thread-user"}`);
      row.append(element("b", "", replyAuthorLabel(reply.authorRole)), element("p", "", reply.message));
      thread.append(row);
    }
    // Pre-thread rows only carry the legacy mirror: show it once so history
    // is never silently dropped for old tickets.
    if (!ticket.replies?.length && ticket.adminReply) {
      const row = element("div", "thread-row thread-admin");
      row.append(element("b", "", "Support"), element("p", "", ticket.adminReply));
      thread.append(row);
    }
    detail.append(thread);
    byId("ticket-resolve").disabled = ticket.status === "RESOLVED";
  }

  async submitReply(event) {
    event.preventDefault();
    const box = byId("ticket-reply-text");
    const reply = box.value.trim();
    if (!this.selectedId || reply.length < 2) return;
    try {
      await this.api.request(`/admin/tickets/${this.selectedId}/reply`, {
        method: "POST",
        body: JSON.stringify({reply}),
      });
      box.value = "";
      showToast("Reply sent to the user.", "success");
      await this.load(true);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async resolveSelected() {
    if (!this.selectedId) return;
    try {
      await this.api.request(`/admin/tickets/${this.selectedId}/resolve`, {method: "POST"});
      showToast("Ticket resolved.", "success");
      await this.load(true);
    } catch (error) {
      showToast(error.message, "error");
    }
  }
}
