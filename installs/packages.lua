return {
    core = {
        { name = "gcc", source = "pacman", purpose = "C and C++ compiler toolchain" },
        { name = "cmake", source = "pacman", purpose = "Configure, build, and install native projects" },
        { name = "ninja", source = "pacman", purpose = "Fast build runner" },
        { name = "mise", source = "pacman", purpose = "Manage development tools and runtime versions" },
        { name = "qt6-base", source = "pacman", purpose = "Qt base libraries and development tools" },
        { name = "qt6-declarative", source = "pacman", purpose = "Qt QML and Quick libraries and build tools" },
    },

    main = {
        { name = "coreutils", source = "pacman", purpose = "Basic file and shell utilities" },
        { name = "quickshell", source = "pacman", purpose = "Run custom desktop shells and widgets with Qt Quick" },
        { name = "qt6-wayland", source = "pacman", purpose = "Qt Wayland support" },
        { name = "qt6-svg", source = "pacman", purpose = "Render SVG images" },
        { name = "qt6-imageformats", source = "pacman", purpose = "Decode additional image formats including WebP" },
        { name = "ffmpeg", source = "pacman", purpose = "Media processing and inspection tools" },
        { name = "mpv", source = "pacman", purpose = "Media player and libmpv playback library" },
        { name = "mpvpaper", source = "aur", purpose = "Render video and animated PNG wallpapers" },
    },
}
