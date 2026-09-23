#ifndef CLASHBOT_DOMAINEVENTPAYLOADSERIALIZER_H
#define CLASHBOT_DOMAINEVENTPAYLOADSERIALIZER_H
#include "events/ApplicationEvents.h"
#include "models/domain_events/DomainEventModels.h"

class DomainEventPayloadSerializer
{
private:
    static constexpr int currentPayloadVersion = 1;

    static DomainEventRecord serializeConcrete(const PlayerJoinedClanEvent& event);
    static DomainEventRecord serializeConcrete(const PlayerLeftClanEvent& event);
    static DomainEventRecord serializeConcrete(const PlayerRoleChangedEvent& event);
    static DomainEventRecord serializeConcrete(const WarEndedEvent& event);
    static DomainEventRecord serializeConcrete(const RaidsEndedEvent& event);
    static DomainEventRecord serializeConcrete(const ClanwarsLeagueRoundEndedEvent& event);
    static DomainEventRecord serializeConcrete(const SyncFailureEvent& event);
    static DomainEventRecord serializeConcrete(const SyncRecoveryEvent& event);
    static DomainEventRecord serializeConcrete(const WarReminderEvent& event);
    static DomainEventRecord serializeConcrete(const RaidReminderEvent& event);

public:
    [[nodiscard]] DomainEventRecord serialize(const ApplicationEvent& event) const;
};

#endif // CLASHBOT_DOMAINEVENTPAYLOADSERIALIZER_H
