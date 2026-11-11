import { actionButton, byId, element, information, safeHttpUrl, section, showToast, skeletonCards, skeletonRows } from "./dom.js";

const STATUS_LABELS = {
  PENDING: "Waiting",
  UNDER_REVIEW: "Under review",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

const accountLabel = (accountType) => accountType === "ENGINEER" ? "Engineer" : "Service provider";
const listText = (values) => values?.filter(Boolean).join(", ") || "Not provided";

export class VerificationDesk {
  constructor(api) {
    this.api = api;
    this.selectedId = "";
    this.reasonAction = null;
    this.searchTimer = null;
  }

  bind() {
    byId("refresh-button").addEventListener("click", () => this.load(true));
    byId("status-filter").addEventListener("change", () => this.load(true));
    byId("search").addEventListener("input", () => {
      window.clearTimeout(this.searchTimer);
      this.searchTimer = window.setTimeout(() => this.load(true), 250);
    });
    byId("reason-form").addEventListener("submit", (event) => this.submitReason(event));
  }

  reset() {
    this.selectedId = "";
    byId("queue").replaceChildren();
    byId("summary").replaceChildren();
  }

  async load(force = false) {
    byId("queue-status").textContent = "Loading applications…";
    skeletonCards(byId("summary"));
    skeletonRows(byId("queue"), 5);
    const status = byId("status-filter").value;
    const search = byId("search").value.trim();
    try {
      const query = new URLSearchParams({ limit: "100" });
      if (status) query.set("status", status);
      if (search) query.set("search", search);
      const [summary, queue] = await Promise.all([
        this.api.get("/admin/verifications/summary", { ttl: 15_000, force }),
        this.api.get(`/admin/verifications?${query}`, { ttl: 15_000, force }),
      ]);
      this.renderSummary(summary);
      this.renderQueue(queue.data, queue.meta.total);
      if (this.selectedId && queue.data.some((item) => item.id === this.selectedId)) {
        await this.selectProfile(this.selectedId, false);
      }
    } catch (error) {
      byId("queue-status").textContent = error.message;
    }
  }

  renderSummary(summary) {
    const container = byId("summary");
    container.replaceChildren();
    Object.entries(STATUS_LABELS).forEach(([key, label]) => {
      const card = element("div", `summary-card summary-${key.toLowerCase()}`);
      card.append(element("strong", "", summary[key] || 0), element("span", "", label));
      container.append(card);
    });
  }

  renderQueue(items, total) {
    byId("queue-status").textContent = `${total} application${total === 1 ? "" : "s"}`;
    const container = byId("queue");
    container.replaceChildren();
    if (!items.length) {
      const empty = element("div", "empty-row");
      empty.append(element("strong", "", "Queue is clear"), element("span", "", "No professional applications match this view."));
      container.append(empty);
      return;
    }
    items.forEach((item) => {
      const button = element("button", `queue-item${item.id === this.selectedId ? " active" : ""}`);
      button.type = "button";
      button.dataset.profileId = item.id;
      const head = element("div", "queue-head");
      head.append(
        element("strong", "", item.fullName || "Incomplete profile"),
        element("span", `badge ${item.verificationStatus}`, item.verificationStatus.replaceAll("_", " ")),
      );
      const meta = element("div", "queue-meta");
      const documentCount = item.documents?.length || 0;
      meta.append(
        element("span", "", accountLabel(item.accountType)),
        element("span", "", item.baseCity || "City missing"),
        element("span", "", `${documentCount} document${documentCount === 1 ? "" : "s"}`),
      );
      button.append(head, element("div", "queue-subtitle", item.title || "Professional title not completed"), meta);
      button.addEventListener("click", () => this.selectProfile(item.id));
      container.append(button);
    });
  }

  async selectProfile(id, scroll = true) {
    this.selectedId = id;
    byId("detail").replaceChildren(element("div", "empty-row", "Loading verification details…"));
    document.querySelectorAll("#queue .queue-item").forEach((item) => item.classList.toggle("active", item.dataset.profileId === id));
    try {
      this.renderDetail(await this.api.get(`/admin/verifications/${id}`, { ttl: 30_000 }));
      if (scroll && window.matchMedia("(max-width: 1100px)").matches) {
        byId("detail").scrollIntoView({ behavior: "smooth", block: "start" });
      }
    } catch (error) {
      byId("detail").replaceChildren(element("div", "empty-row error", error.message));
    }
  }

  renderDetail(profile) {
    const container = byId("detail");
    container.replaceChildren();
    const title = element("div", "detail-title");
    const copy = element("div");
    copy.append(
      element("h2", "", profile.fullName || "Incomplete profile"),
      element("div", "muted", `${accountLabel(profile.accountType)} · ${profile.baseCity || "City missing"}, ${profile.baseState || "State missing"}`),
    );
    title.append(copy, this.profileActions(profile));

    const identity = element("div", "info-grid");
    identity.append(
      information("Email", profile.user.email),
      information("Mobile", profile.user.phoneNumber),
      information("Professional title", profile.title),
      information("Experience", `${profile.yearsOfExperience || 0} years`),
      information("Account status", profile.user.status),
      information("Verification", STATUS_LABELS[profile.verificationStatus] || profile.verificationStatus),
    );
    container.append(
      title,
      section("Identity and account", identity),
      section("Professional capabilities", this.capabilities(profile)),
      section("Verification documents", this.documents(profile)),
    );
  }

  profileActions(profile) {
    const actions = element("div", "detail-actions");
    if (["PENDING", "REJECTED"].includes(profile.verificationStatus)) {
      actions.append(actionButton("Start review", "secondary", () => this.reviewProfile("UNDER_REVIEW")));
    }
    if (["PENDING", "UNDER_REVIEW"].includes(profile.verificationStatus)) {
      actions.append(actionButton("Reject", "danger", () => this.askReason("profile", profile.id)));
    }
    if (profile.verificationStatus === "UNDER_REVIEW") {
      actions.append(actionButton("Approve profile", "primary", () => this.reviewProfile("VERIFIED")));
    }
    if (profile.verificationStatus === "VERIFIED") {
      actions.append(element("span", "badge VERIFIED", "Verified · read only"));
    }
    return actions;
  }

  capabilities(profile) {
    const content = element("div", "info-grid");
    if (profile.engineer) {
      content.append(
        information("Qualification", profile.engineer.qualificationDegree),
        information("Institution", profile.engineer.institution),
        information("Graduation year", profile.engineer.graduationYear),
        information("Licence", profile.engineer.licenseNumber),
        information("Specialisations", listText(profile.engineer.specializations)),
        information("Consultation fee", profile.engineer.consultationFeePaisa ? `₹${(profile.engineer.consultationFeePaisa / 100).toLocaleString('en-IN')}` : "Not provided"),
      );
    } else {
      content.append(
        information("Services", listText(profile.serviceCategories)),
        information("Starting price", profile.startingPricePaisa ? `₹${(profile.startingPricePaisa / 100).toLocaleString('en-IN')}` : "Not provided"),
        information("Service areas", listText(profile.serviceAreas?.map((area) => area.name))),
        information("Availability", profile.isAvailable ? "Available" : "Unavailable"),
      );
    }
    return content;
  }

  documents(profile) {
    const content = element("div", "documents");
    const documents = profile.documents || [];
    if (!documents.length) {
      content.append(element("div", "empty-row", "No verification documents uploaded."));
      return content;
    }
    documents.forEach((document) => {
      const row = element("div", "document");
      const main = element("div", "document-main");
      const name = element("strong", "document-name", document.documentType.replaceAll("-", " "));
      main.append(name, element("span", `badge ${document.status}`, document.status));
      main.append(element("small", "muted", `Uploaded ${new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(document.uploadedAt))}`));
      if (document.rejectionReason) main.append(element("small", "error", document.rejectionReason));
      const actions = element("div", "document-actions");
      const proofUrl = safeHttpUrl(document.documentUrl);
      if (proofUrl) {
        const view = element("a", "button secondary document-view", "View proof");
        view.href = proofUrl;
        view.target = "_blank";
        view.rel = "noopener noreferrer";
        actions.append(view);
      } else {
        actions.append(element("span", "control-note", "Proof link unavailable"));
      }
      if (profile.verificationStatus !== "VERIFIED" && document.status !== "APPROVED") {
        actions.append(
          actionButton("Reject", "secondary", () => this.askReason("document", document.id)),
          actionButton("Approve", "primary", () => this.reviewDocument(document.id, "APPROVED")),
        );
      }
      row.append(main, actions);
      content.append(row);
    });
    return content;
  }

  async reviewProfile(status, reason) {
    try {
      await this.api.request(`/admin/verifications/${this.selectedId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      });
      showToast(status === "VERIFIED" ? "Professional profile approved" : status === "REJECTED" ? "Profile returned to the professional" : "Review started", "success");
      await this.load(true);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  async reviewDocument(documentId, status, reason) {
    try {
      await this.api.request(`/admin/verifications/${this.selectedId}/documents/${documentId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, ...(reason ? { reason } : {}) }),
      });
      showToast(status === "APPROVED" ? "Document approved" : "Document rejected", "success");
      await this.selectProfile(this.selectedId, false);
    } catch (error) {
      showToast(error.message, "error");
    }
  }

  askReason(kind, id) {
    this.reasonAction = { kind, id };
    byId("reason").value = "";
    byId("reason-error").textContent = "";
    byId("reason-title").textContent = kind === "profile" ? "Why is this profile being rejected?" : "Why is this document being rejected?";
    byId("reason-dialog").showModal();
  }

  async submitReason(event) {
    event.preventDefault();
    if (event.submitter?.value === "cancel") {
      byId("reason-dialog").close();
      return;
    }
    const reason = byId("reason").value.trim();
    if (reason.length < 3) {
      byId("reason-error").textContent = "Enter a clear reason.";
      return;
    }
    byId("reason-dialog").close();
    if (this.reasonAction?.kind === "profile") await this.reviewProfile("REJECTED", reason);
    else if (this.reasonAction) await this.reviewDocument(this.reasonAction.id, "REJECTED", reason);
  }
}
