-- 让喂猫员通过点亮/点暗日期整体调整同一客户的预约日期。
-- 请在 Supabase Dashboard → SQL Editor 中运行一次；点暗的相关订单会被删除。

create or replace function feeder_customer_bookings(p_user text, p_pass text, p_phone text)
returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then return json_build_object('ok', false); end if;
  return json_build_object('ok', true, 'bookings',
    (select coalesce(json_agg(row_to_json(b) order by b.d), '[]'::json) from (
      select id, d, status
      from bookings
      where customer_phone = p_phone and status in ('confirmed', 'pending')
    ) b));
end; $$;

grant execute on function feeder_customer_bookings(text, text, text) to anon;

create or replace function update_booking_dates_group(
  p_user text, p_pass text, p_id uuid, p_dates date[], p_related_ids uuid[] default '{}',
  p_name text default null, p_phone text default null, p_address text default null,
  p_pet text default null, p_notes text default null, p_photos text[] default null
) returns json language plpgsql security definer as $$
declare
  v_booking bookings%rowtype;
  v_dates date[];
  v_target date;
  v_d date;
  v_photos text[];
  v_added int := 0;
begin
  if not _check_feeder(p_user, p_pass) then return json_build_object('ok', false); end if;
  select * into v_booking from bookings where id = p_id;
  if not found then return json_build_object('ok', false); end if;

  select array_agg(distinct x order by x) into v_dates from unnest(p_dates) as x;
  if coalesce(array_length(v_dates, 1), 0) = 0 then return json_build_object('ok', false); end if;
  v_target := case when v_booking.d = any(v_dates) then v_booking.d else v_dates[1] end;
  v_photos := coalesce(p_photos, v_booking.photo_urls);

  update bookings set
    d = v_target, customer_name = coalesce(p_name, v_booking.customer_name),
    customer_phone = coalesce(p_phone, v_booking.customer_phone),
    address = coalesce(p_address, v_booking.address), pet_info = coalesce(p_pet, v_booking.pet_info),
    notes = coalesce(p_notes, v_booking.notes), photo_urls = v_photos
  where id = p_id;

  delete from bookings
   where id = any(coalesce(p_related_ids, '{}'))
     and id <> p_id and customer_phone = v_booking.customer_phone
     and (d <> all(v_dates) or (d = v_target and v_booking.d <> v_target));

  foreach v_d in array v_dates loop
    if not exists (
      select 1 from bookings where d = v_d
        and (id = p_id or id = any(coalesce(p_related_ids, '{}')))
    ) then
      insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
      values (v_d, coalesce(p_name, v_booking.customer_name), coalesce(p_phone, v_booking.customer_phone),
              coalesce(p_address, v_booking.address), coalesce(p_pet, v_booking.pet_info),
              coalesce(p_notes, v_booking.notes), v_photos, v_booking.kind, v_booking.status);
      v_added := v_added + 1;
    end if;
  end loop;

  return json_build_object('ok', true, 'added', v_added);
end; $$;

grant execute on function update_booking_dates_group(text, text, uuid, date[], uuid[], text, text, text, text, text, text[]) to anon;
