use luna_next::menu::Menu;
use serde_json::Value;

use crate::args::MenuCommand;

pub(crate) fn run(
    command: Option<&MenuCommand>,
    json_output: bool,
) -> Result<Value, Box<dyn std::error::Error>> {
    let menu = Menu::from_env()?;
    let status = match command.unwrap_or(&MenuCommand::Show) {
        MenuCommand::Start => menu.start()?,
        MenuCommand::Stop => menu.stop()?,
        MenuCommand::Restart => menu.restart()?,
        MenuCommand::Status => menu.status()?,
        MenuCommand::Show => menu.show()?,
        MenuCommand::Hide => menu.hide()?,
        MenuCommand::Toggle => menu.toggle()?,
        MenuCommand::Serve => {
            if json_output {
                return Err("menu serve runs in the foreground and does not return JSON".into());
            }
            menu.serve()?;
            return Ok(Value::Null);
        }
    };
    Ok(serde_json::to_value(status)?)
}
