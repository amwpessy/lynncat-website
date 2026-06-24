-- ============================================================
-- 灵猫币（Lynncat Coin）· 数据库结构
-- 在 Supabase 控制台 → SQL Editor 里整段粘贴运行一次即可。
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

-- 任何人可读（用于排行榜 / 校验用户名）
drop policy if exists "coin read" on coin_profiles;
create policy "coin read" on coin_profiles for select using (true);

-- 仅本人可创建自己的资料（注册时）
drop policy if exists "coin insert self" on coin_profiles;
create policy "coin insert self" on coin_profiles
  for insert with check (auth.uid() = id);

-- 余额只能通过下方函数修改，不开放直接 update / delete

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

  -- 更新本人心跳
  update coin_profiles set last_active = now_ts where id = uid;

  -- 最近 8 秒内有心跳的视为「在线」
  select count(*) into online
    from coin_profiles where last_active > now_ts - interval '8 seconds';
  if online < 1 then online := 1; end if;

  -- 自上次领取以来的秒数（封顶 12 秒，避免离线后回来「暴富」）
  elapsed := extract(epoch from (now_ts - last_c));
  if elapsed > 12 then elapsed := 12; end if;
  if elapsed < 0 then elapsed := 0; end if;

  -- 每秒全网共 1 枚，按在线人数均分
  award := elapsed / online;

  update coin_profiles
    set balance = balance + award, last_claim = now_ts
    where id = uid
    returning balance into new_balance;

  return json_build_object('balance', new_balance, 'online', online, 'award', award);
end; $$;

-- ── 转账 ──
create or replace function transfer_coin(to_user text, amount numeric) returns json
language plpgsql security definer set search_path = public as $$
declare
  uid            uuid := auth.uid();
  recip          uuid;
  sender_balance numeric;
begin
  if uid is null then raise exception 'not authenticated'; end if;
  if amount is null or amount <= 0 then raise exception 'amount_invalid'; end if;

  select id into recip from coin_profiles where lower(username) = lower(to_user);
  if recip is null then raise exception 'recipient_not_found'; end if;
  if recip = uid then raise exception 'cannot_self'; end if;

  select balance into sender_balance from coin_profiles where id = uid for update;
  if sender_balance < amount then raise exception 'insufficient'; end if;

  update coin_profiles set balance = balance - amount where id = uid;
  update coin_profiles set balance = balance + amount where id = recip;

  return json_build_object('ok', true);
end; $$;

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
grant execute on function coin_leaderboard()             to anon, authenticated;
