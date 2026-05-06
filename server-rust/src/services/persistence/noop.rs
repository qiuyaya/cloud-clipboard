use super::{PersistedRoom, PersistenceCommand, PersistenceError, PersistenceServiceTrait};
use crate::models::Message;
use async_trait::async_trait;
use std::collections::HashMap;

/// No-op persistence service that discards all operations
pub struct NoOpPersistenceService;

impl NoOpPersistenceService {
    pub fn new() -> Self {
        Self
    }
}

impl Default for NoOpPersistenceService {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl PersistenceServiceTrait for NoOpPersistenceService {
    async fn initialize(&self) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn save_pinned_room(
        &self,
        _room: &PersistedRoom,
        _messages: &[Message],
    ) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn append_message(
        &self,
        _room_key: &str,
        _message: &Message,
    ) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn delete_message(
        &self,
        _room_key: &str,
        _message_id: &str,
    ) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn load_pinned_rooms(
        &self,
    ) -> Result<HashMap<String, (PersistedRoom, Vec<Message>)>, PersistenceError> {
        Ok(HashMap::new())
    }

    async fn remove_pinned_room(&self, _room_key: &str) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn update_room_password(
        &self,
        _room_key: &str,
        _password_hash: Option<String>,
        _password: Option<String>,
    ) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn start_writer(&self) -> Result<(), PersistenceError> {
        Ok(())
    }

    async fn shutdown(&self) -> Result<(), PersistenceError> {
        Ok(())
    }

    fn send_command(&self, _command: PersistenceCommand) -> Result<(), PersistenceError> {
        Ok(())
    }
}
