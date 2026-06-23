# TaskFlow – Project Guide

## What this is

A collaborative to-do app with an ER/flowchart diagram builder. Built with HTML, CSS, jQuery, and Supabase (PostgreSQL). Hosted on Vercel (frontend) + Supabase (backend/auth/DB).

## Stack

| Layer | Tech |
|---|---|
| Frontend | Plain HTML + CSS + jQuery 3.7.1 |
| Auth | Supabase Auth (email/password) |
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
│   ├── style.css       # Global design system (vars, components)
│   └── diagram.css     # Diagram editor styles
├── js/
│   ├── config.js       # Supabase client + APP helpers (toast, avatar, etc.)
│   ├── auth.js         # Login / signup logic
│   ├── dashboard.js    # Todos, kanban, workspace CRUD, overview stats
│   ├── team.js         # Member listing, invite link generation
│   └── diagram.js      # SVG diagram builder class
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

## Features

### Authentication
- Email + password via Supabase Auth
- Session persisted in `localStorage` (handled by Supabase SDK)
- All pages call `APP.requireAuth()` to redirect unauthenticated visitors

### Workspaces
- A user can belong to multiple workspaces
- Each workspace has owners, admins, and members (enforced by RLS)
- Selected workspace stored in `localStorage` key `taskflow_ws`

### Todos / Kanban
- Tasks live in **Lists** (color-coded) inside a workspace
- Kanban columns: Todo → In Progress → Done
- Priority levels: low / medium / high / urgent
- Due dates, assignees, descriptions supported
- Click a card to open detail/edit modal

### Team invites
- Admins generate a shareable invite link (token stored in `invites` table)
- Invitee visits `/invite.html?token=xxx`, signs in (or signs up), and joins the workspace
- Token expires after 7 days (set in DB default)
- No email-sending service needed — the link is copied manually

### Diagram builder
- Two modes toggled per-diagram: **Flowchart** or **ER Diagram**
- Drag shapes from left palette onto SVG canvas
- Tools: Select (V), Connect (C), Pan (Space / middle-mouse)
- Scroll to zoom; drag background to pan
- Double-click a node to edit its label; double-click ER table header to edit columns
- Click an edge to edit its label / relationship type
- Del / Backspace deletes the selected node or edge
- Diagrams saved as JSON in the `diagrams.data` JSONB column
- Export button downloads the canvas as an `.svg` file

## Global helpers (`js/config.js`)

```js
APP.requireAuth()         // redirect to index.html if not logged in
APP.redirectIfAuth()      // redirect to dashboard.html if already logged in
APP.toast(msg, type)      // show a toast: 'success' | 'error' | 'info' | 'warning'
APP.formatDate(str)       // 'Jun 23, 2026'
APP.isOverdue(dateStr)    // true if date is in the past
APP.avatar(name, size)    // returns HTML string for a colored initials avatar
APP.currentUser           // set after APP.init()
APP.currentWorkspace      // set after workspace is selected
```

## Database tables

| Table | Purpose |
|---|---|
| `profiles` | Extends `auth.users` with display name / avatar |
| `workspaces` | Team workspaces |
| `workspace_members` | Many-to-many users ↔ workspaces with roles |
| `invites` | Pending invite tokens |
| `todo_lists` | Color-coded task lists inside a workspace |
| `todos` | Individual tasks with status, priority, due date |
| `diagrams` | Saved diagram JSON (nodes + edges) |

All tables have **Row Level Security** enabled. Users can only read/write rows belonging to workspaces they are members of.

## Conventions

- No build system — import order matters in HTML `<script>` tags: `config.js` first, feature scripts after
- CSS uses custom properties defined in `:root` in `style.css` — keep new colors there
- `escHtml()` is defined in both `dashboard.js` and `diagram.js` — always escape user content before injecting into the DOM
- Auto-save in the diagram editor debounces 2 s after the last change (`scheduleSave()`)
- Toast notifications via `APP.toast()` — do not use `alert()`

## Still to build

- `invite.html` — accept-invite page (fetch invite by token, join workspace, redirect)
- Real-time updates via Supabase `channel().on('postgres_changes', ...)` for multi-user live sync
- Email delivery for invites (use Supabase Edge Functions + Resend)
- Mobile sidebar toggle
- Drag-to-reorder tasks within a column
