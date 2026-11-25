ALTER TABLE notifications
    ADD COLUMN expires_at INTEGER;

UPDATE notifications
SET expires_at = (
    SELECT CASE
               WHEN json_valid(e.event_payload) = 1
                AND typeof(json_extract(e.event_payload, '$.end_time')) = 'integer' THEN
                   CASE notifications.event_type
                       WHEN 'war_reminder' THEN
                           CASE json_extract(e.event_payload, '$.reminder_kind')
                               WHEN 'started' THEN json_extract(e.event_payload, '$.end_time') - 21600
                               WHEN 'six_hours_left' THEN json_extract(e.event_payload, '$.end_time') - 3600
                               WHEN 'one_hour_left' THEN json_extract(e.event_payload, '$.end_time')
                               ELSE NULL
                           END
                       WHEN 'raid_reminder' THEN
                           CASE json_extract(e.event_payload, '$.reminder_kind')
                               WHEN 'started' THEN json_extract(e.event_payload, '$.end_time') - 172800
                               WHEN 'forty_eight_hours_left' THEN json_extract(e.event_payload, '$.end_time') - 86400
                               WHEN 'twenty_four_hours_left' THEN json_extract(e.event_payload, '$.end_time') - 21600
                               WHEN 'six_hours_left' THEN json_extract(e.event_payload, '$.end_time') - 3600
                               WHEN 'one_hour_left' THEN json_extract(e.event_payload, '$.end_time')
                               ELSE NULL
                           END
                       ELSE NULL
                   END
               ELSE NULL
           END
    FROM domain_event_destinations d
    JOIN domain_events e ON e.id = d.domain_event_id
    WHERE d.id = notifications.domain_event_destination_id
)
WHERE status IN ('pending', 'sending')
  AND domain_event_destination_id IS NOT NULL
  AND event_type IN ('war_reminder', 'raid_reminder');

CREATE INDEX IF NOT EXISTS idx_notifications_pending_expires_at
    ON notifications (expires_at, id)
    WHERE status = 'pending' AND expires_at IS NOT NULL;
