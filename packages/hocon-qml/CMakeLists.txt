cmake_minimum_required(VERSION 3.21)
project(luna_next_config LANGUAGES CXX)

find_package(Qt6 6.5 REQUIRED COMPONENTS Qml)
qt_policy(SET QTP0001 NEW)
find_package(Threads REQUIRED)
find_program(CARGO_EXECUTABLE cargo REQUIRED)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_AUTOMOC ON)
include(GNUInstallDirs)

set(RUST_TARGET_DIR "${CMAKE_CURRENT_BINARY_DIR}/cargo")
set(RUST_LIBRARY "${RUST_TARGET_DIR}/release/${CMAKE_STATIC_LIBRARY_PREFIX}luna_next_hocon_qml${CMAKE_STATIC_LIBRARY_SUFFIX}")
file(GLOB CORE_SOURCES CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/../hocon/src/*.rs")
add_custom_command(
    OUTPUT "${RUST_LIBRARY}"
    COMMAND "${CARGO_EXECUTABLE}" build --locked --release
        --manifest-path "${CMAKE_CURRENT_SOURCE_DIR}/Cargo.toml"
        --package luna-next-hocon-qml --target-dir "${RUST_TARGET_DIR}"
    DEPENDS Cargo.toml build.rs src/lib.rs ../hocon/Cargo.toml ../hocon/README.md
        ../../Cargo.toml ../../Cargo.lock ${CORE_SOURCES}
    WORKING_DIRECTORY "${CMAKE_CURRENT_SOURCE_DIR}"
    COMMENT "Building Luna Next HOCON Rust bridge"
    VERBATIM
)
add_custom_target(luna_next_config_rust_build DEPENDS "${RUST_LIBRARY}")
add_library(luna_next_config_rust STATIC IMPORTED)
set_target_properties(luna_next_config_rust PROPERTIES IMPORTED_LOCATION "${RUST_LIBRARY}")
add_dependencies(luna_next_config_rust luna_next_config_rust_build)

set(QML_MODULE_DIR "${CMAKE_CURRENT_BINARY_DIR}/qml/LunaNext/Config")
qt_add_qml_module(luna_next_config
    SHARED
    URI LunaNext.Config
    VERSION 1.0
    PLUGIN_TARGET luna_next_config
    CLASS_NAME LunaNextConfigPlugin
    OUTPUT_DIRECTORY "${QML_MODULE_DIR}"
    TYPEINFO plugins.qmltypes
    SOURCES src/config.h src/config.cpp
)
target_include_directories(luna_next_config PRIVATE src "${RUST_TARGET_DIR}/cxxbridge")
target_link_libraries(luna_next_config PRIVATE Qt6::Qml luna_next_config_rust Threads::Threads ${CMAKE_DL_LIBS})
if(CMAKE_SYSTEM_NAME STREQUAL "Linux")
    target_link_libraries(luna_next_config PRIVATE m rt util)
endif()

set(LUNA_NEXT_QML_INSTALL_DIR "${CMAKE_INSTALL_LIBDIR}/qt6/qml" CACHE STRING "QML import directory relative to the install prefix")
install(TARGETS luna_next_config
    LIBRARY DESTINATION "${LUNA_NEXT_QML_INSTALL_DIR}/LunaNext/Config"
    RUNTIME DESTINATION "${LUNA_NEXT_QML_INSTALL_DIR}/LunaNext/Config"
)
install(FILES "${QML_MODULE_DIR}/qmldir" "${QML_MODULE_DIR}/plugins.qmltypes"
    DESTINATION "${LUNA_NEXT_QML_INSTALL_DIR}/LunaNext/Config"
)

include(CTest)
if(BUILD_TESTING)
    find_program(QML_EXECUTABLE NAMES qml6 qml REQUIRED)
    add_test(NAME qml_load_as_json
        COMMAND "${CMAKE_COMMAND}" -E env "QT_QPA_PLATFORM=offscreen"
            "QML_IMPORT_PATH=${CMAKE_CURRENT_BINARY_DIR}/qml"
            "${QML_EXECUTABLE}" "${CMAKE_CURRENT_SOURCE_DIR}/tests/smoke.qml"
    )
    set_tests_properties(qml_load_as_json PROPERTIES TIMEOUT 20)
endif()
