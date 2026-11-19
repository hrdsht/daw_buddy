//! `cargo run --example scan -- <options-json> <root>...` or
//! `cargo run --example scan -- <options-json> --folder <dir> <root>`
//! Prints { entries, grouped, errors, truncated, foldersRead } as JSON —
//! used by scripts/rust-parity.js. Options: {"ignore": [...], "followLinks": bool}.

use std::path::PathBuf;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let opts: serde_json::Value = serde_json::from_str(args.first().map(String::as_str).unwrap_or("{}")).expect("options JSON");
    let options = catalogue::Options {
        ignore: opts["ignore"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        follow_links: opts["followLinks"].as_bool().unwrap_or(false),
    };
    let result = if args.get(1).map(String::as_str) == Some("--folder") {
        catalogue::scan_folder(&PathBuf::from(&args[2]), &PathBuf::from(&args[3]), &options)
    } else {
        let roots: Vec<PathBuf> = args[1..].iter().map(PathBuf::from).collect();
        catalogue::scan_roots(&roots, &options)
    };
    let grouped = catalogue::group_versions(&result.entries);
    let mut out = serde_json::to_value(&result).unwrap();
    out["grouped"] = serde_json::Value::Array(grouped);
    println!("{}", serde_json::to_string(&out).unwrap());
}
