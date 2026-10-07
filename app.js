'use strict';

/* ===== 1. 상태 ===== */
const STORAGE_KEY = 'todo-app:v1';
const BACKUP_KEY = 'todo-app:v1:backup';
const MAX_TEXT_LENGTH = 100;
const UNDO_TIMEOUT_MS = 5000;
const CATEGORIES = { work: '업무', personal: '개인', study: '공부' };

const state = {
  todos: [],
  settings: { filter: 'all', lastCategory: 'work' },
};

// UI 전용 상태 (저장하지 않음)
let lastDeleted = null;
let undoTimer = null;
let editingId = null;
let saveFailed = false; // true면 "저장되지 않습니다" 배너 표시

/* ===== 2. 저장소 ===== */
function load() {
  let raw;
  try {
    // 쓰기까지 되는지 시험해서, 저장할 수 없는 환경이면 시작부터 안내한다
    localStorage.setItem(`${STORAGE_KEY}:probe`, '1');
    localStorage.removeItem(`${STORAGE_KEY}:probe`);
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    saveFailed = true;
    return; // localStorage 접근 불가: 빈 상태로 시작
  }
  if (raw === null) return;

  let data = null;
  try {
    data = JSON.parse(raw);
  } catch {}
  if (!Array.isArray(data?.todos)) {
    // 읽을 수 없는 원본은 덮어쓰기 전에 백업 키에 보관한다
    try {
      localStorage.setItem(BACKUP_KEY, raw);
    } catch {}
    return;
  }

  state.todos = data.todos.map(normalizeTodo).filter(Boolean);
  const { filter, lastCategory } = data.settings ?? {};
  state.settings = {
    filter: filter === 'all' || isCategory(filter) ? filter : 'all',
    lastCategory: isCategory(lastCategory) ? lastCategory : 'work',
  };
}

// id·text가 없는 항목은 버리고, 나머지 필드는 허용값으로 보정한다
function normalizeTodo(item) {
  if (typeof item?.id !== 'string' || typeof item.text !== 'string') return null;
  const text = cleanText(item.text);
  if (!text) return null;

  const done = item.done === true;
  return {
    id: item.id,
    text,
    category: isCategory(item.category) ? item.category : 'work',
    done,
    createdAt: Number.isFinite(item.createdAt) ? item.createdAt : Date.now(),
    completedAt: done && Number.isFinite(item.completedAt) ? item.completedAt : null,
  };
}

function save() {
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({ version: 1, todos: state.todos, settings: state.settings })
    );
    saveFailed = false;
  } catch {
    saveFailed = true;
  }
}

/* ===== 3. 액션 ===== */
// 모든 액션은 state 변경 → commit()(save + render) 순서로 끝난다
function commit() {
  save();
  render();
}

function findTodo(id) {
  return state.todos.find((t) => t.id === id);
}

// 추가에 성공하면 true를 돌려준다 (입력창 비우기 여부 판단용)
function addTodo(text, category) {
  const cleaned = cleanText(text);
  if (!cleaned) return false;

  state.todos.push({
    id: crypto.randomUUID(),
    text: cleaned,
    category,
    done: false,
    createdAt: Date.now(),
    completedAt: null,
  });
  commit();
  return true;
}

function deleteTodo(id) {
  const todo = findTodo(id);
  if (!todo) return;

  lastDeleted = todo;
  state.todos = state.todos.filter((t) => t.id !== id);
  clearTimeout(undoTimer);
  undoTimer = setTimeout(dismissUndo, UNDO_TIMEOUT_MS);
  commit();
}

function undoDelete() {
  if (!lastDeleted) return;
  state.todos.push(lastDeleted);
  clearTimeout(undoTimer);
  lastDeleted = null;
  commit();
}

function dismissUndo() {
  lastDeleted = null;
  render();
}

function toggleTodo(id) {
  const todo = findTodo(id);
  if (!todo) return;
  todo.done = !todo.done;
  todo.completedAt = todo.done ? Date.now() : null;
  commit();
}

function startEdit(id) {
  editingId = id;
  render();
  focusEditInput();
}

// 빈 내용이면 저장하지 않고 원래 내용으로 돌아간다
function updateTodo(id, { text, category }) {
  if (editingId !== id) return; // Enter 저장 직후의 blur 등 중복 호출 무시
  editingId = null;

  const todo = findTodo(id);
  const cleaned = cleanText(text);
  if (todo && cleaned) {
    todo.text = cleaned;
    if (isCategory(category)) todo.category = category;
  }
  commit();
}

function cancelEdit() {
  editingId = null;
  render();
}

function setLastCategory(category) {
  if (!isCategory(category)) return;
  state.settings.lastCategory = category;
  commit();
}

// 카테고리 필터를 고르면 입력 카테고리 기본값도 그 카테고리로 맞춘다
function setFilter(filter) {
  if (filter !== 'all' && !isCategory(filter)) return;
  state.settings.filter = filter;
  if (filter !== 'all') state.settings.lastCategory = filter;
  commit();
}

function clearCompleted() {
  state.todos = state.todos.filter((t) => !t.done);
  commit();
}

/* ===== 4. 계산 ===== */
// in 연산자는 "toString" 같은 상속 속성도 통과시키므로 자기 속성만 확인한다
function isCategory(value) {
  return Object.hasOwn(CATEGORIES, value);
}

function cleanText(text) {
  return text.trim().slice(0, MAX_TEXT_LENGTH);
}

// 현재 필터에 맞는 항목만, 미완료가 위·완료가 아래, 각 그룹 안에서는 최신순
function getVisibleTodos() {
  const { filter } = state.settings;
  return state.todos
    .filter((t) => filter === 'all' || t.category === filter)
    .sort((a, b) => a.done - b.done || b.createdAt - a.createdAt);
}

// category를 주면 그 카테고리만, 없으면 전체 기준 (필터와 무관)
function getProgress(category) {
  const todos = category ? state.todos.filter((t) => t.category === category) : state.todos;
  const total = todos.length;
  const done = todos.filter((t) => t.done).length;
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return { done, total, percent };
}

/* ===== 5. 렌더링 ===== */
const $ = (selector) => document.querySelector(selector);
const els = {
  saveWarning: $('#save-warning'),
  today: $('#today'),
  progressText: $('#progress-text'),
  progressBar: $('#progress-bar'),
  allDone: $('#all-done'),
  form: $('#todo-form'),
  input: $('#todo-input'),
  category: $('#todo-category'),
  filters: $('#filters'),
  list: $('#todo-list'),
  clearCompleted: $('#clear-completed'),
  toast: $('#toast'),
  undoButton: $('#undo-button'),
};

function render() {
  const focused = document.activeElement;
  els.today.textContent = new Date().toLocaleDateString('ko-KR', {
    year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
  });
  els.saveWarning.hidden = !saveFailed;
  els.category.value = state.settings.lastCategory;
  renderProgress();
  renderFilters();
  renderList();

  const doneCount = getProgress().done;
  els.clearCompleted.hidden = doneCount === 0;
  els.clearCompleted.textContent = `완료 항목 지우기 (${doneCount})`;
  els.toast.hidden = !lastDeleted;

  // 포커스가 있던 버튼(실행 취소, 완료 항목 지우기)이 숨겨지면 입력창으로 옮긴다
  if (focused?.closest('[hidden]')) els.input.focus();
}

function renderProgress() {
  const { done, total, percent } = getProgress();
  els.progressText.textContent = `완료 ${done} / 전체 ${total} (${percent}%)`;
  setBar(els.progressBar, percent);
  els.allDone.hidden = !(total > 0 && done === total);

  // 할 일이 0개인 카테고리는 0%가 아니라 "할 일 없음"으로 표시한다
  for (const category of Object.keys(CATEGORIES)) {
    const p = getProgress(category);
    const row = $(`[data-progress="${category}"]`);
    const text = p.total === 0 ? '할 일 없음' : `완료 ${p.done} / 전체 ${p.total} (${p.percent}%)`;
    row.querySelector('.category-progress-text').textContent = text;
    setBar(row.querySelector('[role="progressbar"]'), p.percent, text);
  }
}

function setBar(bar, percent, valueText) {
  bar.firstElementChild.style.width = `${percent}%`;
  bar.setAttribute('aria-valuenow', percent);
  if (valueText) bar.setAttribute('aria-valuetext', valueText);
}

function renderFilters() {
  for (const button of els.filters.querySelectorAll('[data-filter]')) {
    const { filter } = button.dataset;
    const remaining = state.todos.filter((t) => !t.done && (filter === 'all' || t.category === filter));
    button.querySelector('[data-count]').textContent = remaining.length;
    button.setAttribute('aria-pressed', filter === state.settings.filter);
  }
}

// 목록을 통째로 다시 그리므로, 그리기 전 포커스 위치를 기억했다가 복원한다
function renderList() {
  const focus = getListFocus();
  const todos = getVisibleTodos();
  if (todos.length === 0) {
    const message = state.todos.length === 0 ? '오늘 할 일을 추가해보세요' : '이 카테고리에는 할 일이 없어요';
    els.list.replaceChildren(h('li', { className: 'empty' }, message));
  } else {
    els.list.replaceChildren(
      ...todos.map((todo) => (todo.id === editingId ? createEditItem(todo) : createTodoItem(todo)))
    );
  }
  if (focus) restoreListFocus(focus);
}

function getListFocus() {
  const active = document.activeElement;
  const li = active?.closest('#todo-list li');
  if (!li) return null;
  return {
    id: li.dataset.id,
    action: active.dataset.action ?? 'edit',
    index: [...els.list.children].indexOf(li),
  };
}

// 같은 항목의 같은 버튼 → (삭제돼 없으면) 같은 자리 항목 → 입력창 순으로 포커스
function restoreListFocus({ id, action, index }) {
  const items = [...els.list.querySelectorAll('li[data-id]')];
  const li = items.find((item) => item.dataset.id === id) ?? items[Math.min(index, items.length - 1)];
  const target = li?.querySelector(`[data-action="${action}"]`) ?? li?.querySelector('[data-action="edit"]');
  (target ?? els.input).focus();
}

// 요소 생성 도우미. 자식은 append로만 넣으므로 문자열은 텍스트 노드가 된다 (HTML로 해석하지 않음)
function h(tag, { dataset, attrs, ...props } = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  Object.assign(node.dataset, dataset);
  for (const [name, value] of Object.entries(attrs ?? {})) node.setAttribute(name, value);
  node.append(...children);
  return node;
}

function createTodoItem(todo) {
  const textId = `todo-text-${todo.id}`;
  return h('li', { className: todo.done ? 'todo-item done' : 'todo-item', dataset: { id: todo.id } },
    h('input', { type: 'checkbox', checked: todo.done, dataset: { action: 'toggle' }, attrs: { 'aria-labelledby': textId } }),
    h('span', { className: `category-label category-${todo.category}` }, CATEGORIES[todo.category]),
    h('span', { className: 'todo-text', id: textId }, todo.text),
    createIconButton('edit', '수정', '✎'),
    createIconButton('delete', '삭제', '✕')
  );
}

function createIconButton(action, label, icon) {
  return h('button', { type: 'button', className: 'icon-button', title: label, dataset: { action }, attrs: { 'aria-label': label } }, icon);
}

function createEditItem(todo) {
  const options = Object.entries(CATEGORIES).map(([value, name]) => new Option(name, value, false, value === todo.category));
  const select = h('select', { attrs: { 'aria-label': '카테고리 수정' } }, ...options);
  syncEditCategory(select);
  return h('li', { className: 'todo-item editing', dataset: { id: todo.id } },
    h('input', { type: 'text', className: 'edit-input', maxLength: MAX_TEXT_LENGTH, value: todo.text, attrs: { 'aria-label': '할 일 내용 수정' } }),
    select
  );
}

// 편집 중 고른 카테고리의 색·글자를 select에 바로 반영한다 (저장 전 미리보기)
function syncEditCategory(select) {
  select.className = `edit-category category-${select.value}`;
}

function focusEditInput() {
  const input = els.list.querySelector('.edit-input');
  input?.focus();
  input?.select();
}

function resetInput() {
  els.input.value = '';
  els.input.focus();
}

/* ===== 6. 이벤트와 초기화 ===== */
function commitEdit(li) {
  updateTodo(li.dataset.id, {
    text: li.querySelector('.edit-input').value,
    category: li.querySelector('.edit-category').value,
  });
}

els.form.addEventListener('submit', (event) => {
  event.preventDefault();
  if (addTodo(els.input.value, els.category.value)) resetInput();
});

els.category.addEventListener('change', () => setLastCategory(els.category.value));

els.filters.addEventListener('click', (event) => {
  const button = event.target.closest('[data-filter]');
  if (button) setFilter(button.dataset.filter);
});

els.list.addEventListener('click', (event) => {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const { id } = target.closest('li').dataset;
  const actions = { toggle: toggleTodo, edit: startEdit, delete: deleteTodo };
  actions[target.dataset.action]?.(id);
});

els.list.addEventListener('dblclick', (event) => {
  const text = event.target.closest('.todo-text');
  if (text) startEdit(text.closest('li').dataset.id);
});

els.list.addEventListener('keydown', (event) => {
  const li = event.target.closest('li.editing');
  if (!li) return;
  if (event.key === 'Enter' && !event.isComposing) {
    event.preventDefault();
    commitEdit(li);
  } else if (event.key === 'Escape') {
    cancelEdit();
  }
});

els.list.addEventListener('change', (event) => {
  if (event.target.matches('.edit-category')) syncEditCategory(event.target);
});

// 포커스가 같은 항목 안(예: 입력창 → select)으로 옮겨가면 저장하지 않는다
els.list.addEventListener('focusout', (event) => {
  const li = event.target.closest('li.editing');
  if (li && !li.contains(event.relatedTarget)) commitEdit(li);
});

els.clearCompleted.addEventListener('click', () => {
  const count = getProgress().done;
  if (confirm(`완료한 할 일 ${count}개를 지울까요?`)) clearCompleted();
});

els.undoButton.addEventListener('click', undoDelete);

load();
render();
