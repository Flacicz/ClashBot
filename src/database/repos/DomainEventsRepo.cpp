#include "database/repos/DomainEventsRepo.h"

#include <fmt/format.h>

DomainEventsRepo::DomainEventsRepo(sqlite3* db) : BaseRepository(db, std::string(repoName))
{
}

void DomainEventsRepo::appendEvent(
    const DomainEventRecord& event,
    const std::vector<DomainEventDestinationRecord>& destinations) const
{
    static constexpr std::string_view insertEventSql = R"(
        INSERT INTO domain_events (event_type, event_id, event_payload, payload_version, clan_tag)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (clan_tag, event_type, event_id)
        DO UPDATE SET event_id = excluded.event_id
        RETURNING id;
    )";

    const auto domainEventId = queryOne<long long>(
        insertEventSql,
        "append domain event",
        fmt::format("event_type = {}, event_id = {}, clan_tag = {}",
                    event.eventType,
                    event.eventId,
                    event.clanTag),
        [](sqlite3_stmt* stmt)
        {
            return sqlite::getLong(stmt, 0);
        },
        event.eventType,
        event.eventId,
        event.payload,
        event.payloadVersion,
        event.clanTag);

    static constexpr std::string_view insertDestinationSql = R"(
        INSERT INTO domain_event_destinations (
            domain_event_id,
            chat_id,
            message_thread_id,
            audience,
            subscription_id
        )
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT (
            domain_event_id,
            chat_id,
            message_thread_id,
            audience,
            subscription_id
        ) DO NOTHING;
    )";

    for (const auto& destination : destinations)
    {
        execute(
            insertDestinationSql,
            "append domain event destination",
            fmt::format("domain_event_id = {}, chat_id = {}, message_thread_id = {}, subscription_id = {}",
                        domainEventId,
                        destination.chatId,
                        destination.messageThreadId,
                        destination.subscriptionId),
            domainEventId,
            destination.chatId,
            destination.messageThreadId,
            AudienceUtils::key(destination.audience),
            destination.subscriptionId);
    }
}

std::vector<PendingDomainEventDestination> DomainEventsRepo::getPendingDestinations(const int limit) const
{
    if (limit <= 0) return {};

    static constexpr std::string_view sql = R"(
        SELECT d.id,
               d.domain_event_id,
               e.event_type,
               e.event_id,
               e.event_payload,
               e.payload_version,
               e.clan_tag,
               d.chat_id,
               d.message_thread_id,
               d.audience,
               d.subscription_id,
               d.attempts
        FROM domain_event_destinations d
        JOIN domain_events e ON e.id = d.domain_event_id
        WHERE d.status = 'pending'
          AND (d.next_attempt_at IS NULL
               OR d.next_attempt_at <= strftime('%s', 'now'))
        ORDER BY d.created_at, d.id
        LIMIT ?;
    )";

    const auto mapper = [](sqlite3_stmt* stmt)
    {
        const auto audienceKey = sqlite::getString(stmt, 9);
        const auto audience = AudienceUtils::fromKey(audienceKey);

        if (!audience)
        {
            throw DatabaseException(
                fmt::format("[DomainEventsRepo] Unknown audience '{}' in domain event destination", audienceKey));
        }

        return PendingDomainEventDestination{
            .destinationId = sqlite::getLong(stmt, 0),
            .domainEventId = sqlite::getLong(stmt, 1),
            .eventType = sqlite::getString(stmt, 2),
            .eventId = sqlite::getString(stmt, 3),
            .payload = sqlite::getString(stmt, 4),
            .payloadVersion = sqlite::getInt(stmt, 5),
            .clanTag = sqlite::getString(stmt, 6),
            .chatId = sqlite::getLong(stmt, 7),
            .messageThreadId = sqlite::getLong(stmt, 8),
            .audience = *audience,
            .subscriptionId = sqlite::getLong(stmt, 10),
            .attempts = sqlite::getInt(stmt, 11)
        };
    };

    return query<PendingDomainEventDestination>(
        sql,
        "load pending domain event destinations",
        fmt::format("limit = {}", limit),
        mapper,
        limit);
}

void DomainEventsRepo::markMaterialized(const long long destinationId) const
{
    static constexpr std::string_view sql = R"(
        UPDATE domain_event_destinations
        SET status = 'materialized',
            materialized_at = strftime('%s', 'now'),
            next_attempt_at = NULL,
            last_error = NULL
        WHERE id = ?
          AND status = 'pending';
    )";

    execute(
        sql,
        "mark domain event destination as materialized",
        fmt::format("destination_id = {}", destinationId),
        destinationId);
}

void DomainEventsRepo::reschedule(const long long destinationId,
                                  const long long nextAttemptAt,
                                  const std::string_view error) const
{
    static constexpr std::string_view sql = R"(
        UPDATE domain_event_destinations
        SET status = 'pending',
            attempts = attempts + 1,
            next_attempt_at = ?,
            last_error = ?,
            materialized_at = NULL
        WHERE id = ?
          AND status = 'pending';
    )";

    execute(
        sql,
        "reschedule domain event destination",
        fmt::format("destination_id = {}", destinationId),
        nextAttemptAt,
        error,
        destinationId);
}

void DomainEventsRepo::cancelForSubscription(const long long subscriptionId) const
{
    static constexpr std::string_view cancelDestinationsSql = R"(
        UPDATE domain_event_destinations
        SET status = 'cancelled',
            cancelled_at = strftime('%s', 'now'),
            next_attempt_at = NULL,
            last_error = 'subscription cancelled'
        WHERE subscription_id = ?
          AND status = 'pending';
    )";

    execute(
        cancelDestinationsSql,
        "cancel domain event destinations",
        fmt::format("subscription_id = {}", subscriptionId),
        subscriptionId);

    static constexpr std::string_view cancelNotificationsSql = R"(
        UPDATE notifications
        SET status = 'cancelled',
            next_attempt_at = NULL,
            last_error = 'subscription cancelled'
        WHERE status = 'pending'
          AND domain_event_destination_id IN (
              SELECT id
              FROM domain_event_destinations
              WHERE subscription_id = ?
          );
    )";

    execute(
        cancelNotificationsSql,
        "cancel notifications for subscription",
        fmt::format("subscription_id = {}", subscriptionId),
        subscriptionId);
}
