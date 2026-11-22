-- Staff can add bookings (for example taken by phone) and change them in the admin.
ALTER TABLE bookings ADD COLUMN created_by TEXT;   -- NULL = booked online by the guest, else the staff member's email
ALTER TABLE bookings ADD COLUMN updated_by TEXT;   -- the staff member who last changed it
ALTER TABLE bookings ADD COLUMN updated_at TEXT;
