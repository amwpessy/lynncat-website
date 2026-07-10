-- 为现有网站添加「喂猫员修改订单日期」功能。
-- 请在 Supabase Dashboard → SQL Editor 中运行一次；此脚本不会删除订单数据。

drop function if exists update_booking(text, text, uuid, text, text, text, text, text, text[]);

create function update_booking(
  p_user text, p_pass text, p_id uuid,
  p_d date, p_name text, p_phone text, p_address text, p_pet text, p_notes text,
  p_photos text[] default null
) returns json language plpgsql security definer as $$
begin
  if not _check_feeder(p_user, p_pass) then return json_build_object('ok', false); end if;

  update bookings set
    d = p_d,
    customer_name = p_name,
    customer_phone = p_phone,
    address = p_address,
    pet_info = p_pet,
    notes = p_notes,
    photo_urls = coalesce(p_photos, photo_urls)
  where id = p_id;

  return json_build_object('ok', true);
end; $$;

grant execute on function update_booking(text, text, uuid, date, text, text, text, text, text, text[]) to anon;
