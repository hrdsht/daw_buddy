//! DAW Buddy's project catalogue in Rust (proposal 0007, slice 2): walk the
//! project folders, read every session's tempo and time signature, count its
//! backups, renders and videos, and group versions for display.
//!
//! Twins of src/main/lib/{scanner,daw,versions}.ts — scripts/rust-parity.js
//! checks both produce the same result on the same folders.

pub mod daw;
pub mod scanner;
pub mod versions;

pub use scanner::{scan_folder, scan_roots, Entry, Options, ScanResult};
pub use versions::group_versions;
