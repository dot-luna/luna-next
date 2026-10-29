mod app_configs;
mod git_versions;
mod install_via;
mod packages;

pub use app_configs::{configure_installed_apps, install_app_configs};
pub use install_via::{
    Package, Report, Source, install, install_via_aur, install_via_git, install_via_local,
    install_via_mise, install_via_pacman,
};
pub use packages::{find_repository, get_packages, install_packages};
