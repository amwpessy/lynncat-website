-- ============================================================
-- Lynncat 喂猫预约 — Supabase 数据库初始化脚本
-- 在 Supabase 控制台 → SQL Editor 里完整粘贴运行一次即可。
-- ============================================================

-- ---------- 1. 数据表 ----------

-- 喂猫员
create table if not exists feeders (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  phone       text not null,
  created_at  timestamptz not null default now(),
  unique (name, phone)
);

-- 空闲时段
create table if not exists slots (
  id            uuid primary key default gen_random_uuid(),
  feeder_id     uuid not null references feeders(id) on delete cascade,
  feeder_name   text not null,
  feeder_phone  text not null,
  slot_date     date not null,
  start_time    time not null,
  end_time      time not null,
  status        text not null default 'open',   -- open | booked
  created_at    timestamptz not null default now()
);
create index if not exists slots_open_idx on slots (slot_date, start_time) where status = 'open';

-- 客户预约
create table if not exists bookings (
  id              uuid primary key default gen_random_uuid(),
  slot_id         uuid not null references slots(id) on delete cascade,
  customer_name   text not null,
  customer_phone  text not null,
  address         text,
  pet_info        text,
  notes           text,
  created_at      timestamptz not null default now()
);

-- ---------- 2. 原子下单函数（防止两个客户抢同一时段） ----------

create or replace function book_slot(
  p_slot_id  uuid,
  p_name     text,
  p_phone    text,
  p_address  text,
  p_pet_info text,
  p_notes    text
) returns json
language plpgsql
security definer
as $$
declare
  v_rows int;
  v_booking_id uuid;
begin
  update slots set status = 'booked'
   where id = p_slot_id and status = 'open';
  get diagnostics v_rows = row_count;

  if v_rows = 0 then
    return json_build_object('ok', false, 'error', 'already_booked');
  end if;

  insert into bookings (slot_id, customer_name, customer_phone, address, pet_info, notes)
  values (p_slot_id, p_name, p_phone, p_address, p_pet_info, p_notes)
  returning id into v_booking_id;

  return json_build_object('ok', true, 'booking_id', v_booking_id);
end;
$$;

-- 找到或新建喂猫员（按 名字+手机号）
create or replace function find_or_create_feeder(
  p_name  text,
  p_phone text
) returns json
language plpgsql
security definer
as $$
declare
  v_id uuid;
begin
  insert into feeders (name, phone)
  values (p_name, p_phone)
  on conflict (name, phone) do update set name = excluded.name
  returning id into v_id;

  return json_build_object('id', v_id, 'name', p_name, 'phone', p_phone);
end;
$$;

-- ---------- 3. 行级安全策略 ----------
-- 说明：本系统采用「名字+手机号」轻量识别，没有真正的账号密码，
-- 因此这些策略对匿名访客是开放的（小规模/熟客场景够用）。
-- 若日后要更严格，再接入 Supabase Auth 并收紧策略。

alter table feeders  enable row level security;
alter table slots    enable row level security;
alter table bookings enable row level security;

-- feeders：禁止前端直接读写（统一走 find_or_create_feeder 函数），不开放任何策略即可。

-- slots：所有人可读可写
drop policy if exists slots_select on slots;
drop policy if exists slots_insert on slots;
drop policy if exists slots_delete on slots;
create policy slots_select on slots for select using (true);
create policy slots_insert on slots for insert with check (true);
create policy slots_delete on slots for delete using (true);

-- bookings：所有人可读可写（下单走 book_slot 函数，这里的读用于喂猫员查看预约详情）
drop policy if exists bookings_select on bookings;
create policy bookings_select on bookings for select using (true);

-- 函数对匿名角色开放调用
grant execute on function book_slot(uuid, text, text, text, text, text) to anon;
grant execute on function find_or_create_feeder(text, text) to anon;
