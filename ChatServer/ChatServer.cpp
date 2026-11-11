#include "ChatServer.h"
#include <ai_chat_sdk/util/myLog.h>
#include <httplib.h>
#include <jsoncpp/json/forwards.h>
#include <jsoncpp/json/value.h>
#include <jsoncpp/json/reader.h>
#include <jsoncpp/json/writer.h>

namespace ai_chat_server
{

    ChatServer::ChatServer(const ServerConfig &config)
    {
        _chatSDK = std::make_shared<ai_chat_sdk::ChatSDK>();

        auto deepseekConfig = std::make_shared<ai_chat_sdk::APIConfig>();
        deepseekConfig->_modelName = "deepseek-chat";
        deepseekConfig->_apiKey = config.deepseekAPIKey;
        deepseekConfig->_temperature = config.temperature;
        deepseekConfig->_maxTokens = config.maxTokens;

        // gpt-4o-mini（国外模型，暂时停用，需要时取消注释即可）
        // auto chatGPTConfig = std::make_shared<ai_chat_sdk::APIConfig>();
        // chatGPTConfig->_modelName = "gpt-4o-mini";
        // chatGPTConfig->_apiKey = config.chatGPTAPIKey;
        // chatGPTConfig->_temperature = config.temperature;
        // chatGPTConfig->_maxTokens = config.maxTokens;

        // gemini-2.0-flash（国外模型，暂时停用，需要时取消注释即可）
        // auto geminiConfig = std::make_shared<ai_chat_sdk::APIConfig>();
        // geminiConfig->_modelName = "gemini-2.0-flash";
        // geminiConfig->_apiKey = config.geminiAPIKey;
        // geminiConfig->_temperature = config.temperature;
        // geminiConfig->_maxTokens = config.maxTokens;

        // Ollama本地接入deepseek-r1:1.5b
        auto ollamaConfig = std::make_shared<ai_chat_sdk::OllamaConfig>();
        ollamaConfig->_modelName = config.ollamaModelName;
        ollamaConfig->_modelDesc = config.ollamaModelDesc;
        ollamaConfig->_endpoint = config.ollamaEndpoint;
        ollamaConfig->_temperature = config.temperature;
        ollamaConfig->_maxTokens = config.maxTokens;

        std::vector<std::shared_ptr<ai_chat_sdk::Config>> modelConfigs = {
            deepseekConfig,
            // chatGPTConfig,  // 国外模型，暂时停用
            // geminiConfig,   // 国外模型，暂时停用
            ollamaConfig};

        INFO("start init ChatSDK models...");
        if (!_chatSDK->initModels(modelConfigs))
        {
            ERR("ChatSDK init Failed!!!");
            return;
        }
        INFO("ChatSDK models init success!!!");

        // 创建http服务器
        _chatServer = std::make_unique<httplib::Server>();
        if (!_chatServer)
        {
            ERR("ChatServer init Failed!!!");
            return;
        }
    }

    bool ChatServer::start()
    {
        if (_isRunning.load())
        {
            ERR("ChatServer is running!!!");
            return false;
        }

        // 设置路由规则
        setHttpRoutes();

        // 设置静态资源的路径
        // 前端页面相关的所有文件都放在www目录下  注意：将来前端页面名称命名为index.html
        // 当用户在浏览器中输入：http://ip:port/index.html    http://ip:port也能访问index.html页面
        // 在httplib中，默认情况下，如果请求路径中只有ip和端口，httplib默认会使用index.html文件
        _chatServer->set_mount_point("/", "./www");

        // 为了不卡服务器云不卡主线程，服务器在单独的线程中运行
        std::thread serverThread([this]()
                                 {
    _chatServer->listen(_config.host.c_str(), _config.port);
    INFO("ChatServer start on {} :{}", _config.host, _config.port); });

        serverThread.detach();
        _isRunning.store(true);
        INFO("ChatServer start success!!!");
        return true;
    }

    void ChatServer::stop()
    {
        if (!_isRunning.load())
        {
            ERR("ChatServer is not running!!!");
            return;
        }

        if (_chatServer)
        {
            _chatServer->stop();
        }

        _isRunning.store(false);
        INFO("ChatServer stop success!!!");
    }

    bool ChatServer::isRunning() const
    {
        return _isRunning.load();
    }

    // 构造响应
    std::string ChatServer::buildResponse(const std::string &message, bool success)
    {
        Json::Value responseJson;
        responseJson["success"] = success;
        responseJson["message"] = message;

        // 序列化
        Json::StreamWriterBuilder writerBuilder;
        return Json::writeString(writerBuilder, responseJson);
    }

    // 处理创建会话请求
    void ChatServer::handleCreateSessionRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取请求参数，请求参数在请求体
        // 通过反序列化拿到请求体的json格式
        Json::Value requestJson;
        Json::Reader reader;
        if (!reader.parse(request.body, requestJson))
        {
            std::string errorJsonStr = buildResponse("parse request body failed, json format error");
            response.status = 400; // 客户端发送的请求有语法错误，服务器无法理解或处理该请求
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 获取请求参数
        std::string modelName = requestJson.get("model", "deepseek-chat").asString();

        // 创建会话
        std::string sessionID = _chatSDK->createSession(modelName);
        if (sessionID.empty())
        {
            std::string errorJsonStr = buildResponse("create session failed");
            response.status = 500; // 服务器内部错误，无法完成请求
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 构建响应体
        Json::Value dataJson;
        dataJson["session_id"] = sessionID;
        dataJson["model"] = modelName;

        Json::Value responseJson;
        responseJson["success"] = true;
        responseJson["message"] = "create session success";
        responseJson["data"] = dataJson;

        // 序列化
        Json::StreamWriterBuilder writerBuilder;
        std::string responseJsonStr = Json::writeString(writerBuilder, responseJson);

        response.status = 200; // 成功
        response.set_content(responseJsonStr, "application/json");
    }

    // 处理获取会话列表请求
    void ChatServer::handleGetSessionListsRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取会话列表
        std::vector<std::string> sessionIDs = _chatSDK->getSessionLists();

        // 构建session信息
        Json::Value dataArray(Json::arrayValue);
        for (const auto &sessionID : sessionIDs)
        {
            auto session = _chatSDK->getSession(sessionID);
            if (session)
            {
                Json::Value sessionJson;
                sessionJson["id"] = session->_sessionId;
                sessionJson["model"] = session->_modelName;
                sessionJson["created_at"] = static_cast<int64_t>(session->_createdAt);
                sessionJson["updated_at"] = static_cast<int64_t>(session->_updatedAt);
                sessionJson["message_count"] = session->_messages.size();
                if (!session->_messages.empty())
                {
                    sessionJson["first_user_message"] = session->_messages.front()._content;
                }

                dataArray.append(sessionJson);
            }
        }

        // 构建响应体
        Json::Value responseJson;
        responseJson["success"] = true;
        responseJson["message"] = "get session lists success";
        responseJson["data"] = dataArray;

        // 序列化
        Json::StreamWriterBuilder writerBuilder;
        std::string responseJsonStr = Json::writeString(writerBuilder, responseJson);

        response.status = 200; // 成功
        response.set_content(responseJsonStr, "application/json");
    }

    // 处理获取模型列表请求
    void ChatServer::handleGetModelListsRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取支持的模型列表
        auto modelLists = _chatSDK->getAvailableModels();

        // 构建响应体
        Json::Value dataArray(Json::arrayValue);
        for (const auto &modelInfo : modelLists)
        {
            Json::Value modelJson;
            modelJson["name"] = modelInfo._modelName;
            modelJson["desc"] = modelInfo._modelDesc;
            dataArray.append(modelJson);
        }

        // 构建响应体
        Json::Value responseJson;
        responseJson["success"] = true;
        responseJson["message"] = "get model lists success";
        responseJson["data"] = dataArray;

        // 序列化
        Json::StreamWriterBuilder writerBuilder;
        std::string responseJsonStr = Json::writeString(writerBuilder, responseJson);

        response.status = 200; // 成功
        response.set_content(responseJsonStr, "application/json");
    }
    // 处理删除会话请求
    void ChatServer::handleDeleteSessionRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取会话id，注意：会话id是一个路径参数
        std::string sessionId = request.matches[1];

        // 删除会话
        bool ret = _chatSDK->deleteSession(sessionId);
        if (ret)
        {
            std::string errorJsonStr = buildResponse("delete session success", true);
            response.status = 200;
            response.set_content(errorJsonStr, "application/json");
        }
        else
        {
            std::string errorJsonStr = buildResponse("delete session failed, session not found");
            response.status = 404; // 会话不存在
            response.set_content(errorJsonStr, "application/json");
        }
    }

    // 处理获取历史消息请求
    void ChatServer::handleGetHistoryMessagesRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取会话id
        std::string sessionId = request.matches[1];
        // 获取会话
        auto session = _chatSDK->getSession(sessionId);
        if (!session)
        {
            std::string errorJsonStr = buildResponse("session not found");
            response.status = 404; // 会话不存在
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 构建历史消息列表
        Json::Value dataArray(Json::arrayValue);
        for (const auto &message : session->_messages)
        {
            Json::Value messageJson;
            messageJson["id"] = message._messageId;
            messageJson["role"] = message._role;
            messageJson["content"] = message._content;
            messageJson["timestamp"] = static_cast<int64_t>(message._timestamp);
            dataArray.append(messageJson);
        }

        // 构建响应体
        Json::Value responseJson;
        responseJson["success"] = true;
        responseJson["message"] = "get history messages success";
        responseJson["data"] = dataArray;

        // 序列化
        Json::StreamWriterBuilder writerBuilder;
        std::string responseJsonStr = Json::writeString(writerBuilder, responseJson);

        response.status = 200; // 成功
        response.set_content(responseJsonStr, "application/json");
    }

    // 处理发送消息请求-全量返回
    void ChatServer::handleSendMessageRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取请求参数
        Json::Value requestJson;
        Json::Reader reader;
        if (!reader.parse(request.body, requestJson))
        {
            std::string errorJsonStr = buildResponse("parse request body failed, json format error");
            response.status = 400; // 解析请求参数失败
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 解析请求参数
        std::string sessionId = requestJson["session_id"].asString();
        std::string message = requestJson["message"].asString();
        if (sessionId.empty() || message.empty())
        {
            std::string errorJsonStr = buildResponse("session_id or message is empty");
            response.status = 400; // 解析请求参数失败
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 发送消息
        std::string assistantMessage = _chatSDK->sendMessage(sessionId, message);
        if (assistantMessage.empty())
        {
            std::string errorJsonStr = buildResponse("Failed to send AI response message");
            response.status = 500; // 发送消息失败
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 构造响应参数
        Json::Value dataJson;
        dataJson["session_id"] = sessionId;
        dataJson["response"] = assistantMessage;
        dataJson["data"]["assistant_message"] = assistantMessage;

        // 构建响应体
        Json::Value responseJson;
        responseJson["success"] = true;
        responseJson["message"] = "send message success";
        responseJson["data"] = dataJson;

        // 序列化
        Json::StreamWriterBuilder writerBuilder;
        std::string responseJsonStr = Json::writeString(writerBuilder, responseJson);

        response.status = 200; // 成功
        response.set_content(responseJsonStr, "application/json");
    }

    // 处理发送消息请求-增量返回
    void ChatServer::handleSendMessageStreamRequest(const httplib::Request &request, httplib::Response &response)
    {
        // 获取请求参数
        Json::Value requestJson;
        Json::Reader reader;
        if (!reader.parse(request.body, requestJson))
        {
            std::string errorJsonStr = buildResponse("parse request body failed, json format error");
            response.status = 400; // 解析请求参数失败
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 解析请求参数
        std::string sessionId = requestJson["session_id"].asString();
        std::string message = requestJson["message"].asString();
        if (sessionId.empty() || message.empty())
        {
            std::string errorJsonStr = buildResponse("session_id or message is empty");
            response.status = 400; // 解析请求参数失败
            response.set_content(errorJsonStr, "application/json");
            return;
        }

        // 准备流式响应
        response.status = 200;                                    // 成功
        response.set_header("Cache-Control", "no-cache");         // 不使用缓存，服务器立即将数据发送到网络
        response.set_header("Connection", "keep-alive");          // 保持连接，服务器不会关闭连接
        response.set_header("Access-Control-Allow-Origin", "*");  // 允许跨域请求
        response.set_header("Access-Control-Allow-Headers", "*"); // 允许所有请求头

        // set_chunked_content_provider：告诉服务器，响应内从不是一次性发送的，而是分多次逐步发送给客户端，一般用在实时生成响应内容 或者 流式数据传输场景
        //
        response.set_chunked_content_provider("text/event-stream", [this, sessionId, message](size_t offset, httplib::DataSink &dataSink) -> bool
                                              {
                                                  auto writeChunk = [&](const std::string &chunk, bool last)
                                                  {
                                                      // 将chunk转换为SSE数据格式
                                                      // Json::valueToQuotedString: 对chunk进行Json转换，目的防止chunk中包含一些特殊字符来破坏数据格式，比如：在chunk中包含了两个连续的换行，就会影响SSE数据格式
                                                      std::string sseData = "data: " + Json::valueToQuotedString(chunk.c_str()) + "\n\n";

                                                      // 需要将模型返回的结果 chunk 发送给客户单
                                                      dataSink.write(sseData.c_str(), sseData.size()); // 将数据写入响应流，即立即发送给客户单，该方法不会等待缓冲区满之后发送

                                                      // 处理结束标记
                                                      if (last)
                                                      {
                                                          // 流向响应结束
                                                          std::string doneData = "data: [DONE]\n\n";
                                                          dataSink.write(doneData.c_str(), doneData.size());
                                                          dataSink.done(); // 表示流式响应结束
                                                          return false;    // 不再有后续数据
                                                      }
                                                      return true;
                                                  };

                                                  // 先给客户端发送一个空的数据块，避免客户端长时间的等待
                                                  if (!writeChunk("", false))
                                                  {
                                                      return false;
                                                  }

                                                  // 发送消息流
                                                  _chatSDK->sendMessageStream(sessionId, message, writeChunk);

                                                  return false; // 不再有后续数据
                                              });
    }

    // 设置HTTP路由规则
    void ChatServer::setHttpRoutes()
    {
        // 处理创建会话请求
        _chatServer->Post("/api/session", [this](const httplib::Request &request, httplib::Response &response)
                          { handleCreateSessionRequest(request, response); });

        // 处理获取会话列表请求
        _chatServer->Get("/api/sessions", [this](const httplib::Request &request, httplib::Response &response)
                         { handleGetSessionListsRequest(request, response); });

        // 处理获取模型列表请求
        _chatServer->Get("/api/models", [this](const httplib::Request &request, httplib::Response &response)
                         { handleGetModelListsRequest(request, response); });

        // 处理删除会话请求
        _chatServer->Delete("/api/session/(.*)", [this](const httplib::Request &request, httplib::Response &response)
                            { handleDeleteSessionRequest(request, response); });

        // 处理获取历史消息请求
        _chatServer->Get("/api/session/(.*)/history", [this](const httplib::Request &request, httplib::Response &response)
                         { handleGetHistoryMessagesRequest(request, response); });

        // 处理发送消息请求-全量返回
        _chatServer->Post("/api/message", [this](const httplib::Request &request, httplib::Response &response)
                          { handleSendMessageRequest(request, response); });

        // 处理发送消息请求-增量返回
        _chatServer->Post("/api/message/async", [this](const httplib::Request &request, httplib::Response &response)
                          { handleSendMessageStreamRequest(request, response); });
    }

} // end ai_chat_server