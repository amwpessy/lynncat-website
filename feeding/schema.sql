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
  photo_urls      text[] not null default '{}',      -- 客户上传的现场照片（钥匙/猫粮摆放位置等）
  kind            text not null default 'normal',    -- normal 正常 | extra 加号
  status          text not null default 'confirmed', -- confirmed 已确认 | pending 待确认 | rejected 已拒绝
  created_at      timestamptz not null default now()
);
create index bookings_day_idx on bookings (d);

-- 照片存储桶：公开桶（任何人持有完整随机 URL 即可访问），但不开放 select/list 策略，
-- 所以无法列出桶内文件，只能访问已知的（UUID 文件名）具体链接。anon 只能新增，不能改/删/列。
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feeding-photos', 'feeding-photos', true, 8388608,
        array['image/jpeg','image/png','image/webp','image/heic','image/heif'])
on conflict (id) do update set public = true, file_size_limit = 8388608,
        allowed_mime_types = array['image/jpeg','image/png','image/webp','image/heic','image/heif'];

create policy feeding_photos_insert on storage.objects
for insert to anon
with check (bucket_id = 'feeding-photos');

-- ---------- 2. 凭据校验（账号密码写在服务端，前端看不到） ----------
-- 如需改账号/密码，改这里的两个字符串即可。
create or replace function _check_feeder(p_user text, p_pass text)
returns boolean language sql immutable as $$
  select p_user = 'lynncathouse88' and p_pass = '13178673413';
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
  p_d date, p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default '{}'
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

  -- 同一手机号同一天已有未拒绝的预约，视为重复提交，直接返回原单（不再插入新行）
  select id into v_id from bookings
    where d = p_d and customer_phone = p_phone and status in ('confirmed','pending')
    limit 1;
  if v_id is not null then
    return json_build_object('ok', true, 'booking_id', v_id, 'duplicate', true);
  end if;

  select count(*) into v_cnt from bookings where d = p_d and status = 'confirmed';
  if v_cnt >= 3 then
    return json_build_object('ok', false, 'error', 'full');
  end if;

  insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
  values (p_d, p_name, p_phone, p_address, p_pet, p_notes, p_photos, 'normal', 'confirmed')
  returning id into v_id;
  return json_build_object('ok', true, 'booking_id', v_id);
end; $$;

-- 客户申请加号（当天已满时，提交待确认申请）
create or replace function request_extra(
  p_d date, p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default '{}'
) returns json language plpgsql security definer as $$
declare v_avail bool; v_id uuid;
begin
  select exists(select 1 from available_days where d = p_d) into v_avail;
  if not v_avail
     or p_d < current_date
     or p_d > (current_date + interval '2 months')::date then
    return json_build_object('ok', false, 'error', 'unavailable');
  end if;

  select id into v_id from bookings
    where d = p_d and customer_phone = p_phone and status in ('confirmed','pending')
    limit 1;
  if v_id is not null then
    return json_build_object('ok', true, 'booking_id', v_id, 'duplicate', true);
  end if;

  insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
  values (p_d, p_name, p_phone, p_address, p_pet, p_notes, p_photos, 'extra', 'pending')
  returning id into v_id;
  return json_build_object('ok', true, 'booking_id', v_id);
end; $$;

-- 客户批量预约：一次提交多个日期。未满的直接确认，已满的自动转为加号申请。
-- 返回每天的处理结果：booked 已预约 | pending 加号待确认 | unavailable 不可约
create or replace function book_days(
  p_dates date[], p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default '{}'
) returns json language plpgsql security definer as $$
declare
  v_d date; v_cnt int; v_avail bool; v_status text; v_results json[] := '{}'; v_dup uuid;
begin
  foreach v_d in array (select array_agg(distinct x order by x) from unnest(p_dates) x) loop
    select exists(select 1 from available_days where d = v_d) into v_avail;
    if not v_avail
       or v_d < current_date
       or v_d > (current_date + interval '2 months')::date then
      v_status := 'unavailable';
    else
      -- 同一手机号同一天已有未拒绝的预约，视为重复提交，跳过插入
      select id into v_dup from bookings
        where d = v_d and customer_phone = p_phone and status in ('confirmed','pending')
        limit 1;
      if v_dup is not null then
        v_status := 'duplicate';
      else
        perform pg_advisory_xact_lock(hashtext(v_d::text));
        select count(*) into v_cnt from bookings where d = v_d and status = 'confirmed';
        if v_cnt >= 3 then
          insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
          values (v_d, p_name, p_phone, p_address, p_pet, p_notes, p_photos, 'extra', 'pending');
          v_status := 'pending';
        else
          insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
          values (v_d, p_name, p_phone, p_address, p_pet, p_notes, p_photos, 'normal', 'confirmed');
          v_status := 'booked';
        end if;
      end if;
    end if;
    v_results := array_append(v_results, json_build_object('d', v_d, 'status', v_status));
  end loop;
  return json_build_object('ok', true, 'results', array_to_json(v_results));
end; $$;

-- 客户查询自己的预约记录（按手机号，仅返回该号码的近两个月记录）
create or replace function my_bookings(p_phone text)
returns json language sql stable security definer as $$
  select coalesce(json_agg(row_to_json(b)), '[]'::json)
  from (
    select d, kind, status, pet_info, notes, photo_urls, created_at
    from bookings
    where customer_phone = p_phone
      and d >= (current_date - interval '2 months')::date
    order by d desc
  ) b;
$$;

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
             from (select id, d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status, created_at
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

-- 喂猫员修改某个订单的内容（p_photos 为 null 时保留原照片，传数组则整体替换）
create or replace function update_booking(
  p_user text, p_pass text, p_id uuid,
  p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default null
) returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then return json_build_object('ok', false); end if;
  update bookings set
    customer_name = p_name, customer_phone = p_phone,
    address = p_address, pet_info = p_pet, notes = p_notes,
    photo_urls = coalesce(p_photos, photo_urls)
  where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- 喂猫员代客下单（客户不方便自己下单时，喂猫员手动建单；一次可选多天）。
-- 不受每天3单上限限制，由喂猫员自行判断是否接单；同一客户同一天已有未拒绝的预约则跳过（标记 duplicate），不重复创建。
create or replace function feeder_create_bookings(
  p_user text, p_pass text, p_dates date[],
  p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default '{}'
) returns json language plpgsql security definer as $$
declare v_d date; v_id uuid; v_status text; v_results json[] := '{}';
begin
  if not _check_feeder(p_user, p_pass) then return json_build_object('ok', false); end if;

  foreach v_d in array (select array_agg(distinct x order by x) from unnest(p_dates) x) loop
    select id into v_id from bookings
      where d = v_d and customer_phone = p_phone and status in ('confirmed','pending')
      limit 1;
    if v_id is not null then
      v_status := 'duplicate';
    else
      insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
      values (v_d, p_name, p_phone, p_address, p_pet, p_notes, p_photos, 'normal', 'confirmed')
      returning id into v_id;
      v_status := 'booked';
    end if;
    v_results := array_append(v_results, json_build_object('d', v_d, 'status', v_status, 'booking_id', v_id));
  end loop;
  return json_build_object('ok', true, 'results', array_to_json(v_results));
end; $$;

-- 喂猫员删除某个订单
create or replace function delete_booking(p_user text, p_pass text, p_id uuid)
returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then return json_build_object('ok', false); end if;
  delete from bookings where id = p_id;
  return json_build_object('ok', true);
end; $$;

-- ---------- 5. 安全：开启 RLS 且不加任何策略，所有访问只能走上面的函数 ----------
alter table available_days enable row level security;
alter table bookings       enable row level security;

grant execute on function public_calendar()                                              to anon;
grant execute on function book_day(date, text, text, text, text, text, text[])          to anon;
grant execute on function request_extra(date, text, text, text, text, text, text[])     to anon;
grant execute on function book_days(date[], text, text, text, text, text, text[])       to anon;
grant execute on function my_bookings(text)                                             to anon;
grant execute on function feeder_login(text, text)                                      to anon;
grant execute on function feeder_overview(text, text)                                   to anon;
grant execute on function set_available_days(text, text, date[])                        to anon;
grant execute on function decide_request(text, text, uuid, boolean)                      to anon;
grant execute on function update_booking(text, text, uuid, text, text, text, text, text, text[]) to anon;
grant execute on function feeder_create_bookings(text, text, date[], text, text, text, text, text, text[]) to anon;
grant execute on function delete_booking(text, text, uuid)                              to anon;
