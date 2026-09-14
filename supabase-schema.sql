-- Supabase SQL Editor에서 한 번 실행합니다. 브라우저는 이 테이블에 직접 접근하지 않고,
-- Railway 서버만 service role로 접근합니다.
create table if not exists public.profiles (
  id uuid primary key,
  email text not null,
  full_name text not null default '',
  role text not null default 'pending' check (role in ('owner', 'member', 'pending', 'blocked')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.personal_states (
  user_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_key text not null,
  status text not null check (status in ('가고싶음', '가봄', '재방문', '별로였음')),
  updated_at timestamptz not null default now(),
  primary key (user_id, restaurant_key)
);

alter table public.profiles enable row level security;
alter table public.personal_states enable row level security;

-- 지도 저장 큐와 개인 감상 기록은 기존 상태 기록과 별도로 보관합니다.
create table if not exists public.personal_records (
  user_id uuid not null references public.profiles(id) on delete cascade,
  restaurant_key text not null,
  map_target boolean not null default false,
  memo text not null default '',
  personal_rating numeric(2,1) check (personal_rating is null or (personal_rating >= 0 and personal_rating <= 5)),
  updated_at timestamptz not null default now(),
  primary key (user_id, restaurant_key)
);

alter table public.personal_records enable row level security;
