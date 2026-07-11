-- 在编辑订单日期弹窗中显示该客户其他已预约日期。
-- 请在 Supabase Dashboard → SQL Editor 中运行一次；不会修改或删除订单数据。

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
