//! DAW Buddy's Rust back end (proposal 0007).
//!
//! The renderer is unchanged: it calls `window.api.someMethod(...)`. Under
//! Tauri, `src/renderer/tauri-bridge.ts` turns every such call into one
//! command, `api(method, args)`, answered here. Methods not yet ported say so
//! plainly instead of returning something that looks right but isn't.

mod paths;
mod records;
mod settings;

use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

pub struct AppState {
    settings: Mutex<settings::Settings>,
    records: Mutex<records::Records>,
    /// Folders the person picked in a dialog this session — approved like roots.
    picked: Mutex<Vec<PathBuf>>,
}

fn arg_str(args: &[Value], i: usize) -> Result<String, String> {
    args.get(i).and_then(|v| v.as_str()).map(str::to_string).ok_or_else(|| format!("Argument {} must be a string.", i + 1))
}

fn file_manager() -> &'static str {
    if cfg!(target_os = "macos") {
        "Finder"
    } else if cfg!(target_os = "linux") {
        "File Manager"
    } else {
        "File Explorer"
    }
}

fn platform() -> &'static str {
    // Same names as Node's process.platform, which the renderer expects.
    if cfg!(target_os = "macos") {
        "darwin"
    } else if cfg!(target_os = "windows") {
        "win32"
    } else {
        "linux"
    }
}

fn full_settings(app: &AppHandle, s: &settings::Settings) -> Value {
    let mut v = s.get();
    if let Some(obj) = v.as_object_mut() {
        obj.insert("dataDir".into(), json!(paths::data_dir().to_string_lossy()));
        obj.insert("appVersion".into(), json!(app.package_info().version.to_string()));
        obj.insert("platform".into(), json!(platform()));
        obj.insert("isMac".into(), json!(cfg!(target_os = "macos")));
        obj.insert("fileManager".into(), json!(file_manager()));
        obj.insert("shell".into(), json!("tauri"));
    }
    v
}

/// The same rule as guardApproved() in main.ts: inside a project root, or
/// inside a folder picked in a dialog this session.
fn guard_approved(state: &State<AppState>, target: &str) -> Result<(), String> {
    let target = Path::new(target);
    let roots = state.settings.lock().unwrap().roots();
    let picked = state.picked.lock().unwrap().clone();
    if roots.iter().chain(picked.iter()).any(|base| paths::is_inside(target, base)) {
        Ok(())
    } else {
        Err("That path is outside your approved folders.".into())
    }
}

/// Roots plus the walk options, read from settings.json like main.ts does.
fn scan_settings(state: &State<AppState>) -> (Vec<PathBuf>, catalogue::Options) {
    let s = state.settings.lock().unwrap();
    let v = s.get();
    let options = catalogue::Options {
        ignore: v["ignore"].as_array().map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()).unwrap_or_default(),
        follow_links: v["followLinks"].as_bool().unwrap_or(false),
    };
    (s.roots(), options)
}

async fn pick(app: &AppHandle, folder: bool, title: &str, filters: &[(&str, &[&str])]) -> Option<PathBuf> {
    let mut dialog = app.dialog().file().set_title(title);
    for (name, exts) in filters {
        dialog = dialog.add_filter(*name, exts);
    }
    let (tx, rx) = std::sync::mpsc::channel();
    let send = move |p: Option<tauri_plugin_dialog::FilePath>| {
        let _ = tx.send(p.and_then(|p| p.into_path().ok()));
    };
    if folder {
        dialog.pick_folder(send);
    } else {
        dialog.pick_file(send);
    }
    tauri::async_runtime::spawn_blocking(move || rx.recv().ok().flatten()).await.ok().flatten()
}

#[tauri::command]
async fn api(app: AppHandle, state: State<'_, AppState>, method: String, args: Vec<Value>) -> Result<Value, String> {
    match method.as_str() {
        /* -------------------------- app & settings ------------------------- */
        "getVersion" => Ok(json!(app.package_info().version.to_string())),
        "getSettings" => Ok(full_settings(&app, &state.settings.lock().unwrap())),
        "updateSettings" => {
            let patch = args.into_iter().next().unwrap_or(Value::Null);
            let mut s = state.settings.lock().unwrap();
            s.update_allowed(&patch);
            if let Some(on_top) = patch.get("alwaysOnTop").and_then(Value::as_bool) {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.set_always_on_top(on_top);
                }
            }
            Ok(full_settings(&app, &s))
        }
        "crashlogGetLatest" => Ok(Value::Null),

        /* ------------------------------ projects --------------------------- */
        "scan" => {
            let (roots, options) = scan_settings(&state);
            if roots.is_empty() {
                return Ok(json!({ "entries": [], "errors": [], "roots": [] }));
            }
            let roots2 = roots.clone();
            let result = tauri::async_runtime::spawn_blocking(move || catalogue::scan_roots(&roots2, &options))
                .await
                .map_err(|e| e.to_string())?;
            let grouped = catalogue::group_versions(&result.entries);
            let mut out = json!(result);
            out["grouped"] = Value::Array(grouped);
            out["roots"] = json!(roots.iter().map(|r| r.to_string_lossy()).collect::<Vec<_>>());
            Ok(out)
        }
        "browse" => {
            let target = args.first().and_then(Value::as_str).unwrap_or("").to_string();
            let (roots, options) = scan_settings(&state);
            let root = roots.iter().find(|r| !target.is_empty() && paths::is_inside(Path::new(&target), r)).cloned();
            let Some(root) = root else {
                return Ok(json!({ "entries": [], "errors": [{ "root": target, "message": "That folder is outside your list." }] }));
            };
            let dir = PathBuf::from(&target);
            let root2 = root.clone();
            let result = tauri::async_runtime::spawn_blocking(move || catalogue::scan_folder(&dir, &root2, &options))
                .await
                .map_err(|e| e.to_string())?;
            let grouped = catalogue::group_versions(&result.entries);
            let mut out = json!(result);
            out["grouped"] = Value::Array(grouped);
            out["root"] = json!(root.to_string_lossy());
            out["browsing"] = json!(target);
            Ok(out)
        }

        /* ------------------------------ records ---------------------------- */
        "getRecords" => Ok(state.records.lock().unwrap().all()),
        "setRecord" => {
            let key = arg_str(&args, 0)?;
            guard_approved(&state, &key)?;
            let patch = args.get(1).cloned().unwrap_or(Value::Null);
            Ok(state.records.lock().unwrap().set(&key, &patch))
        }

        /* ------------------------------- shell ----------------------------- */
        "pickFolder" => {
            let chosen = pick(&app, true, "Choose a folder", &[]).await;
            Ok(match chosen {
                Some(p) => {
                    state.picked.lock().unwrap().push(p.clone());
                    json!(p.to_string_lossy())
                }
                None => Value::Null,
            })
        }
        "reveal" => {
            let target = arg_str(&args, 0)?;
            app.opener().reveal_item_in_dir(&target).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }
        "open" => {
            let target = arg_str(&args, 0)?;
            // Electron's shell.openPath returns "" on success or an error text.
            Ok(match app.opener().open_path(&target, None::<&str>) {
                Ok(()) => json!(""),
                Err(e) => json!(e.to_string()),
            })
        }
        "openExternal" => {
            let url = arg_str(&args, 0)?;
            if !(url.starts_with("https://") || url.starts_with("http://") || url.starts_with("mailto:")) {
                return Err("Only web and mail links can be opened.".into());
            }
            app.opener().open_url(&url, None::<&str>).map_err(|e| e.to_string())?;
            Ok(Value::Null)
        }

        /* -------------------------- project converter ---------------------- */
        "projectConvertTargets" => Ok(json!(projectconvert::TARGETS)),
        "projectConvertSupports" => Ok(json!(projectconvert::supports(Path::new(&arg_str(&args, 0)?)))),
        "projectConvertPickFile" => {
            let chosen = pick(
                &app,
                false,
                "Choose a project to convert",
                &[("Projects (Ableton, DAWproject, REAPER)", &["als", "dawproject", "rpp"]), ("All files", &["*"])],
            )
            .await;
            Ok(match chosen {
                Some(p) => {
                    if let Some(dir) = p.parent() {
                        state.picked.lock().unwrap().push(dir.to_path_buf());
                    }
                    json!(p.to_string_lossy())
                }
                None => Value::Null,
            })
        }
        "projectConvertInspect" => {
            let file = arg_str(&args, 0)?;
            guard_approved(&state, &file)?;
            tauri::async_runtime::spawn_blocking(move || projectconvert::inspect(Path::new(&file)).map(|s| json!(s)))
                .await
                .map_err(|e| e.to_string())?
        }
        "projectConvertRun" => {
            let file = arg_str(&args, 0)?;
            let target = arg_str(&args, 1)?;
            guard_approved(&state, &file)?;
            let output_root = {
                let s = state.settings.lock().unwrap();
                paths::ensure_tool_output(&s, "Converted Projects")?
            };
            let app2 = app.clone();
            tauri::async_runtime::spawn_blocking(move || {
                projectconvert::convert(Path::new(&file), &target, &output_root, &mut |message| {
                    let _ = app2.emit("projectConvertProgress", json!({ "message": message }));
                })
                .map(|r| json!(r))
            })
            .await
            .map_err(|e| e.to_string())?
        }

        _ => Err(format!("NOT_PORTED: \"{method}\" isn't available in the Rust build yet (proposal 0007).")),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data = paths::data_dir();
            app.manage(AppState {
                settings: Mutex::new(settings::Settings::load(data.join("settings.json"))),
                records: Mutex::new(records::Records::load(data.join("notes.json"))),
                picked: Mutex::new(Vec::new()),
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![api])
        .run(tauri::generate_context!())
        .expect("error while running DAW Buddy");
}
