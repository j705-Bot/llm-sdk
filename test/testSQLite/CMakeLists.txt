# 设置Cmake的最小版本
cmake_minimum_required(VERSION 3.10)

# 项目名称
project(testSQLite)

# 设置C++标准
set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# 添加可执行文件
add_executable(testSQLite testSqlite3.cpp)

# 查找SQLite3依赖库
find_package(SQLite3 REQUIRED)

# 链接库
target_link_libraries(testSQLite PRIVATE SQLite::SQLite3)
