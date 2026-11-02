-- Shared paths for Lua modules, app fragments, and compositor-launched processes.
-- Inherited path overrides take precedence; theme values refresh from Luna's CLI on reload.
return function(config_dir)
  local home = assert(os.getenv("HOME"), "HOME is required")
  local install_home = assert(config_dir:match("^(.*)/[^/]+$"),
    "Cannot locate Luna's configuration install directory")

  local function define(name, fallback)
    local value = os.getenv(name)
    if not value or value == "" then value = fallback end
    -- hl.env updates os.getenv immediately and is inherited by subsequently launched apps.
    hl.env(name, value)
    return value
  end

  define("XDG_CONFIG_HOME", home .. "/.config")
  local data_home = define("XDG_DATA_HOME", home .. "/.local/share")
  local cache_home = define("XDG_CACHE_HOME", home .. "/.cache")
  local state_home = define("XDG_STATE_HOME", home .. "/.local/state")

  -- Only the repository folder is named luna-next; runtime storage belongs to Luna.
  define("LUNA_HOME_DIR", home .. "/.local/src/luna-next")
  define("LUNA_CONFIG_HOME_DIR", install_home)
  local data = define("LUNA_DATA_HOME_DIR", data_home .. "/luna")
  local cache = define("LUNA_CACHE_HOME_DIR", cache_home .. "/luna")
  define("LUNA_STATE_HOME_DIR", state_home .. "/luna")

  -- These are base directories; each app gets its own named subdirectory.
  define("LUNA_LOCAL_APP_INSTALL_DIR", data .. "/apps/local")
  define("LUNA_GIT_APP_CLONE_DIR", data .. "/git/clone")
  define("LUNA_GIT_APP_BUILD_DIR", cache .. "/git/build")
  define("LUNA_GIT_APP_INSTALL_DIR", data .. "/apps/git")

  local function quote(value)
    return "'" .. value:gsub("'", "'\\''") .. "'"
  end

  local function theme(arguments, allow_empty)
    local command = quote(home .. "/.local/bin/luna") .. " theme " .. arguments
    local pipe = assert(io.popen(command, "r"))
    local value = pipe:read("*a")
    -- Hyprland can reap the CLI before pclose; use the CLI's scalar output.
    pipe:close()
    value = assert(value, "Cannot read Luna theme output"):gsub("\n$", "")
    assert(allow_empty or value ~= "", "Cannot resolve Luna theme: " .. arguments)
    return value
  end

  -- Refresh rather than retaining values exported by an earlier configuration load.
  local selected = theme("current", true)
  local name = selected ~= "" and selected or theme("get name")
  hl.env("LUNA_THEME_NAME", name)
  -- Built-in defaults have a name but no installed theme directory.
  hl.env("LUNA_THEME_DIR", selected ~= "" and theme("path " .. quote(selected)) or "")
end
