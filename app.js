'use strict';

// ---------- Storage ----------
// Everything lives in localStorage on the device, so the app works with no connection.
const STORAGE_KEY = 'taskboard.v1';
const COLORS = ['#4f46e5', '#0ea5e9', '#10b981', '#84cc16', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#64748b'];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn('Could not read saved data', e); }
  return { projects: [], tasks: [], settings: { showDone: false } };
}

let db = load();
db.settings = db.settings || { showDone: false };

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch (e) {
    toast('Could not save — storage may be full');
  }
}

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// ---------- Dates ----------
function todayStr(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDue(due) {
  if (!due) return '';
  if (due === todayStr()) return 'Today';
  if (due === todayStr(1)) return 'Tomorrow';
  if (due === todayStr(-1)) return 'Yesterday';
  const [y, m, d] = due.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const opts = { weekday: 'short', month: 'short', day: 'numeric' };
  if (y !== new Date().getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString(undefined, opts);
}

// ---------- Helpers ----------
const $ = (sel) => document.querySelector(sel);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const projectById = (id) => db.projects.find((p) => p.id === id);

function sortTasks(list) {
  return list.slice().sort((a, b) =>
    (a.status === 'done') - (b.status === 'done') ||
    (b.status === 'doing') - (a.status === 'doing') ||
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    (a.due || '9999').localeCompare(b.due || '9999') ||
    a.created - b.created
  );
}

function visible(list) {
  return db.settings.showDone ? list : list.filter((t) => t.status !== 'done');
}

// ---------- UI state ----------
const ui = { view: 'today', projectId: null, query: '' };

// ---------- Rendering ----------
const CHECK_SVG = '<svg viewBox="0 0 24 24"><path d="m5 12 5 5 9-10"/></svg>';

function taskRow(t, { hideProject = false } = {}) {
  const p = projectById(t.projectId);
  const today = todayStr();
  const meta = [];
  if (t.status === 'doing') meta.push('<span class="status-doing">In progress</span>');
  if (t.due) meta.push(`<span class="${t.due < today && t.status !== 'done' ? 'due-overdue' : ''}">${esc(formatDue(t.due))}</span>`);
  if (t.priority !== 'low') meta.push(`<span class="prio-${t.priority}">${t.priority === 'high' ? '!!! High' : '!! Medium'}</span>`);
  if (p && !hideProject) meta.push(`<span class="tag"><i class="dot" style="background:${p.color}"></i>${esc(p.name)}</span>`);
  if (t.notes) meta.push('<span>📝</span>');
  return `
    <div class="task ${t.status}" data-id="${t.id}">
      <button class="check" data-action="toggle" aria-label="Mark ${t.status === 'done' ? 'not done' : 'done'}">${CHECK_SVG}</button>
      <div class="task-body" data-action="edit">
        <div class="task-title">${esc(t.title)}</div>
        ${meta.length ? `<div class="task-meta">${meta.join('')}</div>` : ''}
      </div>
    </div>`;
}

function section(title, tasks, opts = {}) {
  if (!tasks.length) return '';
  return `
    <div class="section-title ${opts.cls || ''}"><span>${esc(title)}</span><span>${tasks.length}</span></div>
    <div class="list">${sortTasks(tasks).map((t) => taskRow(t, opts)).join('')}</div>`;
}

function empty(title, sub) {
  return `<div class="empty"><b>${esc(title)}</b>${esc(sub)}</div>`;
}

function renderToday() {
  const today = todayStr();
  const open = db.tasks.filter((t) => t.status !== 'done');
  const overdue = open.filter((t) => t.due && t.due < today);
  const dueToday = db.tasks.filter((t) => t.due === today && (t.status !== 'done' || db.settings.showDone));
  const doing = open.filter((t) => t.status === 'doing' && !(t.due && t.due <= today));
  const doneToday = db.tasks.filter((t) => t.status === 'done' && t.completedOn === today).length;

  let html = `
    <div class="stats">
      <div class="stat ${overdue.length ? 'warn' : ''}"><b>${overdue.length}</b><span>Overdue</span></div>
      <div class="stat"><b>${dueToday.filter((t) => t.status !== 'done').length}</b><span>Due today</span></div>
      <div class="stat"><b>${doneToday}</b><span>Done today</span></div>
    </div>`;
  const body = section('Overdue', overdue, { cls: 'overdue' }) + section('Today', dueToday) + section('In progress', doing);
  html += body || empty('All clear for today', 'Tap + to add a task, or check Upcoming.');
  return html;
}

function renderUpcoming() {
  const today = todayStr();
  const future = visible(db.tasks.filter((t) => t.due && t.due > today));
  const byDate = {};
  future.forEach((t) => (byDate[t.due] = byDate[t.due] || []).push(t));
  let html = Object.keys(byDate).sort().map((d) => section(formatDue(d), byDate[d])).join('');
  html += section('No due date', visible(db.tasks.filter((t) => !t.due)));
  return html || empty('Nothing upcoming', 'Tasks with future due dates show up here.');
}

function renderProjects() {
  if (ui.projectId) return renderProjectDetail(ui.projectId);
  let html = '';
  if (db.projects.length) {
    html += '<div class="list">' + db.projects.map((p) => {
      const tasks = db.tasks.filter((t) => t.projectId === p.id);
      const done = tasks.filter((t) => t.status === 'done').length;
      const open = tasks.length - done;
      const pct = tasks.length ? Math.round((done / tasks.length) * 100) : 0;
      const overdue = tasks.filter((t) => t.status !== 'done' && t.due && t.due < todayStr()).length;
      return `
        <button class="project-card" data-action="open-project" data-pid="${p.id}">
          <i class="swatch" style="background:${p.color}"></i>
          <div class="info">
            <div class="name">${esc(p.name)}</div>
            <div class="sub">${open} open · ${done} done${overdue ? ` · <span class="due-overdue">${overdue} overdue</span>` : ''}</div>
            <div class="progress"><i style="width:${pct}%;background:${p.color}"></i></div>
          </div>
          <span class="chev">›</span>
        </button>`;
    }).join('') + '</div>';
  } else {
    html += empty('No projects yet', 'Create one for each thing you are working on.');
  }
  html += '<button class="add-project" data-action="new-project">+ New project</button>';
  return html;
}

function renderProjectDetail(pid) {
  const p = projectById(pid);
  if (!p) { ui.projectId = null; return renderProjects(); }
  const tasks = db.tasks.filter((t) => t.projectId === pid);
  const opts = { hideProject: true };
  let html = `
    <div class="project-header">
      <button class="back-btn" data-action="back">‹ Projects</button>
      <button class="edit" data-action="edit-project" data-pid="${p.id}">Edit</button>
    </div>`;
  const body =
    section('In progress', tasks.filter((t) => t.status === 'doing'), opts) +
    section('To do', tasks.filter((t) => t.status === 'todo'), opts) +
    (db.settings.showDone ? section('Done', tasks.filter((t) => t.status === 'done'), opts) : '');
  html += body || empty('No open tasks', 'Tap + to add one to this project.');
  return html;
}

function renderAll() {
  const tasks = visible(db.tasks);
  let html = db.projects.map((p) => section(p.name, tasks.filter((t) => t.projectId === p.id), { hideProject: true })).join('');
  html += section('No project', tasks.filter((t) => !projectById(t.projectId)));
  return html || empty('No tasks yet', 'Tap + to add your first task.');
}

function renderSearch() {
  const q = ui.query.toLowerCase();
  const hits = db.tasks.filter((t) => {
    const p = projectById(t.projectId);
    return [t.title, t.notes, p && p.name].some((s) => s && s.toLowerCase().includes(q));
  });
  return section(`Results for “${ui.query}”`, hits) || empty('No matches', 'Try a different word.');
}

const TITLES = { today: 'Today', upcoming: 'Upcoming', projects: 'Projects', all: 'All tasks' };

function render() {
  const main = $('#main');
  if (ui.query) {
    $('#viewTitle').textContent = 'Search';
    main.innerHTML = renderSearch();
    return;
  }
  const p = ui.view === 'projects' && ui.projectId && projectById(ui.projectId);
  $('#viewTitle').textContent = p ? p.name : TITLES[ui.view];
  main.innerHTML = { today: renderToday, upcoming: renderUpcoming, projects: renderProjects, all: renderAll }[ui.view]();
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.view === ui.view));
}

// ---------- Task actions ----------
function toggleTask(id) {
  const t = db.tasks.find((x) => x.id === id);
  if (!t) return;
  const prev = { status: t.status, completedOn: t.completedOn };
  if (t.status === 'done') {
    t.status = 'todo';
    t.completedOn = null;
  } else {
    t.status = 'done';
    t.completedOn = todayStr();
  }
  t.updated = Date.now();
  save();
  render();
  if (t.status === 'done') {
    toast('Task completed', () => { Object.assign(t, prev); save(); render(); });
  }
}

const taskDialog = $('#taskDialog');
const taskForm = $('#taskForm');
let editingTaskId = null;

function fillProjectSelect(select, selected) {
  select.innerHTML = '<option value="">No project</option>' +
    db.projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join('');
  select.value = selected || '';
}

function openTask(id) {
  const t = id ? db.tasks.find((x) => x.id === id) : null;
  editingTaskId = t ? t.id : null;
  $('#taskDialogTitle').textContent = t ? 'Edit task' : 'New task';
  $('#deleteTaskBtn').hidden = !t;
  // New tasks default to the open project, and to today when added from the Today tab.
  const defaults = {
    title: '', notes: '', priority: 'medium', status: 'todo',
    projectId: ui.view === 'projects' ? ui.projectId : '',
    due: ui.view === 'today' ? todayStr() : '',
  };
  const v = t || defaults;
  taskForm.title.value = v.title;
  fillProjectSelect(taskForm.projectId, v.projectId);
  taskForm.due.value = v.due || '';
  taskForm.priority.value = v.priority;
  taskForm.querySelector(`input[name="status"][value="${v.status}"]`).checked = true;
  taskForm.notes.value = v.notes || '';
  taskDialog.showModal();
  if (!t) setTimeout(() => taskForm.title.focus(), 50);
}

taskForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const data = {
    title: taskForm.title.value.trim(),
    projectId: taskForm.projectId.value || null,
    due: taskForm.due.value || null,
    priority: taskForm.priority.value,
    status: taskForm.querySelector('input[name="status"]:checked').value,
    notes: taskForm.notes.value.trim(),
    updated: Date.now(),
  };
  if (!data.title) return;
  if (editingTaskId) {
    const t = db.tasks.find((x) => x.id === editingTaskId);
    if (data.status === 'done' && t.status !== 'done') data.completedOn = todayStr();
    if (data.status !== 'done') data.completedOn = null;
    Object.assign(t, data);
  } else {
    db.tasks.push({ id: uid(), created: Date.now(), completedOn: data.status === 'done' ? todayStr() : null, ...data });
  }
  save();
  taskDialog.close();
  render();
});

$('#deleteTaskBtn').addEventListener('click', () => {
  const idx = db.tasks.findIndex((x) => x.id === editingTaskId);
  if (idx < 0) return;
  const [removed] = db.tasks.splice(idx, 1);
  save();
  taskDialog.close();
  render();
  toast('Task deleted', () => { db.tasks.splice(idx, 0, removed); save(); render(); });
});

// ---------- Project actions ----------
const projectDialog = $('#projectDialog');
const projectForm = $('#projectForm');
let editingProjectId = null;
let chosenColor = COLORS[0];

function renderSwatches() {
  $('#swatches').innerHTML = COLORS.map((c) =>
    `<button type="button" data-color="${c}" class="${c === chosenColor ? 'selected' : ''}" style="background:${c}" aria-label="Color ${c}"></button>`
  ).join('');
}

$('#swatches').addEventListener('click', (e) => {
  const b = e.target.closest('[data-color]');
  if (!b) return;
  chosenColor = b.dataset.color;
  renderSwatches();
});

function openProject(id) {
  const p = id ? projectById(id) : null;
  editingProjectId = p ? p.id : null;
  $('#projectDialogTitle').textContent = p ? 'Edit project' : 'New project';
  $('#deleteProjectBtn').hidden = !p;
  projectForm.name.value = p ? p.name : '';
  chosenColor = p ? p.color : COLORS[db.projects.length % COLORS.length];
  renderSwatches();
  projectDialog.showModal();
  if (!p) setTimeout(() => projectForm.name.focus(), 50);
}

projectForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const name = projectForm.name.value.trim();
  if (!name) return;
  if (editingProjectId) {
    Object.assign(projectById(editingProjectId), { name, color: chosenColor });
  } else {
    db.projects.push({ id: uid(), name, color: chosenColor, created: Date.now() });
  }
  save();
  projectDialog.close();
  render();
});

$('#deleteProjectBtn').addEventListener('click', () => {
  const p = projectById(editingProjectId);
  const count = db.tasks.filter((t) => t.projectId === p.id).length;
  if (!confirm(`Delete “${p.name}” and its ${count} task${count === 1 ? '' : 's'}?`)) return;
  db.projects = db.projects.filter((x) => x.id !== p.id);
  db.tasks = db.tasks.filter((t) => t.projectId !== p.id);
  ui.projectId = null;
  save();
  projectDialog.close();
  render();
});

// ---------- Settings, backup ----------
const settingsDialog = $('#settingsDialog');

$('#settingsBtn').addEventListener('click', async () => {
  $('#showDoneToggle').checked = db.settings.showDone;
  const info = $('#storageInfo');
  info.textContent = `${db.tasks.length} tasks in ${db.projects.length} projects, saved on this device.`;
  if (navigator.storage && navigator.storage.persisted) {
    const persisted = await navigator.storage.persisted();
    info.textContent += persisted ? ' Storage is protected from automatic clearing.' : ' Export a backup now and then to be safe.';
  }
  settingsDialog.showModal();
});

$('#showDoneToggle').addEventListener('change', (e) => {
  db.settings.showDone = e.target.checked;
  save();
  render();
});

$('#exportBtn').addEventListener('click', async () => {
  const json = JSON.stringify({ app: 'taskboard', version: 1, exported: new Date().toISOString(), ...db }, null, 2);
  const name = `taskboard-backup-${todayStr()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  // On iPhone the share sheet lets you save to Files, AirDrop, or email it to yourself.
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: 'Taskboard backup' }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

$('#importInput').addEventListener('change', async (e) => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.tasks) || !Array.isArray(data.projects)) throw new Error('bad file');
    if (!confirm(`Replace current data with ${data.tasks.length} tasks and ${data.projects.length} projects from the backup?`)) return;
    db = { projects: data.projects, tasks: data.tasks, settings: data.settings || { showDone: false } };
    save();
    settingsDialog.close();
    ui.projectId = null;
    render();
    toast('Backup imported');
  } catch {
    toast('That file is not a Taskboard backup');
  }
});

// ---------- Global events ----------
document.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
// Tap outside a sheet to close it.
document.querySelectorAll('dialog').forEach((d) => d.addEventListener('click', (e) => { if (e.target === d) d.close(); }));

$('#main').addEventListener('click', (e) => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const id = el.closest('[data-id]')?.dataset.id;
  switch (el.dataset.action) {
    case 'toggle': toggleTask(id); break;
    case 'edit': openTask(id); break;
    case 'open-project': ui.projectId = el.dataset.pid; render(); window.scrollTo(0, 0); break;
    case 'back': ui.projectId = null; render(); break;
    case 'new-project': openProject(); break;
    case 'edit-project': openProject(el.dataset.pid); break;
  }
});

document.querySelectorAll('.tabbar button').forEach((b) => b.addEventListener('click', () => {
  ui.view = b.dataset.view;
  ui.projectId = null;
  ui.query = '';
  $('#searchInput').value = '';
  $('#searchbar').hidden = true;
  render();
  window.scrollTo(0, 0);
}));

$('#addBtn').addEventListener('click', () => openTask());

$('#searchBtn').addEventListener('click', () => {
  const bar = $('#searchbar');
  bar.hidden = !bar.hidden;
  if (bar.hidden) { ui.query = ''; $('#searchInput').value = ''; render(); }
  else $('#searchInput').focus();
});
$('#searchInput').addEventListener('input', (e) => { ui.query = e.target.value.trim(); render(); });

// ---------- Toast ----------
let toastTimer;
function toast(msg, undo) {
  const el = $('#toast');
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button>Undo</button>' : ''}`;
  el.hidden = false;
  if (undo) el.querySelector('button').onclick = () => { undo(); el.hidden = true; };
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 4000);
}

// ---------- Online / offline ----------
function updateOnline() { $('#offlinePill').hidden = navigator.onLine; }
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);
updateOnline();

// Re-render when the app comes back to the foreground so "Today" is correct after midnight.
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });

// ---------- Offline support ----------
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW failed', e)));
}
// Ask the browser not to clear our data under storage pressure.
if (navigator.storage && navigator.storage.persist) navigator.storage.persist();

// ---------- First run ----------
if (!db.projects.length && !db.tasks.length && !localStorage.getItem(STORAGE_KEY)) {
  const pid = uid();
  db.projects.push({ id: pid, name: 'Getting started', color: COLORS[0], created: Date.now() });
  [
    ['Add this app to your Home Screen', 'high', todayStr()],
    ['Create a project for each thing you work on', 'medium', todayStr()],
    ['Export a backup from Settings (⋯)', 'low', todayStr(7)],
  ].forEach(([title, priority, due], i) =>
    db.tasks.push({ id: uid(), title, priority, due, projectId: pid, status: 'todo', notes: '', created: Date.now() + i, updated: Date.now(), completedOn: null })
  );
  save();
}

render();
