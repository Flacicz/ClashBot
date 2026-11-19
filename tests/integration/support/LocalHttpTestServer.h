#pragma once

#include <atomic>
#include <chrono>
#include <condition_variable>
#include <cstdint>
#include <cstring>
#include <functional>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <string>
#include <thread>

#ifdef _WIN32
#ifndef WIN32_LEAN_AND_MEAN
#define WIN32_LEAN_AND_MEAN
#endif
#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <unistd.h>
#endif

class LocalHttpTestServer
{
public:
    struct ResponseSpec
    {
        int statusCode = 200;
        std::string body = "{}";
        std::string contentType = "application/json";
    };

    using RequestHandler = std::function<std::optional<ResponseSpec>(
        const std::string& rawRequest,
        const std::function<bool()>& shouldStopWaiting)>;

    explicit LocalHttpTestServer(RequestHandler handler)
        : handler_(std::move(handler))
    {
#ifdef _WIN32
        WSADATA wsaData{};
        if (WSAStartup(MAKEWORD(2, 2), &wsaData) != 0)
        {
            throw std::runtime_error("WSAStartup failed");
        }
        wsaInitialized_ = true;
#endif

        listenSocket_ = ::socket(AF_INET, SOCK_STREAM, IPPROTO_TCP);
        if (listenSocket_ == invalidSocket())
        {
            cleanupWsa();
            throw std::runtime_error("Failed to create test server socket");
        }

        int opt = 1;
        ::setsockopt(
            listenSocket_,
            SOL_SOCKET,
            SO_REUSEADDR,
            reinterpret_cast<const char*>(&opt),
            sizeof(opt));

        sockaddr_in address{};
        address.sin_family = AF_INET;
        address.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        address.sin_port = 0;

        if (::bind(listenSocket_, reinterpret_cast<const sockaddr*>(&address), sizeof(address)) != 0)
        {
            closeSocket(listenSocket_);
            listenSocket_ = invalidSocket();
            cleanupWsa();
            throw std::runtime_error("Failed to bind test server socket");
        }

        if (::listen(listenSocket_, 16) != 0)
        {
            closeSocket(listenSocket_);
            listenSocket_ = invalidSocket();
            cleanupWsa();
            throw std::runtime_error("Failed to listen on test server socket");
        }

        sockaddr_in boundAddress{};
#ifdef _WIN32
        int addrLen = sizeof(boundAddress);
#else
        socklen_t addrLen = sizeof(boundAddress);
#endif
        if (::getsockname(listenSocket_, reinterpret_cast<sockaddr*>(&boundAddress), &addrLen) != 0)
        {
            closeSocket(listenSocket_);
            listenSocket_ = invalidSocket();
            cleanupWsa();
            throw std::runtime_error("Failed to query bound test server port");
        }

        port_ = ntohs(boundAddress.sin_port);
        acceptThread_ = std::thread([this] { serveLoop(); });
    }

    ~LocalHttpTestServer()
    {
        stop();
    }

    LocalHttpTestServer(const LocalHttpTestServer&) = delete;
    LocalHttpTestServer& operator=(const LocalHttpTestServer&) = delete;

    [[nodiscard]] std::uint16_t port() const noexcept
    {
        return port_;
    }

    [[nodiscard]] std::string baseUrl() const
    {
        return "http://127.0.0.1:" + std::to_string(port_);
    }

    void releaseStalled()
    {
        {
            std::lock_guard lock(mutex_);
            releaseEpoch_.fetch_add(1);
        }
        cv_.notify_all();
    }

    void stop()
    {
        if (stopping_.exchange(true))
        {
            return;
        }

        cv_.notify_all();

        if (acceptThread_.joinable())
        {
            acceptThread_.join();
        }

        if (listenSocket_ != invalidSocket())
        {
            closeSocket(listenSocket_);
            listenSocket_ = invalidSocket();
        }

        cleanupWsa();
    }

    [[nodiscard]] bool waitForAcceptedConnections(
        const std::size_t count,
        const std::chrono::milliseconds timeout = std::chrono::seconds{5}) const
    {
        std::unique_lock lock(mutex_);
        return cv_.wait_for(lock, timeout, [this, count]
        {
            return acceptedConnections_ >= count;
        });
    }

    [[nodiscard]] std::size_t acceptedConnections() const
    {
        std::lock_guard lock(mutex_);
        return acceptedConnections_;
    }

private:
#ifdef _WIN32
    using SocketHandle = SOCKET;
    static constexpr SocketHandle invalidSocket() noexcept { return INVALID_SOCKET; }
    static void closeSocket(SocketHandle sock) noexcept { ::closesocket(sock); }
    void cleanupWsa() noexcept
    {
        if (wsaInitialized_)
        {
            WSACleanup();
            wsaInitialized_ = false;
        }
    }
    bool wsaInitialized_ = false;
#else
    using SocketHandle = int;
    static constexpr SocketHandle invalidSocket() noexcept { return -1; }
    static void closeSocket(SocketHandle sock) noexcept { ::close(sock); }
    void cleanupWsa() noexcept {}
#endif

    [[nodiscard]] static bool isClientDisconnected(SocketHandle clientSocket) noexcept
    {
        fd_set readSet{};
        FD_ZERO(&readSet);
        FD_SET(clientSocket, &readSet);

        timeval tv{};
        tv.tv_sec = 0;
        tv.tv_usec = 20000;

#ifdef _WIN32
        const int ready = ::select(0, &readSet, nullptr, nullptr, &tv);
#else
        const int ready = ::select(clientSocket + 1, &readSet, nullptr, nullptr, &tv);
#endif
        if (ready <= 0)
        {
            return false;
        }

        char buffer = 0;
        const auto peeked = ::recv(clientSocket, &buffer, 1, MSG_PEEK);
        return peeked <= 0;
    }

    [[nodiscard]] static std::string readHttpRequest(SocketHandle clientSocket)
    {
        std::string request;
        char chunk[1024]{};

        const auto deadline = std::chrono::steady_clock::now() + std::chrono::seconds{2};
        while (std::chrono::steady_clock::now() < deadline)
        {
            fd_set readSet{};
            FD_ZERO(&readSet);
            FD_SET(clientSocket, &readSet);

            timeval tv{};
            tv.tv_sec = 0;
            tv.tv_usec = 50000;

#ifdef _WIN32
            const int ready = ::select(0, &readSet, nullptr, nullptr, &tv);
#else
            const int ready = ::select(clientSocket + 1, &readSet, nullptr, nullptr, &tv);
#endif
            if (ready <= 0)
            {
                if (request.find("\r\n\r\n") != std::string::npos)
                {
                    break;
                }
                continue;
            }

            const auto received = ::recv(clientSocket, chunk, sizeof(chunk), 0);
            if (received <= 0)
            {
                break;
            }

            request.append(chunk, static_cast<std::size_t>(received));
            if (request.find("\r\n\r\n") != std::string::npos)
            {
                break;
            }
        }

        return request;
    }

    static void sendResponse(SocketHandle clientSocket, const ResponseSpec& response)
    {
        const std::string statusText = response.statusCode == 200 ? "OK"
            : response.statusCode == 429 ? "Too Many Requests"
            : "Error";

        const std::string payload =
            "HTTP/1.1 " + std::to_string(response.statusCode) + " " + statusText + "\r\n" +
            "Content-Type: " + response.contentType + "\r\n" +
            "Content-Length: " + std::to_string(response.body.size()) + "\r\n" +
            "Connection: close\r\n\r\n" +
            response.body;

#ifdef _WIN32
        constexpr int sendFlags = 0;
#else
        constexpr int sendFlags = MSG_NOSIGNAL;
#endif

        std::size_t totalSent = 0;
        while (totalSent < payload.size())
        {
            const auto sent = ::send(
                clientSocket,
                payload.data() + totalSent,
                static_cast<int>(payload.size() - totalSent),
                sendFlags);
            if (sent <= 0)
            {
                break;
            }
            totalSent += static_cast<std::size_t>(sent);
        }
    }

    void serveLoop()
    {
        while (!stopping_.load())
        {
            if (listenSocket_ == invalidSocket())
            {
                break;
            }

            fd_set readSet{};
            FD_ZERO(&readSet);
            FD_SET(listenSocket_, &readSet);

            timeval tv{};
            tv.tv_sec = 0;
            tv.tv_usec = 50000;

#ifdef _WIN32
            const int ready = ::select(0, &readSet, nullptr, nullptr, &tv);
#else
            const int ready = ::select(listenSocket_ + 1, &readSet, nullptr, nullptr, &tv);
#endif
            if (ready <= 0)
            {
                continue;
            }

            const SocketHandle clientSocket = ::accept(listenSocket_, nullptr, nullptr);
            if (clientSocket == invalidSocket())
            {
                continue;
            }

            {
                std::lock_guard lock(mutex_);
                ++acceptedConnections_;
            }
            cv_.notify_all();

            const std::size_t epochAtAccept = releaseEpoch_.load();
            const std::string rawRequest = readHttpRequest(clientSocket);

            const auto shouldStopWaiting = [this, clientSocket, epochAtAccept]
            {
                return stopping_.load() ||
                    releaseEpoch_.load() != epochAtAccept ||
                    isClientDisconnected(clientSocket);
            };

            if (handler_)
            {
                if (const auto response = handler_(rawRequest, shouldStopWaiting))
                {
                    sendResponse(clientSocket, *response);
                }
            }

            closeSocket(clientSocket);
        }
    }

    RequestHandler handler_;
    SocketHandle listenSocket_ = invalidSocket();
    std::uint16_t port_ = 0;
    std::thread acceptThread_;
    std::atomic<bool> stopping_{false};
    std::atomic<std::size_t> releaseEpoch_{0};
    mutable std::mutex mutex_;
    mutable std::condition_variable cv_;
    std::size_t acceptedConnections_ = 0;
};
