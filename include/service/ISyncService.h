#ifndef ACTIVITYTRACKING_ISERVICE_H
#define ACTIVITYTRACKING_ISERVICE_H
#include <string_view>


class ISyncService {
public:
    virtual void updateData(std::string_view tag) = 0;
    virtual std::string getServiceName() = 0;

    virtual ~ISyncService() = default;
};

#endif //ACTIVITYTRACKING_ISERVICE_H
