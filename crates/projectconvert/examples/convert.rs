//! `cargo run --example convert -- <project> <target|inspect> [out-dir]`
//! Prints the result as JSON — used by scripts/rust-parity.js.

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 3 {
        eprintln!("usage: convert <project> <dawproject|reaper|universal|inspect> [out-dir]");
        std::process::exit(2);
    }
    let file = std::path::Path::new(&args[1]);
    let result = if args[2] == "inspect" {
        projectconvert::inspect(file).map(|s| serde_json::to_string_pretty(&s).unwrap())
    } else {
        let out = std::path::PathBuf::from(args.get(3).cloned().unwrap_or_else(|| ".".into()));
        projectconvert::convert(file, &args[2], &out, &mut |_| {}).map(|r| serde_json::to_string_pretty(&r).unwrap())
    };
    match result {
        Ok(json) => println!("{json}"),
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(1);
        }
    }
}
