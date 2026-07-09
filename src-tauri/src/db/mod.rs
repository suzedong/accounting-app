pub mod connection;
mod schema;
pub mod records;
pub mod trips;
pub mod prompts;
pub mod learning;
pub mod chat_history;

pub use connection::Database;
pub use records::{RecordInput, RecordUpdateInput};
pub use trips::{TripInput, TripUpdateInput};
pub use chat_history::ChatMessageInput;
