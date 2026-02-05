-- Base schema for Congreso Votos (Postgres / Supabase)

create table if not exists legislatures (
  id text primary key,
  name text not null,
  start_date date,
  end_date date
);

create table if not exists parties (
  id text primary key,
  name text not null,
  abbreviation text
);

create table if not exists deputies (
  id text primary key,
  full_name text not null,
  gender text,
  birth_date date,
  birthplace text,
  profile_url text,
  photo_url text
);

create table if not exists deputy_memberships (
  id text primary key,
  deputy_id text not null references deputies(id),
  legislature_id text not null references legislatures(id),
  party_id text references parties(id),
  constituency text,
  start_date date,
  end_date date
);

create table if not exists votes (
  id text primary key,
  legislature_id text not null references legislatures(id),
  session_date date not null,
  title text,
  summary text,
  initiative_id text,
  result text
);

create table if not exists vote_results (
  id bigserial primary key,
  vote_id text not null references votes(id),
  deputy_id text not null references deputies(id),
  party_id text references parties(id),
  vote_value text not null,
  unique (vote_id, deputy_id)
);

create table if not exists initiatives (
  id text primary key,
  legislature_id text not null references legislatures(id),
  title text,
  initiative_type text,
  topic text,
  url text
);

create table if not exists deputies_raw (
  id text primary key,
  full_name text not null,
  legislature text,
  start_date date,
  end_date date,
  source_url text,
  raw jsonb not null
);

create table if not exists votes_raw (
  id text primary key,
  legislature text,
  session_date date,
  source_url text,
  raw jsonb not null
);

create index if not exists idx_vote_results_deputy on vote_results (deputy_id);
create index if not exists idx_vote_results_party on vote_results (party_id);
create index if not exists idx_votes_legislature on votes (legislature_id);
create index if not exists idx_memberships_deputy on deputy_memberships (deputy_id);
create unique index if not exists uniq_memberships on deputy_memberships (deputy_id, legislature_id, party_id, start_date);
