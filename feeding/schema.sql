-- ============================================================
-- Lynncat 喂猫预约 — Supabase 数据库脚本（v2：单喂猫员 / 按天接单 / 加号审批）
-- 在 Supabase 控制台 → SQL Editor 里完整粘贴运行一次即可。
-- 注意：开头会删除旧表（之前的 slots/feeders 等），无数据需要保留时直接运行。
-- ============================================================

drop table if exists bookings       cascade;
drop table if exists slots          cascade;
drop table if exists feeders        cascade;
drop table if exists available_days cascade;

drop function if exists book_slot(uuid, text, text, text, text, text)             cascade;
drop function if exists find_or_create_feeder(text, text)                          cascade;

-- ---------- 1. 数据表 ----------

-- 喂猫员勾选的「可接单日期」
create table available_days (
  d date primary key
);

-- 预约（含加号申请）
create table bookings (
  id              uuid primary key default gen_random_uuid(),
  d               date not null,
  customer_name   text not null,
  customer_phone  text not null,
  address         text,
  pet_info        text,
  notes           text,
  kind            text not null default 'normal',    -- normal 正常 | extra 加号
  status          text not null default 'confirmed', -- confirmed 已确认 | pending 待确认 | rejected 已拒绝
  created_at      timestamptz not null default now()
);
create index bookings_day_idx on bookings (d);

-- ---------- 2. 凭据校验（账号密码写在服务端，前端看不到） ----------
-- 如需改账号/密码，改这里的两个字符串即可。
create or replace function _check_feeder(p_user text, p_pass text)
returns boolean language sql immutable as $$
  select p_user = 'lynncathouse88' and p_pass = '15820535337';
$$;

-- ---------- 3. 公开接口（客户用，不需要密码，只返回名额数量、不含隐私） ----------

-- 返回未来两个月内、喂猫员开放的日期，及每天已确认的单数
create or replace function public_calendar()
returns table(d date, cnt int)
language sql stable security definer as $$
  select a.d,
    (select count(*)::int from bookings b where b.d = a.d and b.status = 'confirmed') as cnt
  from available_days a
  where a.d >= current_date
    and a.d <= (current_date + interval '2 months')::date
  order by a.d;
$$;

-- 客户直接预约（当天未满 3 单才成功）
create or replace function book_day(
  p_d date, p_name text, p_phone text, p_address text, p_pet text, p_notes text
) returns json language plpgsql security definer as $$
declare v_cnt int; v_avail bool; v_id uuid;
begin
  perform pg_advisory_xact_lock(hashtext(p_d::text));   -- 防止并发抢最后一单
  select exists(select 1 from available_days where d = p_d) into v_avail;
  if not v_avail
     or p_d < current_date
     or p_d > (current_date + interval '2 months')::date then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  select count(*) into v_cnt from bookings where d = p_d and status = 'confirmed';
  if v_cnt >= 3 then
    return json_build_object('ok', false, 'error', 'full');
  end if;

  insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, kind, status)
  values (p_d, p_name, p_phone, p_address, p_pet, p_notes, 'normal', 'confirmed')
  returning id into v_id;
  return json_build_object('ok', true, 'booking_id', v_id);
end; $$;

-- 客户申请加号（当天已满时，提交待确认申请）
create or replace function request_extra(
  p_d date, p_name text, p_phone text, p_address text, p_pet text, p_notes text
) returns json language plpgsql security definer as $$
declare v_avail bool; v_id uuid;
begin
  select exists(select 1 from available_days where d = p_d) into v_avail;
  if not v_avail
     or p_d < current_date
     or p_d > (current_date + interval '2 months')::date then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, kind, status)
  values (p_d, p_name, p_phone, p_address, p_pet, p_notes, 'extra', 'pending')
  returning id into v_id;
  return json_build_object('ok', true, 'booking_id', v_id);
end; $$;

-- ---------- 4. 喂猫员接口（都要带账号密码） ----------

create or replace function feeder_login(p_user text, p_pass text)
returns json language sql security definer as $$
  select json_build_object('ok', _check_feeder(p_user, p_pass));
$$;

-- 登录后拉取全部数据：开放的日期 + 全部预约（含待确认加号）
create or replace function feeder_overview(p_user text, p_pass text)
returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then
    return json_build_object('ok', false);
  end if;
  return json_build_object(
    'ok', true,
    'days', (select coalesce(json_agg(d order by d), '[]'::json)
             from available_days where d >= current_date),
    'bookings', (select coalesce(json_agg(row_to_json(b)), '[]'::json)
             from (select id, d, customer_name, customer_phone, address, pet_info, notes, kind, status, created_at
                   from bookings where d >= current_date order by d, created_at) b)
  );
end; $$;

-- 保存「可接单日期」（用提交的列表整体替换未来两个月的设置）
create or replace function set_available_days(p_user text, p_pass text, p_days date[])
returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then
    return json_build_object('ok', false);
  end if;
  delete from available_days where d >= current_date;
  insert into available_days(d)
    select distinct x from unnest(p_days) x
    where x >= current_date and x <= (current_date + interval '2 months')::date;
  return json_build_object('ok', true);
end; $$;

-- 同意 / 拒绝 加号申请
create or replace function decide_request(p_user text, p_pass text, p_id uuid, p_approve boolean)
returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then
    return json_build_object('ok', false);
  end if;
  update bookings
     set status = case when p_approve then 'confirmed' else 'rejected' end
   where id = p_id and status = 'pending';
  return json_build_object('ok', true);
end; $$;

-- ---------- 5. 安全：开启 RLS 且不加任何策略，所有访问只能走上面的函数 ----------
alter table available_days enable row level security;
alter table bookings       enable row level security;

grant execute on function public_calendar()                                         to anon;
grant execute on function book_day(date, text, text, text, text, text)              to anon;
grant execute on function request_extra(date, text, text, text, text, text)         to anon;
grant execute on function feeder_login(text, text)                                  to anon;
grant execute on function feeder_overview(text, text)                               to anon;
grant execute on function set_available_days(text, text, date[])                    to anon;
grant execute on function decide_request(text, text, uuid, boolean)                 to anon;
