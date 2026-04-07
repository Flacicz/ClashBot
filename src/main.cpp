#include <nlohmann/json_fwd.hpp>
#include <iostream>
#include <exception>
#include <thread>
#include <string>

#ifdef _WIN32
#include <windows.h>
#endif

#include "../include/database/database.h"
#include "../include/api/apiclient.h"
#include "../include/service/clanManager.h"
#include "../include/config/configLoader.h"
#include "../include/config/config.h"

using json = nlohmann::json;

int main() {
    #ifdef _WIN32
        SetConsoleOutputCP(65001);
    #endif

	std::cout << "--- Clash of Clans Tracker v1.0 ---\n";

	try {
        AppConfig config = loadConfig("C:/Code/C++/ActivityTracking/src/config.json"); // Заменить абсолютный путь

        APIClient apiClient(config.supercellToken, config.useTunnel, config.baseUrl, config.tunnelBaseUrl);
        Database db(config.databasePath);
        ClanManager clanManager(&db, &apiClient, config.defaultClanTags);
        
        std::thread syncThread([&clanManager]() {
            clanManager.syncAll();
        });

        std::cout << "Введите 'stop' для завершения программы.\n";
        std::string cmd;
        while(std::getline(std::cin, cmd)){
            if (cmd == "stop" || cmd == "exit" || cmd == "q") {
                std::cout << "Останавливаю сервис...\n";
                clanManager.stop();
                break;
            }
            std::cout << "Неизвестная команда. Используй: stop\n";
        }

        clanManager.stop();
        if (syncThread.joinable()) {
            syncThread.join();
        }
        
        std::cout << "Программа завершена.\n";
        return 0;
    } 
    catch (const std::exception& e) {
        std::cerr << "Startup/runtime error: " << e.what() << std::endl;
        return 1;
    }
}