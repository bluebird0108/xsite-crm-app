-- Birthday reminders for saved contacts (staff.birthday already exists).
-- The app degrades gracefully without this: contact birthdays simply don't
-- appear until the column is added.
alter table public.contacts add column if not exists birthday date;
