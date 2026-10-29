use luna_next::polkit::Polkit;
use serde_json::Value;

use crate::args::PolkitCommand;

pub(crate) fn run(
    command: &PolkitCommand,
    json_output: bool,
) -> Result<Value, Box<dyn std::error::Error>> {
    let polkit = Polkit::from_env()?;
    let status = match command {
        PolkitCommand::Start => polkit.start()?,
        PolkitCommand::Stop => polkit.stop()?,
        PolkitCommand::Restart => polkit.restart()?,
        PolkitCommand::Status => polkit.status()?,
        PolkitCommand::Serve => {
            if json_output {
                return Err("polkit serve runs in the foreground and does not return JSON".into());
            }
            polkit.serve()?;
            return Ok(Value::Null);
        }
    };
    Ok(serde_json::to_value(status)?)
}
