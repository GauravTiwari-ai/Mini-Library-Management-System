(() => {
  "use strict";

  const STORAGE_KEY = "mini-library-demo-v1";
  const FINE_PER_DAY = 5;
  const titles = {
    dashboard: "Dashboard",
    books: "Books",
    members: "Members",
    circulation: "Circulation",
    reports: "Reports"
  };
  const reportTitles = {
    "low-stock": ["Low-stock books", "Titles at or below their configured stock threshold."],
    active: ["Active issues", "Books currently checked out by members."],
    overdue: ["Overdue books", "Active loans past their due date and estimated fine."],
    activity: ["Recent activity", "The latest issue and return events."]
  };
  const initialData = {
    books: [
      { book_id: 1, title: "The Pragmatic Programmer", author: "David Thomas and Andrew Hunt", category: "Technology", price: 42.5, total_copies: 5, available_copies: 5, low_stock_threshold: 2 },
      { book_id: 2, title: "Clean Code", author: "Robert C. Martin", category: "Technology", price: 38, total_copies: 3, available_copies: 1, low_stock_threshold: 2 },
      { book_id: 3, title: "The Alchemist", author: "Paulo Coelho", category: "Fiction", price: 16.99, total_copies: 4, available_copies: 4, low_stock_threshold: 1 },
      { book_id: 4, title: "Introduction to Algorithms", author: "Thomas H. Cormen", category: "Technology", price: 74, total_copies: 2, available_copies: 2, low_stock_threshold: 1 }
    ],
    members: [
      { member_id: 1, full_name: "Aarav Sharma", email: "aarav@example.edu", phone: "+91 98765 43210", join_date: "2025-05-14", status: "ACTIVE" },
      { member_id: 2, full_name: "Maya Patel", email: "maya@example.edu", phone: "+91 98765 43211", join_date: "2025-06-02", status: "ACTIVE" },
      { member_id: 3, full_name: "Rohan Das", email: "rohan@example.edu", phone: "+91 98765 43212", join_date: "2025-08-19", status: "INACTIVE" }
    ],
    issues: [
      { issue_id: 1, book_id: 2, title: "Clean Code", member_id: 1, full_name: "Aarav Sharma", issue_date: dateOffset(-18), due_date: dateOffset(-4), return_date: null, status: "ACTIVE", fine_amount: 0 },
      { issue_id: 2, book_id: 1, title: "The Pragmatic Programmer", member_id: 2, full_name: "Maya Patel", issue_date: dateOffset(-3), due_date: dateOffset(11), return_date: null, status: "ACTIVE", fine_amount: 0 }
    ],
    audit: [
      { audit_id: 1, issue_id: 2, action_name: "ISSUE", action_time: dateOffset(-3), details: "Book issued to member 2", title: "The Pragmatic Programmer", full_name: "Maya Patel" },
      { audit_id: 2, issue_id: 1, action_name: "ISSUE", action_time: dateOffset(-18), details: "Book issued to member 1", title: "Clean Code", full_name: "Aarav Sharma" }
    ],
    nextBookId: 5,
    nextMemberId: 4,
    nextIssueId: 3,
    nextAuditId: 3
  };

  const savedMode = localStorage.getItem("mini-library-mode");
  let mode = savedMode || "demo";
  let activeReport = "low-stock";
  let noticeTimer;
  const apiBase = location.port === "5501" ? "http://127.0.0.1:8080" : "";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const dialog = $("#record-dialog");
  const recordForm = $("#record-form");
  const state = loadDemo();

  $("#data-mode").value = mode;
  $("#data-mode").addEventListener("change", async (event) => {
    mode = event.target.value;
    localStorage.setItem("mini-library-mode", mode);
    notify(mode === "demo" ? "Demo mode selected. Changes are saved in this browser." : "Oracle database mode selected.");
    await refreshCurrentView();
  });
  $("#test-connection").addEventListener("click", testOracleConnection);

  $$(".nav-item").forEach((button) => button.addEventListener("click", () => showView(button.dataset.view)));
  $$("[data-go]").forEach((button) => button.addEventListener("click", () => {
    showView(button.dataset.go);
    if (button.dataset.report) selectReport(button.dataset.report);
  }));
  $$(".report-tab").forEach((button) => button.addEventListener("click", () => selectReport(button.dataset.report)));
  $("#add-book").addEventListener("click", () => openBookDialog());
  $("#add-member").addEventListener("click", () => openMemberDialog());
  $("#book-search").addEventListener("input", debounce(() => loadBooks(), 180));
  $("#member-search").addEventListener("input", debounce(() => loadMembers(), 180));
  $("#issue-form").addEventListener("submit", issueBook);
  recordForm.addEventListener("submit", saveRecord);

  function dateOffset(days) {
    const date = new Date();
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function loadDemo() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return saved ? { ...initialData, ...JSON.parse(saved) } : structuredClone(initialData);
    } catch (error) {
      console.error("Unable to load demo data", error);
      return structuredClone(initialData);
    }
  }

  function saveDemo() {
    if (mode === "demo") localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function notify(message, error = false) {
    const notice = $("#notice");
    notice.textContent = message;
    notice.classList.toggle("error", error);
    notice.hidden = false;
    clearTimeout(noticeTimer);
    noticeTimer = setTimeout(() => { notice.hidden = true; }, 4500);
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"
    })[character]);
  }

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${apiBase}${path}`, {
        ...options,
        headers: { "Content-Type": "application/json", ...(options.headers || {}) }
      });
    } catch (error) {
      if (error instanceof TypeError) {
        throw new Error(
          "Cannot reach the Python API at http://127.0.0.1:8080. Start the Python app with your Oracle connection settings. " +
          "For a frontend-only preview, choose Demo mode."
        );
      }
      throw error;
    }
    let payload;
    try { payload = await response.json(); } catch { payload = {}; }
    if (!response.ok) {
      if (response.status === 404 && mode === "oracle") {
        throw new Error(
          "The Python API was not found at http://127.0.0.1:8080. Start the Python app with your Oracle connection settings. " +
          "For a frontend-only preview, choose Demo mode."
        );
      }
      throw new Error(payload.error || `Request failed (${response.status}).`);
    }
    return payload;
  }

  async function testOracleConnection() {
    if (mode !== "oracle") {
      notify("Select Oracle database first, then test the connection.", true);
      return;
    }
    const button = $("#test-connection");
    button.disabled = true;
    button.textContent = "Testing...";
    try {
      const result = await request("/api/health");
      if (result.status === "ok" && result.schemaReady !== false) {
        notify(result.schemaReady === true
          ? "Oracle connection and library database objects are working."
          : "Oracle database connection is working.");
      } else {
        notify(result.message || "Oracle connected, but the library schema needs attention.", true);
      }
    } catch (error) {
      notify(error.message, true);
    } finally {
      button.disabled = false;
      button.textContent = "Test Oracle";
    }
  }

  function showView(name) {
    $$(".view").forEach((view) => view.classList.toggle("active", view.id === `view-${name}`));
    $$(".nav-item").forEach((button) => button.classList.toggle("active", button.dataset.view === name));
    $("#page-heading").textContent = titles[name] || "Dashboard";
    refreshCurrentView();
  }

  async function refreshCurrentView() {
    const current = $(".view.active")?.id.replace("view-", "") || "dashboard";
    try {
      if (current === "dashboard") await loadDashboard();
      if (current === "books") await loadBooks();
      if (current === "members") await loadMembers();
      if (current === "circulation") await loadCirculation();
      if (current === "reports") await loadReport(activeReport);
    } catch (error) {
     if (mode === "oracle") showDataUnavailable(current, error.message);
     notify(error.message, true);
    }
  }

  function showDataUnavailable(view, message) {
    const setText = (selector, text) => {
     const element = $(selector);
     if (element) element.textContent = text;
    };
    if (view === "dashboard") {
     $("#dashboard-stats").innerHTML = "";
     setText("#dashboard-activity", message);
     setText("#dashboard-low-stock", message);
     setText("#low-stock-count", "—");
    } else if (view === "books") {
     $("#books-body").innerHTML = `<tr><td colspan="6" class="empty-state"></td></tr>`;
     setText("#books-body .empty-state", message);
     setText("#books-count", "Unavailable");
    } else if (view === "members") {
     $("#members-body").innerHTML = `<tr><td colspan="5" class="empty-state"></td></tr>`;
     setText("#members-body .empty-state", message);
     setText("#members-count", "Unavailable");
    } else if (view === "circulation") {
     $("#issue-book").innerHTML = `<option value="">Database unavailable</option>`;
     $("#issue-member").innerHTML = `<option value="">Database unavailable</option>`;
     setText("#active-issue-count", "—");
     setText("#circulation-issues", message);
    } else if (view === "reports") {
     setText("#report-content", message);
    }
  }

  async function loadDashboard() {
    const [books, members, issues, activity, lowStock] = mode === "demo"
      ? [state.books, state.members, state.issues, state.audit, getLowStock(state.books)]
      : await Promise.all([
        request("/api/books"), request("/api/members"), request("/api/issues"),
        request("/api/reports?type=activity"), request("/api/reports?type=low-stock")
      ]);
    const today = dateOffset(0);
    const overdue = issues.filter((issue) => issue.status === "ACTIVE" && issue.due_date < today).length;
    const stats = mode === "demo" ? {
      totalBooks: books.reduce((sum, book) => sum + Number(book.total_copies), 0),
      registeredMembers: members.length,
      activeIssues: issues.filter((issue) => issue.status === "ACTIVE").length,
      overdueBooks: overdue
    } : await request("/api/dashboard");
    const cards = [
      ["Total books", stats.totalBooks, "Copies in collection", "▤"],
      ["Registered members", stats.registeredMembers, "All registered accounts", "♙"],
      ["Active issues", stats.activeIssues, "Currently checked out", "↗"],
      ["Overdue books", stats.overdueBooks, "Past their due date", "◷"]
    ];
    $("#dashboard-stats").innerHTML = cards.map(([label, value, foot, icon], index) =>
      `<article class="stat-card"><div class="stat-top"><span>${label}</span><span class="stat-icon">${icon}</span></div><div class="stat-value">${value}</div><div class="stat-foot">${foot}</div></article>`
    ).join("");
    $("#dashboard-activity").innerHTML = renderActivity(activity.slice(0, 5));
    $("#low-stock-count").textContent = lowStock.length;
    $("#dashboard-low-stock").innerHTML = lowStock.length
      ? lowStock.slice(0, 4).map((book) => `<div class="low-stock-row"><div><strong>${escapeHtml(book.title)}</strong><small>${escapeHtml(book.author || "")}</small></div><span class="stock-number">${book.available_copies} left</span></div>`).join("")
      : `<div class="empty-state">All titles are sufficiently stocked.</div>`;
  }

  async function loadBooks() {
    const search = $("#book-search").value.trim();
    const books = mode === "demo"
      ? state.books.filter((book) => `${book.title} ${book.author} ${book.category}`.toLowerCase().includes(search.toLowerCase()))
      : await request(`/api/books?search=${encodeURIComponent(search)}`);
    $("#books-count").textContent = `${books.length} ${books.length === 1 ? "title" : "titles"}`;
    $("#books-body").innerHTML = books.length ? books.map((book, index) => {
      const stockClass = Number(book.available_copies) === 0 ? "stock-empty" :
        Number(book.available_copies) <= Number(book.low_stock_threshold) ? "stock-low" : "stock-good";
      const stockText = Number(book.available_copies) === 0 ? "Out of stock" :
        Number(book.available_copies) <= Number(book.low_stock_threshold) ? "Low stock" : "In stock";
      return `<tr>
        <td><div class="book-cell"><span class="book-cover color-${index % 4}" aria-hidden="true">▤</span><span><span class="book-title">${escapeHtml(book.title)}</span><span class="book-meta">${escapeHtml(book.author)}</span></span></div></td>
        <td>${escapeHtml(book.category)}</td><td>${formatMoney(book.price)}</td>
        <td>${book.available_copies} <span class="muted">/ ${book.total_copies}</span></td>
        <td><span class="stock-pill ${stockClass}">${stockText}</span></td>
        <td><div class="row-actions"><button class="icon-button" data-edit-book="${book.book_id}" aria-label="Edit ${escapeHtml(book.title)}">Edit</button><button class="icon-button danger" data-delete-book="${book.book_id}" aria-label="Delete ${escapeHtml(book.title)}">Delete</button></div></td>
      </tr>`;
    }).join("") : `<tr><td colspan="6"><div class="empty-state">No books match your search.</div></td></tr>`;
    $$("[data-edit-book]").forEach((button) => button.addEventListener("click", () => {
      const book = books.find((item) => String(item.book_id) === button.dataset.editBook);
      if (book) openBookDialog(book);
    }));
    $$("[data-delete-book]").forEach((button) => button.addEventListener("click", () => deleteBook(button.dataset.deleteBook)));
  }

  async function loadMembers() {
    const search = $("#member-search").value.trim();
    const members = mode === "demo"
      ? state.members.filter((member) => `${member.full_name} ${member.email} ${member.phone}`.toLowerCase().includes(search.toLowerCase()))
      : await request(`/api/members?search=${encodeURIComponent(search)}`);
    $("#members-count").textContent = `${members.length} ${members.length === 1 ? "member" : "members"}`;
    $("#members-body").innerHTML = members.length ? members.map((member) =>
      `<tr>
        <td><div class="member-cell"><span class="avatar" aria-hidden="true">${escapeHtml(member.full_name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase())}</span><span><span class="member-name">${escapeHtml(member.full_name)}</span><span class="member-email">${escapeHtml(member.email)}</span></span></div></td>
        <td>${escapeHtml(member.phone || "—")}</td><td>${formatDate(member.join_date)}</td>
        <td><span class="status-pill ${member.status === "ACTIVE" ? "status-active" : "status-inactive"}">${escapeHtml(member.status)}</span></td>
        <td><div class="row-actions"><button class="icon-button" data-edit-member="${member.member_id}" aria-label="Edit ${escapeHtml(member.full_name)}">Edit</button><button class="icon-button danger" data-delete-member="${member.member_id}" aria-label="Delete ${escapeHtml(member.full_name)}">Delete</button></div></td>
      </tr>`
    ).join("") : `<tr><td colspan="5"><div class="empty-state">No members match your search.</div></td></tr>`;
    $$("[data-edit-member]").forEach((button) => button.addEventListener("click", () => {
      const member = members.find((item) => String(item.member_id) === button.dataset.editMember);
      if (member) openMemberDialog(member);
    }));
    $$("[data-delete-member]").forEach((button) => button.addEventListener("click", () => deleteMember(button.dataset.deleteMember)));
  }

  async function loadCirculation() {
    const [books, members, issues] = mode === "demo"
      ? [state.books, state.members, state.issues]
      : await Promise.all([request("/api/books"), request("/api/members"), request("/api/issues?status=ACTIVE")]);
    const available = books.filter((book) => Number(book.available_copies) > 0);
    $("#issue-book").innerHTML = `<option value="">Choose an available title</option>` +
      available.map((book) => `<option value="${book.book_id}">${escapeHtml(book.title)} · ${book.available_copies} available</option>`).join("");
    const activeMembers = members.filter((member) => member.status === "ACTIVE");
    $("#issue-member").innerHTML = `<option value="">Choose a member</option>` +
      activeMembers.map((member) => `<option value="${member.member_id}">${escapeHtml(member.full_name)}</option>`).join("");
    const activeIssues = issues.filter((issue) => issue.status === "ACTIVE");
    $("#active-issue-count").textContent = activeIssues.length;
    $("#circulation-issues").innerHTML = activeIssues.length ? `<div class="table-wrap"><table><thead><tr><th>Book / Member</th><th>Due date</th><th>Status</th><th></th></tr></thead><tbody>${activeIssues.map((issue) => {
      const isOverdue = issue.due_date < dateOffset(0);
      return `<tr><td><span class="book-title">${escapeHtml(issue.title)}</span><span class="book-meta">${escapeHtml(issue.full_name)}</span></td><td>${formatDate(issue.due_date)}</td><td><span class="status-pill ${isOverdue ? "status-overdue" : "status-active"}">${isOverdue ? "Overdue" : "On loan"}</span></td><td><button class="button button-secondary" data-return="${issue.issue_id}">Return</button></td></tr>`;
    }).join("")}</tbody></table></div>` : `<div class="empty-state">There are no active issues right now.</div>`;
    $$("[data-return]").forEach((button) => button.addEventListener("click", () => returnBook(button.dataset.return)));
  }

  async function loadReport(type) {
    activeReport = type;
    const [heading, description] = reportTitles[type];
    $("#report-heading").textContent = heading;
    $("#report-description").textContent = description;
    const data = mode === "demo" ? demoReport(type) : await request(`/api/reports?type=${encodeURIComponent(type)}`);
    let content;
    if (type === "low-stock") {
      content = table(["Book", "Author", "Available", "Threshold"], data.map((item) =>
        [escapeHtml(item.title), escapeHtml(item.author || "—"), item.available_copies, item.low_stock_threshold]));
    } else if (type === "active") {
      content = table(["Book", "Member", "Issue date", "Due date"], data.map((item) =>
        [escapeHtml(item.title), escapeHtml(item.full_name), formatDate(item.issue_date), formatDate(item.due_date)]));
    } else if (type === "overdue") {
      content = table(["Book", "Member", "Due date", "Days overdue", "Estimated fine"], data.map((item) =>
        [escapeHtml(item.title), escapeHtml(item.full_name), formatDate(item.due_date), item.overdue_days, formatMoney(item.estimated_fine)]));
    } else {
      content = renderActivity(data);
    }
    $("#report-content").innerHTML = data.length ? content : `<div class="empty-state">No records to show for this report.</div>`;
  }

  function table(headers, rows) {
    return `<div class="table-wrap"><table><thead><tr>${headers.map((head) => `<th>${head}</th>`).join("")}</tr></thead><tbody>${rows.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
  }

  function renderActivity(rows) {
    if (!rows.length) return `<div class="empty-state">No recent circulation activity.</div>`;
    return `<div class="activity-list">${rows.map((item) => {
      const action = String(item.action_name || "").toUpperCase();
      const actionLabel = action === "RETURN" ? "returned" : "checked out";
      const iconClass = action === "RETURN" ? "return" : "";
      return `<div class="activity-item"><span class="activity-icon ${iconClass}" aria-hidden="true">${action === "RETURN" ? "↙" : "↗"}</span><div class="activity-text"><strong>${escapeHtml(item.full_name || "Member")}</strong> ${actionLabel} <strong>${escapeHtml(item.title || "a book")}</strong><span class="activity-time">${formatDate(item.action_time || item.issue_date)} · ${action === "RETURN" ? "Returned" : "Issued"}</span></div></div>`;
    }).join("")}</div>`;
  }

  function getLowStock(books) {
    return books.filter((book) => Number(book.available_copies) <= Number(book.low_stock_threshold));
  }

  function demoReport(type) {
    if (type === "low-stock") return getLowStock(state.books);
    if (type === "active") return state.issues.filter((issue) => issue.status === "ACTIVE");
    if (type === "overdue") return state.issues.filter((issue) => issue.status === "ACTIVE" && issue.due_date < dateOffset(0))
      .map((issue) => {
        const days = Math.max(0, Math.floor((new Date(`${dateOffset(0)}T00:00:00`) - new Date(`${issue.due_date}T00:00:00`)) / 86400000));
        return { ...issue, overdue_days: days, estimated_fine: days * FINE_PER_DAY };
      });
    return state.audit.slice().sort((a, b) => String(b.action_time).localeCompare(String(a.action_time))).slice(0, 50);
  }

  function selectReport(type) {
    if (!reportTitles[type]) return;
    activeReport = type;
    $$(".report-tab").forEach((button) => {
      const selected = button.dataset.report === type;
      button.classList.toggle("active", selected);
      button.setAttribute("aria-selected", String(selected));
    });
    loadReport(type).catch((error) => notify(error.message, true));
  }

  function openBookDialog(book = null) {
    $("#dialog-eyebrow").textContent = book ? "UPDATE COLLECTION" : "NEW TITLE";
    $("#dialog-title").textContent = book ? "Edit book" : "Add a book";
    $("#dialog-description").textContent = book ? "Update the title details and copy count." : "Add a title to your library collection.";
    recordForm.dataset.kind = "book";
    recordForm.dataset.id = book ? book.book_id : "";
    recordForm.innerHTML = `
      <label for="record-title">Title</label><input id="record-title" name="title" required maxlength="200" value="${escapeHtml(book?.title || "")}">
      <label for="record-author">Author</label><input id="record-author" name="author" required maxlength="150" value="${escapeHtml(book?.author || "")}">
      <label for="record-category">Category</label><input id="record-category" name="category" required maxlength="80" value="${escapeHtml(book?.category || "")}">
      <label for="record-price">Price</label><input id="record-price" name="price" type="number" min="0" step="0.01" required value="${book ? Number(book.price) : "0.00"}">
      <label for="record-total">Total copies</label><input id="record-total" name="totalCopies" type="number" min="0" step="1" required value="${book ? book.total_copies : 1}">
      <label for="record-threshold">Low-stock threshold</label><input id="record-threshold" name="lowStockThreshold" type="number" min="0" step="1" required value="${book ? book.low_stock_threshold : 2}">
      <div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">${book ? "Save changes" : "Add book"}</button></div>`;
    $("#record-total").min = book ? String(Number(book.total_copies) - Number(book.available_copies)) : "0";
    $$("[data-cancel]", recordForm).forEach((button) => button.addEventListener("click", () => dialog.close()));
    dialog.showModal();
    $("#record-title").focus();
  }

  function openMemberDialog(member = null) {
    $("#dialog-eyebrow").textContent = member ? "MEMBER DETAILS" : "NEW MEMBER";
    $("#dialog-title").textContent = member ? "Edit member" : "Register a member";
    $("#dialog-description").textContent = "Keep member contact information up to date.";
    recordForm.dataset.kind = "member";
    recordForm.dataset.id = member ? member.member_id : "";
    recordForm.innerHTML = `
      <label for="record-name">Full name</label><input id="record-name" name="fullName" required maxlength="150" value="${escapeHtml(member?.full_name || "")}">
      <label for="record-email">Email</label><input id="record-email" name="email" type="email" required maxlength="254" value="${escapeHtml(member?.email || "")}">
      <label for="record-phone">Phone</label><input id="record-phone" name="phone" type="tel" maxlength="30" value="${escapeHtml(member?.phone || "")}">
      ${member ? `<label for="record-status">Membership status</label><select id="record-status" name="status"><option value="ACTIVE" ${member.status === "ACTIVE" ? "selected" : ""}>Active</option><option value="INACTIVE" ${member.status === "INACTIVE" ? "selected" : ""}>Inactive</option></select>` : ""}
      <div class="dialog-actions"><button class="button button-secondary" type="button" data-cancel>Cancel</button><button class="button button-primary" type="submit">${member ? "Save changes" : "Register member"}</button></div>`;
    $$("[data-cancel]", recordForm).forEach((button) => button.addEventListener("click", () => dialog.close()));
    dialog.showModal();
    $("#record-name").focus();
  }

  async function saveRecord(event) {
    event.preventDefault();
    const form = new FormData(recordForm);
    const kind = recordForm.dataset.kind;
    const id = recordForm.dataset.id;
    try {
      if (kind === "book") {
        const book = {
          title: form.get("title").trim(), author: form.get("author").trim(), category: form.get("category").trim(),
          price: Number(form.get("price")), totalCopies: Number(form.get("totalCopies")),
          lowStockThreshold: Number(form.get("lowStockThreshold"))
        };
        if (mode === "demo") saveDemoBook(book, id);
        else await request(id ? `/api/books/${id}` : "/api/books", { method: id ? "PUT" : "POST", body: JSON.stringify(book) });
      } else {
        const member = {
          fullName: form.get("fullName").trim(), email: form.get("email").trim(),
          phone: form.get("phone").trim(), status: form.get("status") || "ACTIVE"
        };
        if (mode === "demo") saveDemoMember(member, id);
        else await request(id ? `/api/members/${id}` : "/api/members", { method: id ? "PUT" : "POST", body: JSON.stringify(member) });
      }
      dialog.close();
      notify(kind === "book" ? (id ? "Book updated." : "Book added.") : (id ? "Member updated." : "Member registered."));
      await refreshCurrentView();
    } catch (error) {
      notify(error.message, true);
    }
  }

  function saveDemoBook(book, id) {
    if (book.price < 0 || book.totalCopies < 0 || book.lowStockThreshold < 0) throw new Error("Prices and copy counts cannot be negative.");
    if (id) {
      const existing = state.books.find((item) => String(item.book_id) === String(id));
      const issued = Number(existing.total_copies) - Number(existing.available_copies);
      if (book.totalCopies < issued) throw new Error("Total copies cannot be less than the number currently issued.");
      Object.assign(existing, {
        title: book.title, author: book.author, category: book.category, price: book.price,
        available_copies: book.totalCopies - issued, total_copies: book.totalCopies,
        low_stock_threshold: book.lowStockThreshold
      });
    } else {
      state.books.push({ ...book, book_id: state.nextBookId++, total_copies: book.totalCopies,
        available_copies: book.totalCopies, low_stock_threshold: book.lowStockThreshold });
    }
    saveDemo();
  }

  function saveDemoMember(member, id) {
    if (state.members.some((item) => item.email.toLowerCase() === member.email.toLowerCase() && String(item.member_id) !== String(id || ""))) {
      throw new Error("A member with this email already exists.");
    }
    if (id) Object.assign(state.members.find((item) => String(item.member_id) === String(id)), member);
    else state.members.push({ ...member, member_id: state.nextMemberId++, join_date: dateOffset(0) });
    saveDemo();
  }

  async function deleteBook(id) {
    const book = state && mode === "demo" ? state.books.find((item) => String(item.book_id) === String(id)) : null;
    if (!window.confirm(`Delete "${book?.title || "this book"}"? This action cannot be undone.`)) return;
    try {
      if (mode === "demo") {
        if (state.issues.some((item) => Number(item.book_id) === Number(id))) throw new Error("This book has issue history and cannot be deleted.");
        state.books = state.books.filter((item) => String(item.book_id) !== String(id));
        saveDemo();
      } else await request(`/api/books/${id}`, { method: "DELETE" });
      notify("Book deleted.");
      await loadBooks();
    } catch (error) { notify(error.message, true); }
  }

  async function deleteMember(id) {
    const member = state && mode === "demo" ? state.members.find((item) => String(item.member_id) === String(id)) : null;
    if (!window.confirm(`Delete "${member?.full_name || "this member"}"? This action cannot be undone.`)) return;
    try {
      if (mode === "demo") {
        if (state.issues.some((item) => Number(item.member_id) === Number(id))) throw new Error("This member has issue history and cannot be deleted.");
        state.members = state.members.filter((item) => String(item.member_id) !== String(id));
        saveDemo();
      } else await request(`/api/members/${id}`, { method: "DELETE" });
      notify("Member deleted.");
      await loadMembers();
    } catch (error) { notify(error.message, true); }
  }

  async function issueBook(event) {
    event.preventDefault();
    const bookId = Number($("#issue-book").value);
    const memberId = Number($("#issue-member").value);
    if (!bookId || !memberId) return;
    try {
      if (mode === "demo") {
        const book = state.books.find((item) => Number(item.book_id) === bookId);
        const member = state.members.find((item) => Number(item.member_id) === memberId);
        if (!book || !member) throw new Error("Book or member does not exist.");
        if (member.status !== "ACTIVE") throw new Error("Member is not active.");
        if (book.available_copies <= 0) throw new Error("No copies are currently available.");
        if (state.issues.some((item) => item.status === "ACTIVE" && Number(item.book_id) === bookId && Number(item.member_id) === memberId)) {
          throw new Error("Member already has this book issued.");
        }
        const today = dateOffset(0);
        const due = new Date(`${today}T00:00:00`);
        due.setDate(due.getDate() + 14);
        const issue = { issue_id: state.nextIssueId++, book_id: bookId, title: book.title, member_id: memberId,
          full_name: member.full_name, issue_date: today, due_date: due.toISOString().slice(0, 10), return_date: null, status: "ACTIVE", fine_amount: 0 };
        book.available_copies--;
        state.issues.unshift(issue);
        state.audit.unshift({ audit_id: state.nextAuditId++, issue_id: issue.issue_id, action_name: "ISSUE",
          action_time: today, details: `Book issued to member ${memberId}`, title: book.title, full_name: member.full_name });
        saveDemo();
      } else await request("/api/issues", { method: "POST", body: JSON.stringify({ bookId, memberId }) });
      event.target.reset();
      notify("Book issued successfully.");
      await loadCirculation();
    } catch (error) { notify(error.message, true); }
  }

  async function returnBook(id) {
    const issue = state && mode === "demo" ? state.issues.find((item) => String(item.issue_id) === String(id)) : null;
    if (!window.confirm(`Process the return${issue ? ` for "${issue.title}"` : ""}?`)) return;
    try {
      if (mode === "demo") {
        if (!issue || issue.status !== "ACTIVE") throw new Error("This issue is not active.");
        const today = dateOffset(0);
        const days = Math.max(0, Math.floor((new Date(`${today}T00:00:00`) - new Date(`${issue.due_date}T00:00:00`)) / 86400000));
        issue.status = "RETURNED";
        issue.return_date = today;
        issue.fine_amount = days * FINE_PER_DAY;
        const book = state.books.find((item) => Number(item.book_id) === Number(issue.book_id));
        if (book) book.available_copies++;
        state.audit.unshift({ audit_id: state.nextAuditId++, issue_id: issue.issue_id, action_name: "RETURN",
          action_time: today, details: `Book returned; fine=${issue.fine_amount.toFixed(2)}`, title: issue.title, full_name: issue.full_name });
        saveDemo();
        notify(issue.fine_amount ? `Return processed. Overdue fine: ${formatMoney(issue.fine_amount)}.` : "Book returned successfully.");
      } else {
        await request(`/api/issues/${id}/return`, { method: "POST", body: "{}" });
        notify("Book returned successfully.");
      }
      await loadCirculation();
    } catch (error) { notify(error.message, true); }
  }

  function formatMoney(value) {
    const number = Number(value || 0);
    return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 }).format(number);
  }

  function formatDate(value) {
    if (!value) return "—";
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? escapeHtml(value) : new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
  }

  function debounce(callback, delay) {
    let timer;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => callback(...args).catch((error) => notify(error.message, true)), delay);
    };
  }

  async function initialize() {
    if (mode === "oracle" || !savedMode) {
      try {
        const result = await request("/api/health");
        if (result.status === "ok" && result.schemaReady === true) {
          mode = "oracle";
          $("#data-mode").value = mode;
          localStorage.setItem("mini-library-mode", mode);
          if (!savedMode) notify("Connected to the Oracle library database.");
        } else {
          if (mode === "oracle") {
            mode = "demo";
            $("#data-mode").value = mode;
            localStorage.setItem("mini-library-mode", mode);
            notify(`Oracle is unavailable: ${result.message || "the library schema is not ready."} Demo mode is active; changes stay in this browser.`);
          } else {
            notify("Oracle is not ready. Demo mode is active; changes stay in this browser.");
          }
        }
      } catch (error) {
        if (mode === "oracle") {
          mode = "demo";
          $("#data-mode").value = mode;
          localStorage.setItem("mini-library-mode", mode);
        }
        notify(`Oracle is unavailable: ${error.message} Demo mode is active; changes stay in this browser.`);
      }
    }
    refreshCurrentView();
  }

  initialize();
})();
