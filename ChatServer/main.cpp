#include "ChatServer.h"
#include <gflags/gflags.h>
#include <iostream>
#include <fstream>
#include <cstdlib>
#include <string>
#include <stdexcept>
#include <chrono>
#include <thread>
#include <spdlog/common.h>
// 正确的日志头文件路径
#include <ai_chat_sdk/util/myLog.h>

// 定义gflags参数
DEFINE_string(host, "0.0.0.0", "服务器绑定的地址");
DEFINE_int32(port, 8080, "服务器绑定的端口号");
DEFINE_string(log_level, "INFO", "日志级别");
DEFINE_double(temperature, 0.7, "温度值，影响生成文本的随机性");
DEFINE_int32(max_tokens, 2048, "最大token数");
DEFINE_string(config_file, "./ChatServer.conf", "配置文件路径");
// DEFINE_bool(version, false, "显示版本信息");
// Ollama配置参数
DEFINE_string(ollama_model_name, "", "Ollama模型名称");
DEFINE_string(ollama_model_desc, "", "Ollama模型描述");
DEFINE_string(ollama_endpoint, "", "Ollama API地址");

// 版本号
const std::string VERSION = "1.0.0";

// 从环境变量获取API密钥
std::string getEnvVar(const std::string& key) {
    char* value = std::getenv(key.c_str());
    return value ? std::string(value) : "";
}

// 注意：配置文件ChatServer.conf将由gflags库自动解析，不需要手动生成

// 验证配置参数
bool validateConfig(ai_chat_server::ServerConfig& config) {
    // 验证温度值
    if (config.temperature < 0.0 || config.temperature > 2.0) {
        ERR("错误: 温度值必须在0.0到2.0之间，当前值: {}", config.temperature);
        return false;
    }

    // 验证最大token数
    if (config.maxTokens <= 0) {
        ERR("错误: 最大token数必须为正数，当前值: {}", config.maxTokens);
        return false;
    }

    // 验证Ollama配置参数：模型名称、描述、端点要么都不提供，要么全部提供
    bool hasOllamaName = !config.ollamaModelName.empty();
    bool hasOllamaDesc = !config.ollamaModelDesc.empty();
    bool hasOllamaEndpoint = !config.ollamaEndpoint.empty();
    bool ollamaConfigured = hasOllamaName && hasOllamaDesc && hasOllamaEndpoint;
    if (hasOllamaName || hasOllamaDesc || hasOllamaEndpoint) {
        if (!ollamaConfigured) {
            ERR("错误: Ollama配置不完整，模型名称、模型描述、端点必须同时提供");
            return false;
        }
    }

    // 至少需要提供一种可用的模型配置：云端API密钥 或 完整的Ollama配置
    bool hasAnyAPIKey = !config.deepseekAPIKey.empty() ||
                        !config.chatGPTAPIKey.empty() ||
                        !config.geminiAPIKey.empty();
    if (!hasAnyAPIKey && !ollamaConfigured) {
        ERR("错误: 至少需要提供一个有效的API密钥或完整的Ollama配置");
        return false;
    }

    return true;
}

// 显示接口说明
void showAPIInfo() {
    std::cout << "\nChatServer API接口说明:\n";
    std::cout << "  POST   /api/session              - 创建新会话\n";
    std::cout << "  GET    /api/sessions             - 获取所有会话列表\n";
    std::cout << "  GET    /api/models               - 获取可用模型列表\n";
    std::cout << "  DELETE /api/session/{session_id} - 删除指定会话\n";
    std::cout << "  GET    /api/session/{session_id}/history - 获取会话历史消息\n";
    std::cout << "  POST   /api/message              - 发送消息(全量返回)\n";
    std::cout << "  POST   /api/message/async        - 发送消息(流式返回)\n";
    std::cout << "\n使用示例:\n";
    std::cout << "  # 基本启动\n";
    std::cout << "  ./AIChatServer\n";
    std::cout << "\n  # 指定端口启动\n";
    std::cout << "  ./AIChatServer --port=9000\n";
    std::cout << "\n  # 使用指定配置文件\n";
    std::cout << "  ./AIChatServer --config_file=my_config.conf\n";
    std::cout << "\n  # 设置环境变量后启动\n";
    std::cout << "  export deepseek_apikey=your_api_key\n";
    std::cout << "  export chatgpt_apikey=your_api_key\n";
    std::cout << "  export gemini_apikey_new=your_api_key\n";
    std::cout << "  ./AIChatServer\n";
}

int main(int argc, char** argv) {
    try {
                // 显示帮助信息（当使用-h或--help时，gflags会自动显示帮助信息并退出）
        // 这里我们额外显示API接口说明
        if (argc == 2 && (std::string(argv[1]) == "-h" || std::string(argv[1]) == "--help")) {
            showAPIInfo();
            return 0;
        }

        // 解析命令行参数
        gflags::SetUsageMessage("AIChatServer - AI聊天服务器\n\n使用方法: ./AIChatServer [options]");
        gflags::ParseCommandLineFlags(&argc, &argv, true);
        gflags::SetVersionString(VERSION);
        // 使用gflags库自动解析配置文件
        // 如果配置文件存在，gflags会自动加载其中的参数
        // 注意：gflags会按照以下顺序解析参数：默认值 -> 配置文件 -> 命令行参数
        std::ifstream file(FLAGS_config_file);
        if (file) {
            gflags::SetCommandLineOption("flagfile", FLAGS_config_file.c_str());
        }

        // 构建ServerConfig
        ai_chat_server::ServerConfig config;
        config.host = FLAGS_host;
        config.port = FLAGS_port;
        config.logLevel = FLAGS_log_level;
        config.temperature = FLAGS_temperature;
        config.maxTokens = FLAGS_max_tokens;

        // 从环境变量获取API密钥
        config.deepseekAPIKey = getEnvVar("deepseek_apikey");
        config.chatGPTAPIKey = getEnvVar("chatgpt_apikey");
        config.geminiAPIKey = getEnvVar("gemini_apikey_new");
        // 从命令行参数获取Ollama配置
        config.ollamaModelName = FLAGS_ollama_model_name;
        config.ollamaModelDesc = FLAGS_ollama_model_desc;
        config.ollamaEndpoint = FLAGS_ollama_endpoint;

        // 验证配置参数
        if (!validateConfig(config)) {
            ERR("配置验证失败，请检查参数设置");
            return 1;
        }

        // 设置日志级别
        spdlog::level::level_enum logLevel = spdlog::level::info; // 默认INFO级别
        if (config.logLevel == "TRACE") logLevel = spdlog::level::trace;
        else if (config.logLevel == "DEBUG") logLevel = spdlog::level::debug;
        else if (config.logLevel == "INFO") logLevel = spdlog::level::info;
        else if (config.logLevel == "WARN" || config.logLevel == "WARNING") logLevel = spdlog::level::warn;
        else if (config.logLevel == "ERROR") logLevel = spdlog::level::err;
        else if (config.logLevel == "CRITICAL") logLevel = spdlog::level::critical;
        
        // 初始化日志组件
        bite::Logger::initLogger("ChatServer", "stdout", logLevel);
        
        // 显示当前配置
        INFO("AIChatServer 启动配置:");
        INFO("  版本: {}", VERSION);
        INFO("  主机: {}", config.host);
        INFO("  端口: {}", config.port);
        INFO("  日志级别: {}", config.logLevel);
        INFO("  温度值: {}", config.temperature);
        INFO("  最大Token: {}", config.maxTokens);
        INFO("  DeepSeek API Key: {}", (config.deepseekAPIKey.empty() ? "未设置" : "已设置"));
        INFO("  ChatGPT API Key: {}", (config.chatGPTAPIKey.empty() ? "未设置" : "已设置"));
        INFO("  Gemini API Key: {}", (config.geminiAPIKey.empty() ? "未设置" : "已设置"));
        INFO("  Ollama 模型: {}", (config.ollamaModelName.empty() ? "未设置" : config.ollamaModelName));
        INFO("  Ollama 模型描述: {}", (config.ollamaModelDesc.empty() ? "未设置" : config.ollamaModelDesc));
        INFO("  Ollama 端点: {}", (config.ollamaEndpoint.empty() ? "未设置" : config.ollamaEndpoint));
        
        // 创建并启动ChatServer
        ai_chat_server::ChatServer server(config);
        if (server.start()) {
            INFO("ChatServer 启动成功!");
            INFO("服务器地址: http://{}:{}", config.host, config.port);
            
            // 主线程等待，让服务器在单独线程中运行
            while (server.isRunning()) {
                std::this_thread::sleep_for(std::chrono::seconds(100));
            }
        } else {
            ERR("ChatServer 启动失败!");
            return 1;
        }

        return 0;
    } catch (const std::exception& e) {
        ERR("发生异常: {}", e.what());
        return 1;
    } catch (...) {
        ERR("发生未知异常");
        return 1;
    }
}