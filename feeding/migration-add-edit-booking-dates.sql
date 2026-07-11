-- 为已部署的站点添加「修改订单时多选日期」功能。
-- 请在 Supabase Dashboard → SQL Editor 中运行一次；不会删除任何订单数据。

create or replace function update_booking_dates(
  p_user text, p_pass text, p_id uuid, p_dates date[],
  p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default null
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
    d = v_target, customer_name = p_name, customer_phone = p_phone,
    address = p_address, pet_info = p_pet, notes = p_notes, photo_urls = v_photos
  where id = p_id;

  foreach v_d in array v_dates loop
    if v_d <> v_target and not exists (
      select 1 from bookings
       where d = v_d and customer_phone = p_phone and status = v_booking.status
         and customer_name = p_name and coalesce(address,'') = coalesce(p_address,'')
         and coalesce(pet_info,'') = coalesce(p_pet,'') and coalesce(notes,'') = coalesce(p_notes,'')
    ) then
      insert into bookings(d, customer_name, customer_phone, address, pet_info, notes, photo_urls, kind, status)
      values (v_d, p_name, p_phone, p_address, p_pet, p_notes, v_photos, v_booking.kind, v_booking.status);
      v_added := v_added + 1;
    end if;
  end loop;

  return json_build_object('ok', true, 'added', v_added);
end; $$;

grant execute on function update_booking_dates(text, text, uuid, date[], text, text, text, text, text, text[]) to anon;
