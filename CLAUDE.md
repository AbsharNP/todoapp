# TaskFlow – Project Guide

## What this is

A collaborative task management app with a kanban board, ER/flowchart diagram builder, and team management. Built with plain HTML, CSS, jQuery, and Supabase (PostgreSQL). Hosted on Vercel (frontend) + Supabase (backend/auth/DB). No build step required.

## Stack

| Layer | Tech |
|---|---|
| Frontend | Plain HTML + CSS + jQuery 3.7.1 |
| Auth | Supabase Auth (email/password + anonymous) |
| Database | Supabase PostgreSQL with RLS |
| Hosting | Vercel (static) + Supabase (backend) |
| Diagrams | Custom SVG renderer (no external lib) |

## File layout

```
/
├── index.html          # Login / signup page
├── dashboard.html      # Main app (todos, team, diagrams, settings)
├── diagram.html        # Full-screen diagram editor
├── invite.html         # Accept team invite (not yet created)
├── css/
│   ├── style.css       # Global design system (vars, components, light/dark, sidebar)
│   └── diagram.css     # Diagram editor styles + read-only / inline text editor styles
├── js/
│   ├── config.js       # Supabase client + APP helpers + APP.theme (light/dark)
│   ├── auth.js         # Login / signup logic
│   ├── dashboard.js    # Todos, kanban, workspace CRUD, overview stats, sidebar collapse
│   ├── team.js         # Member listing, invite link generation, join-by-code modal
│   └── diagram.js      # SVG diagram builder — nodes, edges, tools, read-only mode, inline text editor
├── supabase/
│   └── schema.sql      # Full DB schema + RLS policies (run once in Supabase SQL editor)
└── vercel.json         # Vercel routing + security headers
```

## First-time setup

### 1. Supabase project

1. Create a project at <https://app.supabase.com>
2. Go to **SQL Editor** → paste and run `supabase/schema.sql`
3. Go to **Project Settings → API** and copy:
   - Project URL
   - `anon` public key

### 2. Wire up credentials

Open `js/config.js` and replace the two placeholder values:

```js
const SUPABASE_URL = 'https://YOUR_PROJECT_ID.supabase.co';
const SUPABASE_ANON_KEY = 'YOUR_SUPABASE_ANON_KEY';
```

### 3. Deploy to Vercel

```bash
npm i -g vercel
vercel --prod
```

Or drag the folder into the Vercel dashboard. No build step needed — it's all static files.

### 4. Supabase Auth settings (optional)

- **Email confirmation**: disable in Auth → Settings for faster local dev
- **Site URL**: set to your Vercel domain so invite links work correctly

---

## Features

### Authentication
- Email + password via Supabase Auth
- Anonymous sign-in so guests can view public diagrams without an account
- Session persisted in `localStorage` (handled by Supabase SDK)
- `APP.isGuest()` returns `true` for anonymous sessions; used to gate write actions

### Light / Dark Mode
- Toggle in the user dropdown (dashboard) or diagram user menu; also a fixed button on the auth page
- Theme stored in `localStorage` key `taskflow_theme` (`'dark'` | `'light'`), default `'dark'`
- Anti-FOUC: each HTML page has an inline `<script>` in `<head>` that applies the theme before CSS renders
- `APP.theme.init()` — reads stored preference and applies `data-theme` attribute to `<html>`
- `APP.theme.toggle()` — switches theme and updates all `.theme-toggle-icon` / `.theme-toggle-label` elements
- Diagram canvas stays dark in both modes (overridden in `diagram.css`)
- Button icon convention: shows the **target** mode icon (☀️ when dark → click for light; 🌙 when light → click for dark)

### Collapsible Sidebar
- Collapse button (`◀`) at the bottom of the sidebar nav
- Collapsed state: **52px** wide, icons only, centered; expanded: **232px** with labels
- State persisted in `localStorage` key `taskflow_sidebar` (`'collapsed'` | `'expanded'`)
- Smooth `0.22s` CSS transition on width
- In collapsed mode: workspace dropdown and user dropdown pop out to the **right** instead of downward
- Tooltip labels reposition to the right in collapsed mode via CSS
- Active nav item uses `box-shadow: inset 3px 0 0 0 var(--accent)` for a left-border indicator

### Workspaces
- A user can belong to multiple workspaces
- Roles: `owner`, `admin`, `member` (enforced by RLS)
- Selected workspace stored in `localStorage` key `taskflow_ws`
- Create workspace via modal; delete in Settings panel (owner only)

### Join by Code
- Admins generate a 6-character alphanumeric join code (expires 7 days) in the Team panel
- "Generate Code" and "Join by Code" buttons share one section header row in the Team panel
- "Join by Code" opens a popup modal (same modal used by the sidebar workspace dropdown)
- `joinByCode()` in `team.js` is the shared logic for both entry points

### Team invites (link-based)
- Admins generate a shareable invite link (token stored in `invites` table)
- Invitee visits `/invite.html?token=xxx`, signs in (or signs up), and joins the workspace
- Token expires after 7 days
- No email-sending service required — the link is copied manually

### Todos / Kanban
- Tasks live in **Lists** (color-coded) inside a workspace
- Kanban columns: Todo → In Progress → Done
- Priority levels: low / medium / high / urgent
- Due dates, assignees, descriptions supported
- Click a card to open detail/edit modal
- Export tasks as JSON; import from JSON file

### Diagram builder
- Two modes per-diagram: **Flowchart** or **ER Diagram** (toggled via the type badge in the header)
- Drag shapes from the left palette onto the SVG canvas
- **Flowchart shapes**: Start, End, Process, Decision, I/O, Circle, Text
- **ER elements**: Table (with column editor), Text annotation
- **Text node**: No visible box in normal state — just floating text. Double-click opens an inline `<textarea>` overlay (fixed-position, synced with canvas pan/zoom). Click outside to close and save. Color changeable via Properties panel.
- Tools: Select (V), Connect (C), Pan (Space / middle-mouse)
- Scroll to zoom; drag canvas background to pan
- Double-click a flowchart node to edit its label (browser prompt)
- Double-click an ER table header to open the column editor modal
- Click an edge to edit its label / relationship type in the Properties panel
- Del / Backspace deletes selected node or edge
- Diagrams auto-save (2 s debounce after last change) via `scheduleSave()`
- Export as `.svg` or `.json`; import diagram from `.json`
- Share link: marks diagram `is_public = true`, copies URL to clipboard

### Diagram read-only mode
- When a user views a diagram they are **not** a workspace member of (e.g. via shared public link), the editor enters read-only mode automatically
- Checked in `loadDiagram()` by querying `workspace_members` after fetching the diagram
- Read-only effects: Save / Export SVG / Export JSON / Share Link buttons hidden; Connect tool hidden; palette sidebar hidden; diagram name input set to readonly; "VIEW ONLY" badge shown next to type badge
- All write paths guarded by `isReadOnly` flag: canvas drop, node drag, edge drawing, double-click, Delete key, `scheduleSave()`, `switchDiagramType()`
- Anonymous / guest users always get read-only mode

---

## Global helpers (`js/config.js`)

```js
APP.requireAuth()             // redirect to index.html if no session
APP.redirectIfAuth()          // redirect to dashboard.html if already signed in (non-anonymous)
APP.isGuest()                 // true if current user is anonymous
APP.toast(msg, type)          // toast notification: 'success' | 'error' | 'info' | 'warning'
APP.formatDate(str)           // 'Jun 23, 2026'
APP.isOverdue(dateStr)        // true if date is in the past
APP.avatar(name, size)        // returns HTML string for a colored initials avatar
APP.currentUser               // set after APP.init()
APP.currentWorkspace          // set after workspace is selected
APP.theme.init()              // apply stored theme to <html data-theme>
APP.theme.toggle()            // switch theme + update all toggle buttons
APP.theme.current()           // returns 'dark' | 'light'
APP.theme._updateButtons()    // sync .theme-toggle-icon / .theme-toggle-label elements
```

---

## Database tables

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users` with display name / avatar |
| `workspaces` | Team workspaces (name, description, owner, join_code) |
| `workspace_members` | Many-to-many users ↔ workspaces with roles (`owner` / `admin` / `member`) |
| `invites` | Pending invite tokens (email-based link invites) |
| `todo_lists` | Color-coded task lists inside a workspace |
| `todos` | Individual tasks with status, priority, due date, assignee |
| `diagrams` | Saved diagram JSON (`data` JSONB: `{nodes, edges}`), `is_public` flag |

All tables have **Row Level Security** enabled. Key RLS helpers:
- `get_my_workspace_ids()` — returns workspace IDs for the current user
- `is_ws_admin(ws_id)` — true if current user is owner or admin
- `create_workspace(name, desc)` — creates workspace + owner membership atomically
- `get_workspace_by_join_code(code)` — used for join-by-code (bypasses RLS for lookup)

---

## CSS design system (`css/style.css`)

All colors are CSS custom properties in `:root`. Dark mode is the default; light mode overrides with `html[data-theme="light"]`.

| Variable group | Purpose |
|---|---|
| `--bg-0` … `--bg-5` | Background hierarchy (darkest → lightest in dark mode) |
| `--text-1` … `--text-4` | Text hierarchy (primary → most muted) |
| `--border`, `--border-focus` | Borders and focus rings |
| `--accent`, `--accent-2`, `--accent-light`, `--accent-glow` | Purple accent system |
| `--green/red/blue/yellow/orange` + `-bg` variants | Status / priority colors |
| `--sidebar-width: 232px` | Expanded sidebar width |
| `--sidebar-collapsed-width: 52px` | Collapsed sidebar width |
| `--header-height: 56px` | App header height |
| `--shadow-sm/--shadow/--shadow-lg/--shadow-accent` | Shadow scale |

---

## Conventions

- No build system — `<script>` import order matters: `config.js` must load first
- `escHtml()` is defined in both `dashboard.js` and `diagram.js` — always escape user content before injecting into the DOM
- Do not use `alert()` — use `APP.toast()`
- Do not use `confirm()` — use a modal or inline confirmation UI
- Theme initialization must happen before CSS renders: inline script in `<head>` on every page
- Diagram auto-save uses a 2 s debounce (`scheduleSave()`); all write operations must call it after changes
- The `isReadOnly` flag in `diagram.js` guards all mutation paths — check it before adding new write operations to the diagram editor
- Light mode does not apply to the diagram canvas (`diagram-canvas-wrapper` is pinned dark)

---

## Still to build

- `invite.html` — accept-invite page (fetch invite by token, join workspace, redirect)
- Real-time updates via Supabase `channel().on('postgres_changes', ...)` for multi-user live sync
- Email delivery for invites (Supabase Edge Functions + Resend)
- Mobile sidebar toggle / responsive layout
- Drag-to-reorder tasks within a column
- Subscription / monetization layer (planned: freemium via LemonSqueezy or Paddle)
