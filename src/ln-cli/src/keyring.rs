use luna_next::{Result, keyring};
use serde_json::Value;

use crate::args::KeyringCommand;

pub(crate) fn run(command: &KeyringCommand) -> Result<Value> {
    match command {
        KeyringCommand::Setup => {
            keyring::setup()?;
            Ok("GNOME Keyring socket enabled.".into())
        }
    }
}
