/**
 * TaskFlow — Dashboard JavaScript
 * Handles: task CRUD via Fetch API, filtering, search, inline editing, toast UI
 */

"use strict";

/* ─── Utility: Toast Notification ──────────────────────────── */
const toast = (() => {
  const el = document.getElementById("toast");
  let timer;

  return function show(msg, duration = 2600) {
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(timer);
    timer = setTimeout(() => el.classList.remove("show"), duration);
  };
})();

/* ─── Utility: Format date for display ─────────────────────── */
function formatDate(dateStr) {
  if (!dateStr) return null;
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function isOverdue(dateStr) {
  if (!dateStr) return false;
  const due = new Date(dateStr + "T23:59:59");
  return due < new Date();
}

/* ─── Utility: Priority badge HTML ─────────────────────────── */
function priorityBadge(p) {
  const dot = { high: "🔴", medium: "🟡", low: "🟢" }[p] || "";
  return `<span class="badge badge-${p}">${dot} ${p}</span>`;
}

/* ─── State ─────────────────────────────────────────────────── */
let currentFilter = "all";   // all | pending | completed
let searchQuery   = "";

/* ─── Build a task card DOM element ────────────────────────── */
function buildTaskCard(t) {
  const li       = document.createElement("li");
  li.className   = `task-card${t.status === "completed" ? " completed" : ""}`;
  li.dataset.id  = t.id;
  li.dataset.status   = t.status;
  li.dataset.priority = t.priority || "medium";
  li.dataset.task     = (t.task || "").toLowerCase();

  const overdue   = isOverdue(t.due_date) && t.status !== "completed";
  const dateHtml  = t.due_date
    ? `<span class="due-date${overdue ? " overdue" : ""}">
         <svg width="11" height="11" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
           <rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>
         </svg>
         ${overdue ? "Overdue · " : ""}${formatDate(t.due_date)}
       </span>`
    : "";

  li.innerHTML = `
    <div class="task-check${t.status === "completed" ? " checked" : ""}" title="Toggle complete"></div>
    <div class="task-body">
      <div class="task-text">${escapeHtml(t.task)}</div>
      <div class="task-meta">
        ${priorityBadge(t.priority || "medium")}
        ${dateHtml}
      </div>
    </div>
    <div class="task-actions">
      <button class="btn btn-icon btn-edit" title="Edit">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
        </svg>
      </button>
      <button class="btn btn-icon btn-icon btn-danger-icon btn-delete" title="Delete">
        <svg width="14" height="14" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
          <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/>
          <path d="M10 11v6M14 11v6"/><path d="M9 6V4h6v2"/>
        </svg>
      </button>
    </div>
  `;

  /* ── Toggle complete ── */
  li.querySelector(".task-check").addEventListener("click", () => toggleTask(li, t));

  /* ── Delete ── */
  li.querySelector(".btn-delete").addEventListener("click", () => deleteTask(li, t.id));

  /* ── Edit ── */
  li.querySelector(".btn-edit").addEventListener("click", () => startEdit(li, t));

  return li;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* ─── Render / Filter helpers ───────────────────────────────── */
function renderVisibility() {
  const cards = document.querySelectorAll(".task-card");
  let visible = 0;

  cards.forEach(card => {
    const matchFilter =
      currentFilter === "all" ||
      card.dataset.status === currentFilter;

    const matchSearch =
      !searchQuery ||
      card.dataset.task.includes(searchQuery);

    const show = matchFilter && matchSearch;
    card.style.display = show ? "" : "none";
    if (show) visible++;
  });

  document.getElementById("empty-state").style.display = visible === 0 ? "block" : "none";
}

function updateStats(delta = {}) {
  const totalEl    = document.getElementById("stat-total");
  const completedEl = document.getElementById("stat-completed");
  const pendingEl  = document.getElementById("stat-pending");

  let total     = parseInt(totalEl.textContent)     + (delta.total     || 0);
  let completed = parseInt(completedEl.textContent) + (delta.completed || 0);
  let pending   = parseInt(pendingEl.textContent)   + (delta.pending   || 0);

  totalEl.textContent     = Math.max(0, total);
  completedEl.textContent = Math.max(0, completed);
  pendingEl.textContent   = Math.max(0, pending);
}

/* ─── API: Create Task ───────────────────────────────────────── */
async function createTask(payload) {
  const res  = await fetch("/api/tasks", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload)
  });
  return res.json();
}

/* ─── API: Update Task ───────────────────────────────────────── */
async function updateTask(id, payload) {
  const res = await fetch(`/api/tasks/${id}`, {
    method:  "PUT",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(payload)
  });
  return res.json();
}

/* ─── API: Delete Task ───────────────────────────────────────── */
async function apiDeleteTask(id) {
  const res = await fetch(`/api/tasks/${id}`, { method: "DELETE" });
  return res.json();
}

/* ─── Action: Toggle Complete ───────────────────────────────── */
async function toggleTask(card, t) {
  const newStatus = t.status === "completed" ? "pending" : "completed";
  const result    = await updateTask(t.id, { status: newStatus });

  if (result.success) {
    t.status = newStatus;
    card.dataset.status = newStatus;

    card.classList.toggle("completed", newStatus === "completed");
    card.querySelector(".task-check").classList.toggle("checked", newStatus === "completed");

    const delta = newStatus === "completed"
      ? { completed: 1, pending: -1 }
      : { completed: -1, pending: 1 };
    updateStats(delta);

    renderVisibility();
    toast(newStatus === "completed" ? "✓ Task completed!" : "↩ Task reopened");
  }
}

/* ─── Action: Delete ─────────────────────────────────────────── */
async function deleteTask(card, id) {
  const wasDone = card.dataset.status === "completed";
  const result  = await apiDeleteTask(id);

  if (result.success) {
    card.style.opacity = "0";
    card.style.transform = "scale(.96)";
    card.style.transition = "all .25s ease";
    setTimeout(() => card.remove(), 250);

    updateStats({
      total:     -1,
      completed: wasDone ? -1 : 0,
      pending:   wasDone ? 0  : -1
    });

    renderVisibility();
    toast("🗑 Task deleted");
  }
}

/* ─── Action: Inline Edit ────────────────────────────────────── */
function startEdit(card, t) {
  const taskBody  = card.querySelector(".task-body");
  const taskText  = taskBody.querySelector(".task-text");
  const taskMeta  = taskBody.querySelector(".task-meta");

  // Replace text with an input
  const input = document.createElement("input");
  input.type      = "text";
  input.value     = t.task;
  input.className = "edit-input";

  taskText.replaceWith(input);
  taskMeta.style.display = "none";
  input.focus();
  input.select();

  async function commitEdit() {
    const newText = input.value.trim();
    if (!newText || newText === t.task) {
      cancelEdit();
      return;
    }

    await updateTask(t.id, { task: newText });
    t.task = newText;
    card.dataset.task = newText.toLowerCase();

    // Restore text node
    const newTextEl = document.createElement("div");
    newTextEl.className = "task-text";
    newTextEl.textContent = newText;
    input.replaceWith(newTextEl);
    taskMeta.style.display = "";
    toast("✏ Task updated");
  }

  function cancelEdit() {
    const orig = document.createElement("div");
    orig.className = "task-text";
    orig.textContent = t.task;
    input.replaceWith(orig);
    taskMeta.style.display = "";
  }

  input.addEventListener("blur", commitEdit);
  input.addEventListener("keydown", e => {
    if (e.key === "Enter") { input.blur(); }
    if (e.key === "Escape") { input.removeEventListener("blur", commitEdit); cancelEdit(); }
  });
}

/* ─── Init: Add Task Form ────────────────────────────────────── */
function initAddTaskForm() {
  const form     = document.getElementById("add-task-form");
  const input    = document.getElementById("task-input");
  const dateInp  = document.getElementById("task-due");
  const prioSel  = document.getElementById("task-priority");
  const taskList = document.getElementById("task-list");

  form.addEventListener("submit", async e => {
    e.preventDefault();
    const text = input.value.trim();
    if (!text) { input.focus(); return; }

    const payload = {
      task:     text,
      due_date: dateInp.value,
      priority: prioSel.value
    };

    const newTask = await createTask(payload);
    if (newTask.error) { toast("⚠ " + newTask.error); return; }

    const card = buildTaskCard(newTask);
    taskList.prepend(card);
    updateStats({ total: 1, pending: 1 });
    renderVisibility();

    // Reset inputs
    input.value    = "";
    dateInp.value  = "";
    prioSel.value  = "medium";
    input.focus();
    toast("✅ Task added!");
  });
}

/* ─── Init: Filter Buttons ───────────────────────────────────── */
function initFilters() {
  document.querySelectorAll(".filter-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      currentFilter = btn.dataset.filter;
      document.querySelectorAll(".filter-btn").forEach(b => b.classList.remove("active"));
      btn.classList.add("active");
      renderVisibility();
    });
  });
}

/* ─── Init: Search ───────────────────────────────────────────── */
function initSearch() {
  document.getElementById("search-input").addEventListener("input", e => {
    searchQuery = e.target.value.toLowerCase().trim();
    renderVisibility();
  });
}

/* ─── Init: Mobile Sidebar ───────────────────────────────────── */
function initMobileSidebar() {
  const sidebar  = document.getElementById("sidebar");
  const overlay  = document.getElementById("sidebar-overlay");
  const openBtn  = document.getElementById("menu-open");
  const closeBtn = document.getElementById("menu-close");

  function open()  { sidebar.classList.add("open");  overlay.classList.add("show"); }
  function close() { sidebar.classList.remove("open"); overlay.classList.remove("show"); }

  openBtn .addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  overlay .addEventListener("click", close);
}

/* ─── Bootstrap ──────────────────────────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  initAddTaskForm();
  initFilters();
  initSearch();
  initMobileSidebar();
  renderVisibility();   // Apply initial filter (all) to hide empty state only when 0 tasks
});
