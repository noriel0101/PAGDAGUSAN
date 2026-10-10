-- Allow multiple active leases in the same room, up to rooms.capacity.
-- The old unique index blocked a second tenant even when occupancy was 1/8.
-- Occupancy and "full" status stay enforced by sync_room_occupancy / sync_room_status
-- and by the approve/assign routes. A tenant still may hold only one active lease.

DROP INDEX IF EXISTS one_active_lease_per_room;

CREATE OR REPLACE FUNCTION public.sync_room_status()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.current_occupancy >= NEW.capacity THEN
    UPDATE rooms
    SET status = 'occupied'
    WHERE id = NEW.id
      AND status NOT IN ('maintenance', 'inactive');
  ELSE
    UPDATE rooms
    SET status = 'available'
    WHERE id = NEW.id
      AND status NOT IN ('maintenance', 'inactive');
  END IF;

  RETURN NEW;
END;
$function$;

-- Recompute status for rooms that were stuck "occupied" while still under capacity.
UPDATE rooms
SET status = CASE
  WHEN current_occupancy >= capacity THEN 'occupied'::room_status
  ELSE 'available'::room_status
END
WHERE status NOT IN ('maintenance', 'inactive');
