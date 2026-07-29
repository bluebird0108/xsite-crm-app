-- Clear the imported cash position figures, drop the "Cash in Hand Afsar" line,
-- and start a fresh zeroed snapshot that Accounts can fill in from the app.
delete from public.cash_position;

insert into public.cash_position (as_at, label, amount, sort_order, month)
select current_date, label, 0, ord, to_char(current_date, 'YYYY-MM')
from (values
  ('Cash at Emirates Islamic', 0),
  ('Cash at Mashreq', 1),
  ('Cash in Hand Shahab', 2),
  ('Total Cash', 3),
  ('Portal payment (Property Finder)', 4),
  ('WPS', 5),
  ('Remaining Balance', 6)
) as t(label, ord);
