-- ============================================================
-- 灵猫币（Lynncat Coin）· 数据库结构（可重复运行）
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴运行。
-- ============================================================

-- 用户资料 + 余额
create table if not exists coin_profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  username    text unique not null,
  balance     numeric(24,6) not null default 0,
  last_active timestamptz not null default now(),
  last_claim  timestamptz not null default now(),
  created_at  timestamptz not null default now()
);

create index if not exists coin_profiles_balance_idx on coin_profiles (balance desc);
create index if not exists coin_profiles_active_idx  on coin_profiles (last_active);

alter table coin_profiles enable row level security;

drop policy if exists "coin read" on coin_profiles;
create policy "coin read" on coin_profiles for select using (true);

drop policy if exists "coin insert self" on coin_profiles;
create policy "coin insert self" on coin_profiles
  for insert with check (auth.uid() = id);

-- 转账流水
create table if not exists coin_transfers (
  id         bigint generated always as identity primary key,
  from_id    uuid references coin_profiles(id) on delete set null,
  to_id      uuid references coin_profiles(id) on delete set null,
  from_user  text not null,
  to_user    text not null,
  amount     numeric(24,6) not null,
  created_at timestamptz not null default now()
);
create index if not exists coin_transfers_from_idx on coin_transfers (from_id, created_at desc);
create index if not exists coin_transfers_to_idx   on coin_transfers (to_id, created_at desc);
alter table coin_transfers enable row level security;
-- 不开放直接读，统一通过 my_transfers() 只返回与自己相关的记录

-- ── 挖矿：记录心跳，按当前在线人数均分，全网每秒共产出 1 枚 ──
create or replace function mine() returns json
language plpgsql security definer set search_path = public as $$
declare
  uid         uuid := auth.uid();
  now_ts      timestamptz := now();
  online      int;
  elapsed     numeric;
  award       numeric;
  new_balance numeric;
  last_c      timestamptz;
begin
  if uid is null then raise exception 'not authenticated'; end if;

  select last_claim into last_c from coin_profiles where id = uid;
  if not found then raise exception 'no profile'; end if;

  update coin_profiles set last_active = now_ts where id = uid;

  select count(*) into online
    from coin_profiles where last_active > now_ts - interval '8 seconds';
  if online < 1 then online := 1; end if;

  elapsed := extract(epoch from (now_ts - last_c));
  if elapsed > 12 then elapsed := 12; end if;
  if elapsed < 0 then elapsed := 0; end if;

  award := elapsed / online;

  update coin_profiles
    set balance = balance + award, last_claim = now_ts
    where id = uid
    returning balance into new_balance;

  return json_build_object('balance', new_balance, 'online', online, 'award', award);
end; $$;

-- ── 转账（记录流水）──
create or replace function transfer_coin(to_user text, amount numeric) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid            uuid := auth.uid();
  recip          uuid;
  recip_name     text;
  sender_name    text;
  sender_balance numeric;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if amount is null or amount <= 0 then raise exception 'amount_invalid'; end if;

  select id, username into recip, recip_name from coin_profiles where lower(username) = lower(to_user);
  if recip is null then raise exception 'recipient_not_found'; end if;
  if recip = uid then raise exception 'cannot_self'; end if;

  select balance, username into sender_balance, sender_name from coin_profiles where id = uid for update;
  if sender_balance < amount then raise exception 'insufficient'; end if;

  update coin_profiles set balance = balance - amount where id = uid;
  update coin_profiles set balance = balance + amount where id = recip;

  insert into coin_transfers (from_id, to_id, from_user, to_user, amount)
  values (uid, recip, sender_name, recip_name, amount);

  return json_build_object('ok', true);
end; $$;

-- ── 我的转账记录（前 50，含进出方向）──
create or replace function my_transfers() returns table(
  created_at timestamptz, direction text, counterparty text, amount numeric
) language sql security definer set search_path = public as $$
  select created_at,
         case when from_id = auth.uid() then 'out' else 'in' end as direction,
         case when from_id = auth.uid() then to_user else from_user end as counterparty,
         amount
  from coin_transfers
  where from_id = auth.uid() or to_id = auth.uid()
  order by created_at desc
  limit 50;
$$;

-- ── 排行榜（前 50，附在线状态）──
create or replace function coin_leaderboard() returns table(username text, balance numeric, is_online boolean)
language sql security definer set search_path = public as $$
  select username, balance, (last_active > now() - interval '8 seconds') as is_online
  from coin_profiles
  order by balance desc
  limit 50;
$$;

grant execute on function mine()                         to anon, authenticated;
grant execute on function transfer_coin(text, numeric)   to anon, authenticated;
grant execute on function my_transfers()                 to anon, authenticated;
grant execute on function coin_leaderboard()             to anon, authenticated;
