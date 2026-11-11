# 设置Cmake的最小版本
cmake_minimum_required(VERSION 3.10)

# 项目名称
project(testLLM)

# 设置C++标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 设置构建类型Debug
set(CMAKE_BUILD_TYPE Debug)

# 直接使用源码目录中的 SDK（与 ChatServer 共用同一套构建描述）
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../sdk ${CMAKE_BINARY_DIR}/sdk)

# 添加可执行文件
add_executable(testLLM testLLM.cpp)

# 设置输出目录
set(EXECUTABLE_OUTPUT_PATH ${CMAKE_BINARY_DIR})

find_package(OpenSSL REQUIRED)

# 添加CPPHTTPLIB_OPENSSL_SUPPORT定义
target_compile_definitions(testLLM PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)

# httplib 可能是 header-only，也可能是独立动态库，存在时优先链接
find_library(CPPHTTPLIB_LIBRARY NAMES cpp-httplib)

# 链接库（SDK 的头文件路径通过 ai_chat_sdk 的 PUBLIC include 自动传递）
target_link_libraries(testLLM ai_chat_sdk jsoncpp fmt  spdlog gtest OpenSSL::SSL OpenSSL::Crypto sqlite3)

if(CPPHTTPLIB_LIBRARY)
    target_link_libraries(testLLM ${CPPHTTPLIB_LIBRARY})
endif()