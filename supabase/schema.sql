-- ============================================================
-- TaskFlow Database Schema  (idempotent — safe to re-run)
-- Run this in Supabase SQL Editor
-- ============================================================

-- ── Schema permissions (required for PostgreSQL 15+) ─────────
-- PostgreSQL 15 revoked CREATE on public schema from PUBLIC by default.
-- These grants restore the access Supabase roles need.
GRANT USAGE  ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT CREATE ON SCHEMA public TO postgres, service_role;

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Tables ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS profiles (
  id UUID REFERENCES auth.users(id) ON DELETE CASCADE PRIMARY KEY,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspaces (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  join_code TEXT UNIQUE,
  join_code_expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS invites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  email TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  invited_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'expired')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT NOW() + INTERVAL '7 days'
);

CREATE TABLE IF NOT EXISTS todo_lists (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6366f1',
  position INTEGER DEFAULT 0,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS todos (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  list_id UUID REFERENCES todo_lists(id) ON DELETE CASCADE NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'todo' CHECK (status IN ('todo', 'in_progress', 'done')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  due_date DATE,
  position INTEGER DEFAULT 0,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  tags TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS diagrams (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'flowchart' CHECK (type IN ('flowchart', 'er')),
  data JSONB NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  is_public BOOLEAN DEFAULT false,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Backfill columns added after initial release
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS join_code TEXT UNIQUE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS join_code_expires_at TIMESTAMPTZ;
ALTER TABLE diagrams   ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false;

-- ── Functions & Triggers ─────────────────────────────────────

-- Auto-create profile when user signs up
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.profiles (id, display_name, avatar_url)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();

-- Auto-update updated_at timestamps
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS todos_updated_at      ON todos;
DROP TRIGGER IF EXISTS workspaces_updated_at ON workspaces;
DROP TRIGGER IF EXISTS diagrams_updated_at   ON diagrams;

CREATE TRIGGER todos_updated_at      BEFORE UPDATE ON todos      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER workspaces_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER diagrams_updated_at   BEFORE UPDATE ON diagrams   FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Set owner_id on workspace insert
CREATE OR REPLACE FUNCTION set_workspace_owner()
RETURNS TRIGGER AS $$
BEGIN
  NEW.owner_id = auth.uid();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS workspaces_set_owner ON workspaces;
CREATE TRIGGER workspaces_set_owner
  BEFORE INSERT ON workspaces
  FOR EACH ROW EXECUTE FUNCTION set_workspace_owner();

-- ── Row Level Security ────────────────────────────────────────

ALTER TABLE profiles         ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces       ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE invites          ENABLE ROW LEVEL SECURITY;
ALTER TABLE todo_lists       ENABLE ROW LEVEL SECURITY;
ALTER TABLE todos            ENABLE ROW LEVEL SECURITY;
ALTER TABLE diagrams         ENABLE ROW LEVEL SECURITY;

-- ── Helper functions (SECURITY DEFINER + row_security = off) ─

-- Returns workspace IDs the current user belongs to.
-- row_security = off prevents recursive RLS when called from within policies.
CREATE OR REPLACE FUNCTION get_my_workspace_ids()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
  SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid();
$$;

-- Returns true if the current user is an owner or admin of the given workspace.
CREATE OR REPLACE FUNCTION is_ws_admin(ws_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id
      AND user_id = auth.uid()
      AND role IN ('owner', 'admin')
  );
$$;

-- Creates workspace + owner membership in one call, bypassing RLS.
CREATE OR REPLACE FUNCTION create_workspace(ws_name TEXT, ws_description TEXT DEFAULT NULL)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  new_ws RECORD;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;
  INSERT INTO workspaces (name, description, owner_id)
  VALUES (ws_name, ws_description, auth.uid())
  RETURNING * INTO new_ws;
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (new_ws.id, auth.uid(), 'owner');
  RETURN row_to_json(new_ws);
END;
$$;

-- Look up an invite by token without requiring membership (token is the secret).
CREATE OR REPLACE FUNCTION get_invite_by_token(invite_token TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result json;
BEGIN
  SELECT to_json(r) INTO result
  FROM (
    SELECT i.id, i.email, i.role, i.status, i.expires_at, i.workspace_id,
           w.name AS workspace_name
    FROM invites i
    JOIN workspaces w ON w.id = i.workspace_id
    WHERE i.token = invite_token
    LIMIT 1
  ) r;
  RETURN result;
END;
$$;

-- Look up a workspace by its join code (used on invite.html before the user signs in).
-- Returns NULL if the code doesn't exist or has expired.
CREATE OR REPLACE FUNCTION get_workspace_by_join_code(code TEXT)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE result json;
BEGIN
  SELECT to_json(r) INTO result
  FROM (
    SELECT id, name
    FROM workspaces
    WHERE join_code = upper(code)
      AND (join_code_expires_at IS NULL OR join_code_expires_at > NOW())
    LIMIT 1
  ) r;
  RETURN result;
END;
$$;

-- ── RLS Policies ─────────────────────────────────────────────

-- Profiles
DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON profiles;
CREATE POLICY "Profiles viewable by authenticated users"
  ON profiles FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Users can insert own profile" ON profiles;
CREATE POLICY "Users can insert own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Users can update own profile" ON profiles;
CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);

-- Workspaces
DROP POLICY IF EXISTS "Members can view workspaces" ON workspaces;
CREATE POLICY "Members can view workspaces"
  ON workspaces FOR SELECT USING (
    id IN (SELECT get_my_workspace_ids())
  );

DROP POLICY IF EXISTS "Find workspace by join_code" ON workspaces;
CREATE POLICY "Find workspace by join_code"
  ON workspaces FOR SELECT USING (
    join_code IS NOT NULL AND auth.uid() IS NOT NULL
  );

DROP POLICY IF EXISTS "Authenticated users can create workspaces" ON workspaces;
CREATE POLICY "Authenticated users can create workspaces"
  ON workspaces FOR INSERT WITH CHECK (true);

DROP POLICY IF EXISTS "Owners can update workspaces" ON workspaces;
CREATE POLICY "Owners can update workspaces"
  ON workspaces FOR UPDATE USING (is_ws_admin(id));

DROP POLICY IF EXISTS "Owners can delete workspaces" ON workspaces;
CREATE POLICY "Owners can delete workspaces"
  ON workspaces FOR DELETE USING (owner_id = auth.uid());

-- Workspace Members
DROP POLICY IF EXISTS "Members can view workspace membership" ON workspace_members;
CREATE POLICY "Members can view workspace membership"
  ON workspace_members FOR SELECT USING (
    workspace_id IN (SELECT get_my_workspace_ids())
  );

DROP POLICY IF EXISTS "Owners/admins can manage members" ON workspace_members;
CREATE POLICY "Owners/admins can manage members"
  ON workspace_members FOR INSERT WITH CHECK (
    is_ws_admin(workspace_id) OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Owners/admins can remove members" ON workspace_members;
CREATE POLICY "Owners/admins can remove members"
  ON workspace_members FOR DELETE USING (
    is_ws_admin(workspace_id) OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Owners/admins can update member roles" ON workspace_members;
CREATE POLICY "Owners/admins can update member roles"
  ON workspace_members FOR UPDATE USING (
    is_ws_admin(workspace_id)
  );

-- Invites
DROP POLICY IF EXISTS "Members/invitees can view invites" ON invites;
CREATE POLICY "Members/invitees can view invites"
  ON invites FOR SELECT USING (
    workspace_id IN (SELECT get_my_workspace_ids())
    OR email = auth.email()
  );

DROP POLICY IF EXISTS "Admins can create invites" ON invites;
CREATE POLICY "Admins can create invites"
  ON invites FOR INSERT WITH CHECK (
    workspace_id IN (SELECT get_my_workspace_ids())
    AND is_ws_admin(workspace_id)
  );

DROP POLICY IF EXISTS "Admins and invitees can update invites" ON invites;
CREATE POLICY "Admins and invitees can update invites"
  ON invites FOR UPDATE USING (
    is_ws_admin(workspace_id) OR email = auth.email()
  );

DROP POLICY IF EXISTS "Admins can delete invites" ON invites;
CREATE POLICY "Admins can delete invites"
  ON invites FOR DELETE USING (is_ws_admin(workspace_id));

-- Todo Lists
DROP POLICY IF EXISTS "Workspace members can view todo lists" ON todo_lists;
CREATE POLICY "Workspace members can view todo lists"
  ON todo_lists FOR SELECT USING (
    workspace_id IN (SELECT get_my_workspace_ids())
  );

DROP POLICY IF EXISTS "Workspace members can manage todo lists" ON todo_lists;
CREATE POLICY "Workspace members can manage todo lists"
  ON todo_lists FOR ALL USING (
    workspace_id IN (SELECT get_my_workspace_ids())
  );

-- Todos
DROP POLICY IF EXISTS "Workspace members can view todos" ON todos;
CREATE POLICY "Workspace members can view todos"
  ON todos FOR SELECT USING (
    list_id IN (
      SELECT tl.id FROM todo_lists tl
      WHERE tl.workspace_id IN (SELECT get_my_workspace_ids())
    )
  );

DROP POLICY IF EXISTS "Workspace members can manage todos" ON todos;
CREATE POLICY "Workspace members can manage todos"
  ON todos FOR ALL USING (
    list_id IN (
      SELECT tl.id FROM todo_lists tl
      WHERE tl.workspace_id IN (SELECT get_my_workspace_ids())
    )
  );

-- Diagrams
DROP POLICY IF EXISTS "Members or public can view diagrams" ON diagrams;
CREATE POLICY "Members or public can view diagrams"
  ON diagrams FOR SELECT USING (
    workspace_id IN (SELECT get_my_workspace_ids())
    OR is_public = true
  );

DROP POLICY IF EXISTS "Members can create diagrams" ON diagrams;
CREATE POLICY "Members can create diagrams"
  ON diagrams FOR INSERT WITH CHECK (
    workspace_id IN (SELECT get_my_workspace_ids())
  );

DROP POLICY IF EXISTS "Members or public can edit diagrams" ON diagrams;
CREATE POLICY "Members can edit diagrams"
  ON diagrams FOR UPDATE USING (
    workspace_id IN (SELECT get_my_workspace_ids())
  );

DROP POLICY IF EXISTS "Members can delete diagrams" ON diagrams;
CREATE POLICY "Members can delete diagrams"
  ON diagrams FOR DELETE USING (
    workspace_id IN (SELECT get_my_workspace_ids())
  );

-- ── Indexes ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_workspace_members_user      ON workspace_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_members_workspace ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS idx_todos_list                  ON todos(list_id);
CREATE INDEX IF NOT EXISTS idx_todo_lists_workspace        ON todo_lists(workspace_id);
CREATE INDEX IF NOT EXISTS idx_invites_token               ON invites(token);
CREATE INDEX IF NOT EXISTS idx_invites_email               ON invites(email);
CREATE INDEX IF NOT EXISTS idx_diagrams_workspace          ON diagrams(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_join_code        ON workspaces(join_code);

-- ── Role grants ───────────────────────────────────────────────
-- Allow anon + authenticated roles to call tables, functions, and sequences.
GRANT ALL ON ALL TABLES    IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL ROUTINES  IN SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO anon, authenticated, service_role;

-- Apply the same grants to any objects created in the future by the postgres role.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON TABLES    TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON ROUTINES  TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;

-- ── Fix 1: workspace_members → profiles foreign key ──────────
-- Backfill any profiles missing for existing users
INSERT INTO profiles (id, display_name)
SELECT id, split_part(email, '@', 1)
FROM auth.users
WHERE id NOT IN (SELECT id FROM profiles)
ON CONFLICT (id) DO NOTHING;

-- Add FK so PostgREST can resolve workspace_members -> profiles
ALTER TABLE workspace_members
  DROP CONSTRAINT IF EXISTS fk_workspace_members_profiles,
  ADD CONSTRAINT fk_workspace_members_profiles
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

-- ── Fix 2: join code columns ──────────────────────────────────
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS join_code TEXT UNIQUE;
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS join_code_expires_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS idx_workspaces_join_code ON workspaces(join_code);

-- ── Fix 3: workspace UPDATE policy (allow admins to set join_code) ─
CREATE OR REPLACE FUNCTION is_ws_admin(ws_id UUID)
RETURNS BOOLEAN LANGUAGE sql SECURITY DEFINER STABLE
SET search_path = public SET row_security = off AS $$
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = ws_id AND user_id = auth.uid() AND role IN ('owner','admin')
  );
$$;

DROP POLICY IF EXISTS "Owners can update workspaces" ON workspaces;
CREATE POLICY "Owners can update workspaces"
  ON workspaces FOR UPDATE USING (is_ws_admin(id));

-- ── Fix 4: join_code lookup RPC ───────────────────────────────
DROP POLICY IF EXISTS "Find workspace by join_code" ON workspaces;
CREATE POLICY "Find workspace by join_code"
  ON workspaces FOR SELECT USING (join_code IS NOT NULL AND auth.uid() IS NOT NULL);

CREATE OR REPLACE FUNCTION get_workspace_by_join_code(code TEXT)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE result json;
BEGIN
  SELECT to_json(r) INTO result FROM (
    SELECT id, name FROM workspaces
    WHERE join_code = upper(code)
      AND (join_code_expires_at IS NULL OR join_code_expires_at > NOW())
    LIMIT 1
  ) r;
  RETURN result;
END; $$;

-- ============================================================
-- Feature: Task comments + Realtime sync
-- ============================================================

-- ── Task comments ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS todo_comments (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  todo_id UUID REFERENCES todos(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_todo_comments_todo ON todo_comments(todo_id);

-- FK to profiles so PostgREST can embed the author's display name
ALTER TABLE todo_comments
  DROP CONSTRAINT IF EXISTS fk_todo_comments_profiles,
  ADD CONSTRAINT fk_todo_comments_profiles
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE SET NULL;

GRANT ALL ON todo_comments TO anon, authenticated, service_role;

ALTER TABLE todo_comments ENABLE ROW LEVEL SECURITY;

-- View comments on todos in workspaces you belong to
DROP POLICY IF EXISTS "Members can view comments" ON todo_comments;
CREATE POLICY "Members can view comments"
  ON todo_comments FOR SELECT USING (
    todo_id IN (
      SELECT t.id FROM todos t
      JOIN todo_lists tl ON tl.id = t.list_id
      WHERE tl.workspace_id IN (SELECT get_my_workspace_ids())
    )
  );

-- Add a comment (must be the author + a member of the owning workspace)
DROP POLICY IF EXISTS "Members can add comments" ON todo_comments;
CREATE POLICY "Members can add comments"
  ON todo_comments FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND todo_id IN (
      SELECT t.id FROM todos t
      JOIN todo_lists tl ON tl.id = t.list_id
      WHERE tl.workspace_id IN (SELECT get_my_workspace_ids())
    )
  );

-- Only the author can delete their own comment
DROP POLICY IF EXISTS "Authors can delete own comments" ON todo_comments;
CREATE POLICY "Authors can delete own comments"
  ON todo_comments FOR DELETE USING (user_id = auth.uid());

-- ── Realtime ──────────────────────────────────────────────────
-- Add the collaborative tables to the realtime publication.
-- Wrapped in exception blocks so re-running the schema is safe.
DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE todos;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE todo_lists;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE todo_comments;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================
-- Feature: Join requests (admin approval before joining by code)
-- ============================================================

CREATE TABLE IF NOT EXISTS join_requests (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE NOT NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_join_requests_workspace ON join_requests(workspace_id);

-- FK to profiles so PostgREST can embed the requester's display name
ALTER TABLE join_requests
  DROP CONSTRAINT IF EXISTS fk_join_requests_profiles,
  ADD CONSTRAINT fk_join_requests_profiles
    FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;

GRANT ALL ON join_requests TO anon, authenticated, service_role;

ALTER TABLE join_requests ENABLE ROW LEVEL SECURITY;

-- Requester sees their own requests; owners/admins see their workspace's requests
DROP POLICY IF EXISTS "View join requests" ON join_requests;
CREATE POLICY "View join requests"
  ON join_requests FOR SELECT USING (
    user_id = auth.uid() OR is_ws_admin(workspace_id)
  );

-- A user can request to join on their own behalf
DROP POLICY IF EXISTS "Create own join request" ON join_requests;
CREATE POLICY "Create own join request"
  ON join_requests FOR INSERT WITH CHECK (
    user_id = auth.uid()
  );

-- Owners/admins approve or reject requests
DROP POLICY IF EXISTS "Admins update join requests" ON join_requests;
CREATE POLICY "Admins update join requests"
  ON join_requests FOR UPDATE USING (
    is_ws_admin(workspace_id)
  );

-- Owners/admins or the requester can remove a request
DROP POLICY IF EXISTS "Delete join requests" ON join_requests;
CREATE POLICY "Delete join requests"
  ON join_requests FOR DELETE USING (
    is_ws_admin(workspace_id) OR user_id = auth.uid()
  );

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE join_requests;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;