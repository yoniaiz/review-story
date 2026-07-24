-- GitHub App per-user auth. Apply with `supabase db push` (or the SQL editor)
-- before setting GITHUB_APP_CLIENT_ID/SECRET and TOKEN_ENCRYPTION_KEY.
create table if not exists harness_users (
  id uuid primary key,
  github_user_id bigint not null unique,
  login text not null,
  avatar_url text,
  -- GitHub user-to-server tokens, AES-256-GCM encrypted (base64 iv||ciphertext||tag).
  gh_access_token_enc text,
  gh_access_token_expires_at timestamptz,
  gh_refresh_token_enc text,
  gh_refresh_token_expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists harness_sessions (
  token_hash text primary key,
  user_id uuid not null references harness_users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);
create index if not exists harness_sessions_user_idx on harness_sessions(user_id);

create table if not exists oauth_states (
  state text primary key,
  extension_redirect_uri text not null,
  created_at timestamptz not null default now()
);

alter table review_sessions add column if not exists user_id uuid references harness_users(id);

-- Lock every harness table away from Supabase's semi-public anon key. The API
-- uses the service-role key, which bypasses RLS; no policies are needed.
alter table harness_users enable row level security;
alter table harness_sessions enable row level security;
alter table oauth_states enable row level security;
alter table review_sessions enable row level security;
alter table chat_turns enable row level security;
alter table chapter_progress enable row level security;
alter table comment_drafts enable row level security;
