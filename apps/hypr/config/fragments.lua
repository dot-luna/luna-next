-- Each app exports its own fragment file, so reconfiguring Hyprland or any app cannot
-- drop another app's registration. Sorted names keep the load order stable.
return function(dir)
    local quoted = "'" .. dir:gsub("'", "'\\''") .. "'"
    local pipe = assert(io.popen("find " .. quoted .. " -maxdepth 1 -type f -name '*.lua' -print0 2>/dev/null | sort -z", "r"))
    local list = pipe:read("*a") or ""
    -- Hyprland can reap subprocesses before pclose; use the listed output.
    pipe:close()
    for path in list:gmatch("([^%z]+)%z") do
        dofile(path)
    end
end
