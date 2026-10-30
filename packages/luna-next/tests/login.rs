use luna_next::login::{Login, Paths};
use serde_json::{Value, json};
use std::{
    fs,
    os::unix::fs::{PermissionsExt, symlink},
    path::{Path, PathBuf},
    process::Command,
};

// Building resolves the desktop theme. Each child owns HOME so tests never read user settings.
fn scenario(name: &str) {
    let temporary = tempfile::tempdir().unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "login_scenario", "--nocapture"])
        .env_clear()
        .env("HOME", temporary.path().join("home"))
        .env("PATH", "/usr/bin:/bin")
        .env("LUNA_LOGIN_TEST_ROOT", temporary.path())
        .env("LUNA_LOGIN_TEST_SCENARIO", name)
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{name}:\n{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

struct Fixture {
    root: PathBuf,
    app: PathBuf,
    login: Login,
}

impl Fixture {
    fn new() -> Self {
        let root = PathBuf::from(std::env::var_os("LUNA_LOGIN_TEST_ROOT").unwrap());
        let app = root.join("app");
        write(
            app.join("greeter/Main.qml"),
            "import QtQuick\nRectangle {}\n",
        );
        write(
            app.join("greeter/metadata.desktop"),
            "[SddmGreeterTheme]\nMainScript=Main.qml\nTheme-API=2.0\nQtVersion=6\n",
        );
        write(
            app.join("screens/default/Screen.qml"),
            "import QtQuick\nItem { required property var settings; required property var login }\n",
        );
        let login = Login::new(Paths {
            config_file: root.join("config/login.conf"),
            screens_dir: root.join("library/screens"),
            app_dir: app.clone(),
        })
        .unwrap();
        Self { root, app, login }
    }

    fn screen(&self, name: &str) -> PathBuf {
        let folder = self.root.join("sources").join(name);
        write(folder.join("Screen.qml"), "import QtQuick\nItem {}\n");
        write(
            folder.join("components/Details.qml"),
            "import QtQuick\nItem {}\n",
        );
        folder
    }

    fn settings(&self, output: &Path) -> Value {
        let source = fs::read_to_string(output.join("Settings.js")).unwrap();
        serde_json::from_str(
            source
                .strip_prefix(".pragma library\nvar values = ")
                .unwrap()
                .trim_end()
                .strip_suffix(';')
                .unwrap(),
        )
        .unwrap()
    }
}

fn write(path: impl AsRef<Path>, source: &str) {
    let path = path.as_ref();
    fs::create_dir_all(path.parent().unwrap()).unwrap();
    fs::write(path, source).unwrap();
}

#[test]
fn configuration_preserves_includes_comments_permissions_and_unknown_values() {
    scenario("config");
}

#[test]
fn invalid_schema_values_leave_configuration_unchanged() {
    scenario("validation");
}

#[test]
fn screen_installation_and_selection_preserve_source_and_replace_only_explicitly() {
    scenario("screens");
}

#[test]
fn screen_sources_reject_escapes_directory_links_and_special_files() {
    scenario("unsafe_screens");
}

#[test]
fn bundles_snapshot_theme_media_and_selected_screen_without_source_paths() {
    scenario("bundle");
}

#[test]
fn auto_media_detects_images_and_videos_and_rejects_other_files() {
    scenario("auto");
}

#[test]
fn overlapping_outputs_and_invalid_media_leave_existing_bundle_untouched() {
    scenario("overlap");
}

#[test]
fn environment_paths_select_installed_application_and_config_override() {
    scenario("paths");
}

#[test]
fn login_scenario() {
    let Ok(scenario) = std::env::var("LUNA_LOGIN_TEST_SCENARIO") else {
        return;
    };
    let f = Fixture::new();
    match scenario.as_str() {
        "config" => {
            let defaults = f.login.get_config(None).unwrap();
            assert_eq!(defaults["screen"]["name"], "default");
            assert_eq!(defaults["wallpaper"]["type"], "auto");
            assert_eq!(defaults["colors"], json!({}));
            assert_eq!(fs::read_to_string(f.login.config_file()).unwrap(), "");
            let included = f.root.join("config/base.conf");
            write(
                &included,
                "wallpaper { fit = fit }\ncolors { accent = \"#123456\" }\n",
            );
            let source = "# personal login\ninclude required(file(\"base.conf\"))\nunrelated { value = 42 }\n";
            write(f.login.config_file(), source);
            fs::set_permissions(f.login.config_file(), fs::Permissions::from_mode(0o640)).unwrap();
            let effective = f
                .login
                .update_config(json!({"wallpaper":{"fit":"tile"}, "fonts":{"ui":"My UI"}}))
                .unwrap();
            assert_eq!(effective["wallpaper"]["fit"], "tile");
            assert_eq!(effective["colors"]["accent"], "#123456");
            let saved = fs::read_to_string(f.login.config_file()).unwrap();
            assert!(saved.contains("# personal login\ninclude required(file(\"base.conf\"))"));
            assert!(saved.contains("unrelated { value = 42 }"));
            assert_eq!(
                fs::read_to_string(included).unwrap(),
                "wallpaper { fit = fit }\ncolors { accent = \"#123456\" }\n"
            );
            assert_eq!(
                fs::metadata(f.login.config_file())
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o640
            );
            assert_eq!(f.login.get_config(Some("absent.key")).unwrap(), Value::Null);
            assert!(f.login.get_config(Some("colors..accent")).is_err());
            f.login.update_config(json!({"wallpaper": {}})).unwrap();
            assert_eq!(fs::read_to_string(f.login.config_file()).unwrap(), saved);
        }
        "validation" => {
            write(f.login.config_file(), "# saved\nwallpaper { fit = fit }\n");
            let before = fs::read(f.login.config_file()).unwrap();
            for invalid in [
                json!(null),
                json!([]),
                json!({"screen":{"name":"../outside"}}),
                json!({"wallpaper":{"type":"audio"}}),
                json!({"wallpaper":{"fit":"zoom"}}),
                json!({"wallpaper":{"source":"relative.png"}}),
                json!({"wallpaper":{"background_color":"red"}}),
                json!({"colors":{"accent":"#1234"}}),
                json!({"colors":{"unknown":"#123456"}}),
                json!({"fonts":{"ui":" "}}),
                json!({"fonts":{"size":12}}),
                json!({"screen.name":"custom"}),
            ] {
                assert!(
                    f.login.update_config(invalid.clone()).is_err(),
                    "accepted {invalid}"
                );
                assert_eq!(fs::read(f.login.config_file()).unwrap(), before);
            }
        }
        "screens" => {
            let source = f.screen("side");
            let installed = f.login.install(&source, None, false).unwrap();
            assert!(
                !f.login
                    .list()
                    .unwrap()
                    .iter()
                    .find(|screen| screen.name == "side")
                    .unwrap()
                    .current
            );
            f.login.set("side").unwrap();
            assert_eq!(f.login.current().unwrap(), "side");
            assert!(
                f.login
                    .list()
                    .unwrap()
                    .iter()
                    .find(|screen| screen.name == "side")
                    .unwrap()
                    .current
            );
            assert!(f.login.install(&source, None, false).is_err());
            write(installed.join("obsolete.qml"), "old");
            write(source.join("Screen.qml"), "import QtQuick\nRectangle {}\n");
            f.login.install(&source, None, true).unwrap();
            assert!(!installed.join("obsolete.qml").exists());
            assert_eq!(
                fs::read(installed.join("Screen.qml")).unwrap(),
                fs::read(source.join("Screen.qml")).unwrap()
            );
            assert!(f.login.install(&source, Some("default"), true).is_err());
            assert!(f.login.install(&source, Some("../escape"), false).is_err());
            let before = fs::read(f.login.config_file()).unwrap();
            assert!(f.login.set("missing").is_err());
            assert_eq!(fs::read(f.login.config_file()).unwrap(), before);
            f.login.set("default").unwrap();
            fs::remove_dir_all(source).unwrap();
            assert!(installed.join("components/Details.qml").is_file());
        }
        "unsafe_screens" => {
            let source = f.screen("unsafe");
            let external = f.root.join("external.qml");
            write(&external, "outside");
            symlink(&external, source.join("escape.qml")).unwrap();
            assert!(f.login.install(&source, None, false).is_err());
            fs::remove_file(source.join("escape.qml")).unwrap();
            symlink(source.join("components"), source.join("linked-directory")).unwrap();
            assert!(f.login.install(&source, None, false).is_err());
            fs::remove_file(source.join("linked-directory")).unwrap();
            let fifo =
                std::ffi::CString::new(source.join("fifo").as_os_str().as_encoded_bytes()).unwrap();
            assert_eq!(unsafe { libc::mkfifo(fifo.as_ptr(), 0o600) }, 0);
            assert!(f.login.install(&source, None, false).is_err());
            fs::remove_file(source.join("fifo")).unwrap();
            symlink(
                source.join("components/Details.qml"),
                source.join("contained.qml"),
            )
            .unwrap();
            let installed = f.login.install(&source, None, false).unwrap();
            assert!(
                !fs::symlink_metadata(installed.join("contained.qml"))
                    .unwrap()
                    .is_symlink()
            );
            let invalid = f.root.join("missing-entry");
            fs::create_dir(&invalid).unwrap();
            assert!(f.login.install(&invalid, None, false).is_err());
        }
        "bundle" => {
            let screen = f.screen("side");
            f.login.install(&screen, None, false).unwrap();
            f.login.set("side").unwrap();
            let media = f.root.join("private/home wallpaper.png");
            write(&media, "explicit image source");
            fs::set_permissions(&media, fs::Permissions::from_mode(0o600)).unwrap();
            let theme = f
                .root
                .join("home/.local/share/luna-next/themes/custom/theme.conf");
            write(
                &theme,
                "colors { accent = \"#234567\" }\nfonts { ui = \"Theme UI\" }\nappearance { rounding = 9 }\n",
            );
            write(
                f.root.join("home/.config/luna-next/theme.conf"),
                "theme { name = custom }\n",
            );
            f.login.update_config(json!({"wallpaper":{"source":media,"type":"image","fit":"tile"},"colors":{"accent":"#abcdef"},"fonts":{"mono":"Login Mono"},"extra":{"private":f.root}})).unwrap();
            let output = f.root.join("output/theme");
            write(output.join("obsolete.qml"), "old");
            f.login.build(&output).unwrap();
            let settings = f.settings(&output);
            assert_eq!(settings["screen"]["name"], "side");
            assert_eq!(settings["wallpaper"]["source"], "assets/wallpaper.png");
            assert_eq!(settings["colors"]["accent"], "#abcdef");
            assert_eq!(settings["fonts"]["ui"], "Theme UI");
            assert_eq!(settings["fonts"]["mono"], "Login Mono");
            assert_eq!(settings["appearance"]["rounding"], 9);
            assert!(!settings.to_string().contains(f.root.to_str().unwrap()));
            assert!(settings.get("font_files").is_none());
            assert_eq!(
                fs::read(output.join("assets/wallpaper.png")).unwrap(),
                fs::read(&media).unwrap()
            );
            assert_eq!(
                fs::metadata(output.join("assets/wallpaper.png"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o644
            );
            assert_eq!(
                fs::metadata(output.join("screen"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o777,
                0o755
            );
            assert!(!output.join("obsolete.qml").exists());
            fs::remove_dir_all(f.app).unwrap();
            fs::remove_dir_all(f.login.directory()).unwrap();
            fs::remove_dir_all(screen).unwrap();
            fs::remove_file(media).unwrap();
            assert!(output.join("Main.qml").is_file());
            assert!(output.join("screen/components/Details.qml").is_file());
            assert!(output.join("assets/wallpaper.png").is_file());
        }
        "auto" => {
            let output = f.root.join("output");
            for (name, bytes, kind) in [
                ("still.dat", b"GIF89a\x01\0\x01\0\0\0\0".as_slice(), "image"),
                (
                    "movie.dat",
                    b"\0\0\0\x18ftypmp42\0\0\0\0mp42isom".as_slice(),
                    "video",
                ),
            ] {
                let media = f.root.join(name);
                fs::write(&media, bytes).unwrap();
                f.login
                    .update_config(json!({"wallpaper":{"source":media,"type":"auto"}}))
                    .unwrap();
                f.login.build(&output).unwrap();
                assert_eq!(f.settings(&output)["wallpaper"]["type"], kind);
            }
            let before = fs::read(output.join("Settings.js")).unwrap();
            let text = f.root.join("text.txt");
            write(&text, "not supported media\n");
            f.login
                .update_config(json!({"wallpaper":{"source":text}}))
                .unwrap();
            assert!(f.login.build(&output).is_err());
            assert_eq!(fs::read(output.join("Settings.js")).unwrap(), before);
            f.login
                .update_config(json!({"wallpaper":{"type":"video"}}))
                .unwrap();
            f.login.build(&output).unwrap();
            assert_eq!(f.settings(&output)["wallpaper"]["type"], "video");
        }
        "overlap" => {
            let media = f.root.join("assets/wallpaper.png");
            write(&media, "image");
            f.login
                .update_config(json!({"wallpaper":{"source":media,"type":"image"}}))
                .unwrap();
            let original = fs::read(f.login.config_file()).unwrap();
            let config = f.login.config_file().to_path_buf();
            for output in [
                f.root.clone(),
                f.app.clone(),
                f.app.join("inside/new"),
                f.login.directory().to_path_buf(),
                f.root.join("assets"),
                config,
            ] {
                assert!(
                    f.login.build(&output).is_err(),
                    "accepted {}",
                    output.display()
                );
                assert_eq!(fs::read(f.login.config_file()).unwrap(), original);
            }
            symlink(&f.app, f.root.join("alias")).unwrap();
            assert!(f.login.build(&f.root.join("alias/nested")).is_err());
            let external = f.root.join("external-output");
            write(external.join("keep"), "outside the export");
            let linked_output = f.root.join("linked-output");
            symlink(&external, &linked_output).unwrap();
            f.login.build(&linked_output).unwrap();
            assert!(!fs::symlink_metadata(&linked_output).unwrap().is_symlink());
            assert_eq!(
                fs::read_to_string(external.join("keep")).unwrap(),
                "outside the export"
            );
            let output = f.root.join("output");
            f.login.build(&output).unwrap();
            let before = fs::read(output.join("Settings.js")).unwrap();
            f.login
                .update_config(json!({"wallpaper":{"source":f.root.join("missing.png")}}))
                .unwrap();
            assert!(f.login.build(&output).is_err());
            assert_eq!(fs::read(output.join("Settings.js")).unwrap(), before);
        }
        "paths" => {
            std::env::set_current_dir(&f.root).unwrap();
            assert!(Paths::from_env().is_err());
            let repository = f.root.join("home/.local/src/luna-next");
            write(
                repository.join("installs/packages.conf"),
                "core = []\nmain = []\n",
            );
            write(
                repository.join("src/luna-login/src/greeter/Main.qml"),
                "managed greeter",
            );
            let paths = Paths::from_env().unwrap();
            assert_eq!(
                paths.config_file,
                f.root.join("home/.config/luna-next/login.conf")
            );
            assert_eq!(
                paths.screens_dir,
                f.root.join("home/.local/share/luna-next/login/screens")
            );
            assert_eq!(paths.app_dir, repository.join("src/luna-login/src"));
            let selected = f.root.join("selected-checkout");
            write(
                selected.join("installs/packages.conf"),
                "core = []\nmain = []\n",
            );
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", &selected) };
            assert_eq!(
                Paths::from_env().unwrap().app_dir,
                selected.join("src/luna-login/src")
            );
            unsafe { std::env::set_var("LUNA_NEXT_ROOT", f.root.join("missing-checkout")) };
            assert!(Paths::from_env().is_err());
            let installed = f.root.join("home/.local/share/luna-next/login/app");
            write(installed.join("greeter/Main.qml"), "installed");
            // This test runs in its own child process with no other test threads.
            unsafe {
                std::env::set_var("LUNA_LOGIN_CONFIG", "relative-login.conf");
            }
            let paths = Paths::from_env().unwrap();
            assert_eq!(paths.app_dir, installed);
            assert_eq!(paths.config_file, PathBuf::from("relative-login.conf"));
            let login = Login::from_env().unwrap();
            assert_eq!(
                login.config_file(),
                std::env::current_dir().unwrap().join("relative-login.conf")
            );
            assert!(
                Login::new(Paths {
                    config_file: PathBuf::new(),
                    screens_dir: f.root.join("screens"),
                    app_dir: f.app
                })
                .is_err()
            );
        }
        _ => panic!("unknown scenario {scenario}"),
    }
}
