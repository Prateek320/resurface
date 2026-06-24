-- Resurface Supabase schema
-- Run in Supabase SQL editor after creating a project

create table if not exists profiles (
  id uuid references auth.users on delete cascade primary key,
  email text,
  role text,
  interests text[] default '{}',
  location text,
  skills text,
  tier text default 'free' check (tier in ('free', 'pro')),
  extractions_this_month int default 0,
  drafts_this_month int default 0,
  month_reset date default current_date,
  onboarding_complete boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists opportunities (
  id text primary key,
  user_id uuid references auth.users on delete cascade not null,
  data jsonb not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_opportunities_user_id on opportunities(user_id);

alter table profiles enable row level security;
alter table opportunities enable row level security;

create policy "Users can read own profile" on profiles
  for select using (auth.uid() = id);

create policy "Users can update own profile" on profiles
  for update using (auth.uid() = id);

create policy "Users can insert own profile" on profiles
  for insert with check (auth.uid() = id);

create policy "Users can read own opportunities" on opportunities
  for select using (auth.uid() = user_id);

create policy "Users can insert own opportunities" on opportunities
  for insert with check (auth.uid() = user_id);

create policy "Users can update own opportunities" on opportunities
  for update using (auth.uid() = user_id);

create policy "Users can delete own opportunities" on opportunities
  for delete using (auth.uid() = user_id);

-- Auto-create profile on signup
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, email)
  values (new.id, new.email);
  return new;
end;
$$ language plpgsql security definer;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();
