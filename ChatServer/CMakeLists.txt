# 设置Cmake的最小版本
cmake_minimum_required(VERSION 3.10)

# 项目名称
project(AIChatServer)

# 设置C++标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 设置构建类型Debug
set(CMAKE_BUILD_TYPE Debug)

# 添加可执行文件
add_executable(AIChatServer main.cpp ChatServer.cpp)

# 直接使用源码目录中的 SDK（自动编译最新代码），避免链接 /usr/local/lib 下的旧版本
add_subdirectory(${CMAKE_CURRENT_SOURCE_DIR}/../sdk ${CMAKE_BINARY_DIR}/sdk)

# 兼容 <ai_chat_sdk/xxx.h> 的包含方式：
# 在构建目录下生成 include/ai_chat_sdk 软链接，指向源码中的 sdk/include
set(SDK_COMPAT_INCLUDE_DIR ${CMAKE_BINARY_DIR}/include)
file(MAKE_DIRECTORY ${SDK_COMPAT_INCLUDE_DIR})
if(NOT EXISTS ${SDK_COMPAT_INCLUDE_DIR}/ai_chat_sdk)
    execute_process(COMMAND ${CMAKE_COMMAND} -E create_symlink
        ${CMAKE_CURRENT_SOURCE_DIR}/../sdk/include
        ${SDK_COMPAT_INCLUDE_DIR}/ai_chat_sdk)
endif()
target_include_directories(AIChatServer PRIVATE ${SDK_COMPAT_INCLUDE_DIR})

# 设置输出目录
set(EXECUTABLE_OUTPUT_PATH ${CMAKE_BINARY_DIR})

# 查找依赖库
find_package(OpenSSL REQUIRED)

# 添加CPPHTTPLIB_OPENSSL_SUPPORT定义
target_compile_definitions(AIChatServer PRIVATE CPPHTTPLIB_OPENSSL_SUPPORT)

# httplib 可能是 header-only，也可能是独立动态库，存在时优先链接
find_library(CPPHTTPLIB_LIBRARY NAMES cpp-httplib)

# 链接库
target_link_libraries(AIChatServer PRIVATE
    ai_chat_sdk
    jsoncpp 
    fmt  
    spdlog 
    gflags
    OpenSSL::SSL 
    OpenSSL::Crypto 
    sqlite3)

if(CPPHTTPLIB_LIBRARY)
    target_link_libraries(AIChatServer PRIVATE ${CPPHTTPLIB_LIBRARY})
endif()

# 服务以构建目录为工作目录运行，每次构建时把前端页面和配置文件同步过去
add_custom_target(copy_runtime_files ALL
    COMMAND ${CMAKE_COMMAND} -E copy_directory
        ${CMAKE_CURRENT_SOURCE_DIR}/www ${CMAKE_BINARY_DIR}/www
    COMMAND ${CMAKE_COMMAND} -E copy_if_different
        ${CMAKE_CURRENT_SOURCE_DIR}/ChatServer.conf ${CMAKE_BINARY_DIR}/ChatServer.conf
    COMMENT "同步 www 与 ChatServer.conf 到构建目录")
add_dependencies(AIChatServer copy_runtime_files)