# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project status

A personal, single-user to-do web app (할 일 관리 앱). All 5 steps in `claude-code-prompts.md` are implemented, which covers every P0 and P1 feature.

- `PRD.md`: the product requirements. It covers features F1–F7, the data model, non-functional requirements and the acceptance checklist (§7).
- `claude-code-prompts.md`: the step-by-step spec the code was built from. Where it is more detailed than the PRD, it wins.

## Running / testing

There is no build, no package manager and no test runner, by design. Run the app by double-clicking `index.html`, which opens it as `file://`. Testing is manual, against PRD §7 and each step's completion conditions. To see the data, use DevTools → Application → Local Storage → `todo-app:v1`.

For automated browser checks, use Playwright MCP. It blocks `file://`, so serve the folder temporarily with `python -m http.server 8765 --bind 127.0.0.1` and stop the server afterwards. The only console error in that setup is a harmless `favicon.ico` 404. Tests often stub `window.confirm`, because "완료 항목 지우기" opens a dialog.

## Deployment

The site is live at https://jihunyangai.github.io/vanilla-todo/. The repo is the **public** `jihunyangAI/vanilla-todo`. GitHub Pages on the free plan only works with public repos, and the user chose public. A separate, unrelated repo, `jihunyangAI/todo-app` (React + TypeScript), also exists. Never push this project there.

- **Every push to `main` deploys.** `.github/workflows/pages.yml` copies only `index.html`, `style.css` and `app.js` into `_site/` and publishes them with `actions/deploy-pages`. Pages runs in `build_type=workflow` mode.
- **New runtime files** (images, extra scripts) must be added to the `cp` line in the workflow. Otherwise the site returns 404 for them. Docs (`*.md`) are deliberately left out of the site.
- **Checking a deploy:** run `gh run list --repo jihunyangAI/vanilla-todo`, or `gh run watch <id> --exit-status`. Then confirm with `curl` that the app files return 200 and `PRD.md` returns 404.
- **Storage is separate.** The deployed site and a locally opened `file://` copy keep their localStorage separately, so their to-do lists are independent.

## Hard constraints

- Plain HTML, CSS and JavaScript only. Keep exactly three source files: `index.html`, `style.css`, `app.js`.
- Load scripts with a plain `<script src="app.js" defer>`. **Never use `type="module"` or `fetch`**, because both break under `file://`.
- Never put user text through `innerHTML`. Build DOM with the `h()` helper in `app.js`. It appends children, so strings become text nodes.
- The layout must work at 360px with no horizontal scroll. Keep keyboard-only operation, visible `:focus-visible` outlines, `aria-label` on icon buttons, and text contrast ≥ 4.5:1.

## Architecture of `app.js`

The file is one script in six commented sections: state → storage → actions → derived values → rendering → events/init.

- **One-way flow.** Only action functions mutate `state`, and each one ends with `commit()` (`save()` + `render()`). Event handlers in section 6 only read the DOM and call actions. The few DOM-only helpers they use (`resetInput`, `syncEditCategory`) never change data.
- **UI-only state** lives outside `state` and is never saved: `editingId`, plus `lastDeleted` and `undoTimer` for the 5-second undo toast.
- **Full redraw.** `render()` rebuilds the whole list each time. `renderList()` remembers which item and control had focus and restores it afterwards (same item, otherwise the item now in that spot, otherwise the input). `render()` also moves focus to the input when the focused button becomes hidden. Keep this logic when changing rendering, or keyboard use breaks.
- **Static vs dynamic markup.** Filter tabs, per-category progress rows, the clear-completed button and the toast are static HTML. `render()` only updates their text and `hidden` / `aria-pressed`. List items are generated.
- **Events.** Each container has one delegated listener. List items dispatch on `data-action` (`toggle` / `edit` / `delete`), and filters on `data-filter`. Editing commits on Enter (skipped while IME composition is active) or on `focusout`, unless focus moves within the same `li`; that exception keeps the category select usable. Esc cancels.
- **Derived values.** `getVisibleTodos()` applies the filter, then sorts incomplete before done, then by `createdAt` descending. `getProgress(category?)` always counts all items and ignores the filter.

## Data and storage

- Storage key: `todo-app:v1`, holding `{ version: 1, todos, settings }`. Items have the shape `{ id (UUID), text (1–100 chars), category, done, createdAt (ms), completedAt (ms|null) }`.
- `load()` copies anything unreadable to `todo-app:v1:backup` and starts empty. That means invalid JSON or JSON without a `todos` array. `normalizeTodo()` drops items that have no id or text and repairs the other fields.
- Use `isCategory()` (an `Object.hasOwn` check) to validate categories, not `in`. `in` also accepts `"toString"`.
- `load()` does a test write first. If storage can't be used, or any `save()` fails, it sets the UI flag `saveFailed`, and `render()` shows the "저장되지 않습니다" banner. The app keeps working.
- Choosing a category filter also sets `settings.lastCategory`, so new items default to that category.

## Where the PRD and the prompts disagree

These follow the prompts:
- Fields: `createdAt` / `completedAt` are stored as ms numbers. The PRD uses ISO strings and `doneAt`.
- "완료 항목 지우기" asks with `confirm()` first. Deleting a single item never asks and offers undo instead.

These follow the PRD, by the user's explicit request:
- Each category has a progress row with a mini bar and "완료 n / 전체 m (p%)". A category with 0 items shows "할 일 없음", not 0%.
- The banner appears at startup when storage is unavailable, not only after a failed save.

## Out of scope (v1)

Login and sync, due dates, reminders, recurring tasks, priorities, custom categories, drag reordering, dark mode, export/import, and automatic clearing when the date changes.
