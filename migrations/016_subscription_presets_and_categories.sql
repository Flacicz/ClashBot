CREATE TABLE clan_subscriptions_new
(
    subscription_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    clan_tag              TEXT    NOT NULL,
    chat_id               INTEGER NOT NULL,
    message_thread_id     INTEGER NOT NULL DEFAULT 0,
    notify_summaries      INTEGER NOT NULL DEFAULT 0 CHECK (notify_summaries IN (0, 1)),
    notify_reminders      INTEGER NOT NULL DEFAULT 0 CHECK (notify_reminders IN (0, 1)),
    notify_roster         INTEGER NOT NULL DEFAULT 0 CHECK (notify_roster IN (0, 1)),
    notify_discipline     INTEGER NOT NULL DEFAULT 0 CHECK (notify_discipline IN (0, 1)),
    notify_system         INTEGER NOT NULL DEFAULT 0 CHECK (notify_system IN (0, 1)),
    mirror_rule_enabled   INTEGER NOT NULL DEFAULT 0 CHECK (mirror_rule_enabled IN (0, 1)),
    timezone_offset_hours INTEGER NOT NULL DEFAULT 3 CHECK (timezone_offset_hours BETWEEN -12 AND 14),
    created_at            INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    CHECK (
        notify_summaries + notify_reminders + notify_roster + notify_discipline + notify_system > 0
    ),
    UNIQUE (clan_tag, chat_id, message_thread_id),
    FOREIGN KEY (clan_tag) REFERENCES clans (tag) ON DELETE CASCADE,
    FOREIGN KEY (chat_id, message_thread_id)
        REFERENCES telegram_chats (chat_id, message_thread_id)
        ON DELETE CASCADE
);

INSERT INTO clan_subscriptions_new (
    subscription_id,
    clan_tag,
    chat_id,
    message_thread_id,
    notify_summaries,
    notify_reminders,
    notify_roster,
    notify_discipline,
    notify_system,
    mirror_rule_enabled,
    timezone_offset_hours,
    created_at
)
SELECT MIN(subscription_id),
       clan_tag,
       chat_id,
       message_thread_id,
       MAX(CASE WHEN audience = 'players' THEN 1 ELSE 0 END),
       MAX(CASE WHEN audience = 'players' THEN 1 ELSE 0 END),
       MAX(CASE WHEN audience = 'players' THEN 1 ELSE 0 END),
       MAX(CASE WHEN audience = 'management' THEN 1 ELSE 0 END),
       MAX(CASE WHEN audience = 'management' THEN 1 ELSE 0 END),
       1,
       3,
       MIN(created_at)
FROM clan_subscriptions
GROUP BY clan_tag, chat_id, message_thread_id;

CREATE TABLE domain_event_destinations_new
(
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    domain_event_id   INTEGER NOT NULL,
    chat_id           INTEGER NOT NULL,
    message_thread_id INTEGER NOT NULL DEFAULT 0,
    category          TEXT    NOT NULL
        CHECK (category IN ('summaries', 'reminders', 'roster', 'discipline', 'system')),
    subscription_id   INTEGER NOT NULL,
    status            TEXT    NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'materialized', 'cancelled')),
    attempts          INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
    next_attempt_at   INTEGER          DEFAULT (strftime('%s', 'now')),
    last_error        TEXT,
    created_at        INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
    materialized_at   INTEGER,
    cancelled_at      INTEGER,
    FOREIGN KEY (domain_event_id) REFERENCES domain_events (id),
    UNIQUE (
        domain_event_id,
        chat_id,
        message_thread_id,
        category,
        subscription_id
    )
);

INSERT INTO domain_event_destinations_new (
    id,
    domain_event_id,
    chat_id,
    message_thread_id,
    category,
    subscription_id,
    status,
    attempts,
    next_attempt_at,
    last_error,
    created_at,
    materialized_at,
    cancelled_at
)
SELECT d.id,
       d.domain_event_id,
       d.chat_id,
       d.message_thread_id,
       CASE
           WHEN d.audience = 'players' THEN
               CASE
                   WHEN e.event_type IN ('PlayerJoinedClanEvent', 'PlayerLeftClanEvent', 'PlayerRoleChangedEvent') THEN 'roster'
                   WHEN e.event_type IN ('war_reminder', 'raid_reminder') THEN 'reminders'
                   ELSE 'summaries'
               END
           ELSE
               CASE
                   WHEN e.event_type IN ('SyncFailureEvent', 'SyncRecoveryEvent') THEN 'system'
                   ELSE 'discipline'
               END
       END,
       COALESCE(
           (
               SELECT MIN(cs_keep.subscription_id)
               FROM clan_subscriptions cs_old
               JOIN clan_subscriptions cs_keep
                 ON cs_keep.clan_tag = cs_old.clan_tag
                AND cs_keep.chat_id = cs_old.chat_id
                AND cs_keep.message_thread_id = cs_old.message_thread_id
               WHERE cs_old.subscription_id = d.subscription_id
           ),
           d.subscription_id
       ),
       d.status,
       d.attempts,
       d.next_attempt_at,
       d.last_error,
       d.created_at,
       d.materialized_at,
       d.cancelled_at
FROM domain_event_destinations d
JOIN domain_events e ON e.id = d.domain_event_id;

DROP TABLE domain_event_destinations;

ALTER TABLE domain_event_destinations_new
    RENAME TO domain_event_destinations;

DROP TABLE clan_subscriptions;

ALTER TABLE clan_subscriptions_new
    RENAME TO clan_subscriptions;

INSERT INTO sqlite_sequence (name, seq)
SELECT 'clan_subscriptions', MAX(subscription_id)
FROM domain_event_destinations
WHERE NOT EXISTS (SELECT 1 FROM sqlite_sequence WHERE name = 'clan_subscriptions')
  AND (SELECT MAX(subscription_id) FROM domain_event_destinations) IS NOT NULL;

UPDATE sqlite_sequence
SET seq = MAX(seq, COALESCE((SELECT MAX(subscription_id) FROM domain_event_destinations), 0))
WHERE name = 'clan_subscriptions';

CREATE INDEX idx_domain_event_destinations_pending
    ON domain_event_destinations (status, next_attempt_at, created_at, id);

CREATE INDEX idx_domain_event_destinations_subscription
    ON domain_event_destinations (subscription_id);
