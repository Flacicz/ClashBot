CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_legacy_event_destination
    ON notifications (event_type, event_id, chat_id, message_thread_id, part_index)
    WHERE domain_event_destination_id IS NULL;
