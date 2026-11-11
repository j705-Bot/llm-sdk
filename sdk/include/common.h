#pragma once
#include <string>
#include <ctime>
#include <vector>

namespace ai_chat_sdk{

// 消息结构
struct Message{
    std::string _messageId;       // 消息ID
    std::string _role;            // 角色，如user、assistant等
    std::string _content;         // 消息内容
    std::time_t _timestamp;       // 消息发送时间戳

    // 构造函数
    Message(const std::string& role = "", const std::string& content = "")
        : _role(role), _content(content), _timestamp(0)
    {}
};


// 模型的公共配置信息
struct Config{
    std::string _modelName;       // 模型名称
    double _temperature = 0.7;    // 温度参数，用于控制生成文本的随机性
    int _maxTokens = 2048;       // 最大生成令牌数

    virtual ~Config() = default;  // 添加虚函数的目的主要是为了实现：向下转型时的安全性
};

// 通过API方式接入云端模型
struct APIConfig : public Config{
    std::string _apiKey;          // API密钥
};

// 通过Ollama接入本地模型---不需要apikey
struct OllamaConfig : public Config{
    std::string _modelName;       // 模型名称
    std::string _modelDesc;       // 模型描述
    std::string _endpoint;        // 模型API endpoint  base url
};



// LLM信息
struct ModelInfo{
    std::string _modelName;       // 模型名称
    std::string _modelDesc;       // 模型描述
    std::string _provider;        // 模型提供者
    std::string _endpoint;        // 模型API endpoint  base url
    bool _isAvailable = false;    // 模型是否可用

    ModelInfo(const std::string& modelName = "", const std::string& modelDesc = "", const std::string& provider = "", const std::string& endpoint = "")
        : _modelName(modelName), _modelDesc(modelDesc), _provider(provider), _endpoint(endpoint)
    {}
};

// 会话信息
struct Session{
    std::string _sessionId;       // 会话ID
    std::string _modelName;       // 会话使用的模型名称
    std::vector<Message> _messages; // 会话中的消息列表
    std::time_t _createdAt;        // 会话创建时间戳
    std::time_t _updatedAt;        // 会话最后更新时间戳

    // 构造函数
    Session(const std::string& modelName = "")
        : _modelName(modelName)
    {}
};

} // end ai_chat_sdk