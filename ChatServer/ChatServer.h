#pragma once
#include <httplib.h>
#include <memory>
#include <ai_chat_sdk/ChatSDK.h>


namespace ai_chat_server{

// 服务器配置信息
struct ServerConfig{
    std::string host = "0.0.0.0";    // 服务器绑定ip
    int port = 8080;                 // 服务器绑定端口
    std::string logLevel = "INFO";   // 日志级别

    // 模型需要的配置信息
    double temperature = 0.7;        // 温度参数
    int maxTokens = 1024;            // 最大token数

    // API Key
    std::string deepseekAPIKey;     // deepseek API Key
    std::string geminiAPIKey;       // gemini API Key
    std::string chatGPTAPIKey;      // chatGPT API Key

    // Ollama
    std::string ollamaModelName;    // Ollama模型名称
    std::string ollamaModelDesc;    // Ollama模型描述
    std::string ollamaEndpoint;     // Ollama API 地址
};


class ChatServer{
public:
    ChatServer(const ServerConfig& config);

    bool start();   // 启动服务器
    void stop();    // 停止服务器
    bool isRunning()const;   // 是否正在运行

private:
    // 构造响应
    std::string buildResponse(const std::string& message, bool success = false);
    // 处理创建会话请求
    void handleCreateSessionRequest(const httplib::Request& request, httplib::Response& response);
    // 处理获取会话列表请求
    void handleGetSessionListsRequest(const httplib::Request& request, httplib::Response& response);
    // 处理获取模型列表请求
    void handleGetModelListsRequest(const httplib::Request& request, httplib::Response& response);
    // 处理删除会话请求
    void handleDeleteSessionRequest(const httplib::Request& request, httplib::Response& response);
    // 处理获取历史消息请求
    void handleGetHistoryMessagesRequest(const httplib::Request& request, httplib::Response& response);
    // 处理发送消息请求-全量返回
    void handleSendMessageRequest(const httplib::Request& request, httplib::Response& response);
    // 处理发送消息请求-增量返回
    void handleSendMessageStreamRequest(const httplib::Request& request, httplib::Response& response);

    // 设置HTTP路由规则
    void setHttpRoutes();

private:
    ServerConfig _config;   // 服务器配置信息
    std::unique_ptr<httplib::Server> _chatServer = nullptr;   // HTTP服务器
    std::shared_ptr<ai_chat_sdk::ChatSDK> _chatSDK = nullptr;   // 聊天SDK
    std::atomic<bool> _isRunning = {false};   // 是否正在运行
};


} // end ai_chat_server