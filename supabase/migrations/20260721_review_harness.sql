-- Run this in the Supabase SQL editor before setting SUPABASE_URL and
-- SUPABASE_SERVICE_ROLE_KEY on Railway. The first implementation uses the
-- in-memory store locally; this schema is the hosted persistence contract.
create table if not exists review_sessions (
  id uuid primary key,
  owner text not null,
  repo text not null,
  pull_number integer not null,
  head_sha text not null,
  status text not null,
  current_chapter_id text,
  artifact jsonb,
  skeleton jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner, repo, pull_number, head_sha)
);

create table if not exists chapter_progress (
  session_id uuid not null references review_sessions(id) on delete cascade,
  chapter_id text not null,
  completed_at timestamptz not null default now(),
  primary key (session_id, chapter_id)
);

create table if not exists chat_turns (
  id uuid primary key,
  session_id uuid not null references review_sessions(id) on delete cascade,
  role text not null,
  content text not null,
  citations jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists comment_drafts (
  id uuid primary key,
  session_id uuid not null references review_sessions(id) on delete cascade,
  body text not null,
  path text not null,
  line integer not null,
  side text not null,
  github_comment_url text,
  published_at timestamptz,
  created_at timestamptz not null default now()
);
