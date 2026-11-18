//! settings.json — same file, same shape and same allow-list as
//! src/main/lib/settings.ts and the settings:update handler in main.ts.
//! Unknown keys are kept, so the Electron build loses nothing.

use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn defaults() -> Value {
    json!({
        "roots": [],
        "alwaysOnTop": false,
        "listSort": { "by": "modified", "dir": -1 },
        "webhookUrl": "",
        "pollWatching": false,
        "followLinks": false,
        "outputFolder": null,
        "enableCrashLogs": true,
        "reducedAnimation": false,
        "animationScale": 1.0,
        "region": "indian",
        "scaleTraditions": ["all"],
        "regionSetupComplete": false,
        "lastSeenVersion": null,
        "ignore": ["Backup", "Samples", "Bounces", "Renders", "Freeze", "Recorded", "Ableton Project Info", "node_modules"]
    })
}

pub struct Settings {
    path: PathBuf,
    data: Map<String, Value>,
}

impl Settings {
    pub fn load(path: PathBuf) -> Self {
        let mut data = defaults().as_object().cloned().unwrap();
        let mut upgraded = false;
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(Value::Object(raw)) = serde_json::from_str::<Value>(&text) {
                for (k, v) in raw {
                    data.insert(k, v);
                }
                // Upgrade from the 0.1 single-folder format.
                if let Some(Value::String(old)) = data.remove("rootPath") {
                    let roots = data.entry("roots").or_insert_with(|| json!([]));
                    if let Some(arr) = roots.as_array_mut() {
                        if !arr.iter().any(|r| r.as_str() == Some(old.as_str())) {
                            arr.insert(0, json!(old));
                        }
                    }
                    upgraded = true;
                }
            }
        }
        if !data.get("roots").map(Value::is_array).unwrap_or(false) {
            data.insert("roots".into(), json!([]));
        }
        if !data.get("ignore").map(Value::is_array).unwrap_or(false) {
            data.insert("ignore".into(), defaults()["ignore"].clone());
        }
        data.remove("searchDepth");
        let s = Settings { path, data };
        if upgraded {
            s.save();
        }
        s
    }

    pub fn get(&self) -> Value {
        Value::Object(self.data.clone())
    }

    pub fn roots(&self) -> Vec<PathBuf> {
        self.data
            .get("roots")
            .and_then(Value::as_array)
            .map(|a| a.iter().filter_map(Value::as_str).map(PathBuf::from).collect())
            .unwrap_or_default()
    }

    pub fn output_folder(&self) -> Option<PathBuf> {
        self.data.get("outputFolder").and_then(Value::as_str).filter(|s| !s.is_empty()).map(PathBuf::from)
    }

    fn save(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&Value::Object(self.data.clone())) {
            if let Err(e) = std::fs::write(&self.path, text) {
                eprintln!("[settings] Could not save: {e}");
            }
        }
    }

    /// Apply only the fields the window may change, with the same type checks
    /// as main.ts.
    pub fn update_allowed(&mut self, patch: &Value) {
        let Some(p) = patch.as_object() else { return };
        let mut allowed = Map::new();
        for key in ["alwaysOnTop", "pollWatching", "followLinks", "regionSetupComplete", "enableCrashLogs", "reducedAnimation"] {
            if let Some(v) = p.get(key).filter(|v| v.is_boolean()) {
                allowed.insert(key.into(), v.clone());
            }
        }
        if let Some(Value::String(url)) = p.get("webhookUrl") {
            allowed.insert("webhookUrl".into(), json!(url.trim()));
        }
        for key in ["ignore", "scaleTraditions"] {
            if let Some(Value::Array(a)) = p.get(key) {
                allowed.insert(key.into(), Value::Array(a.iter().filter(|v| v.is_string()).cloned().collect()));
            }
        }
        if let Some(Value::Object(sort)) = p.get("listSort") {
            let by = sort.get("by").and_then(Value::as_str).filter(|s| !s.is_empty()).unwrap_or("modified");
            let dir = if sort.get("dir").and_then(Value::as_i64) == Some(1) { 1 } else { -1 };
            allowed.insert("listSort".into(), json!({ "by": by, "dir": dir }));
        }
        for key in ["region", "lastSeenVersion"] {
            if let Some(v) = p.get(key).filter(|v| v.is_string()) {
                allowed.insert(key.into(), v.clone());
            }
        }
        if let Some(v) = p.get("animationScale").and_then(Value::as_f64).filter(|v| v.is_finite()) {
            allowed.insert("animationScale".into(), json!(v));
        }
        match p.get("outputFolder") {
            Some(Value::Null) => {
                allowed.insert("outputFolder".into(), Value::Null);
            }
            Some(Value::String(folder)) => {
                let folder = PathBuf::from(folder);
                let abs = if folder.is_absolute() { folder } else { std::env::current_dir().unwrap_or_default().join(folder) };
                // Never scan our own output back in: add it to the skip list.
                if let Some(name) = abs.file_name().map(|n| n.to_string_lossy().to_string()) {
                    let current: Vec<String> = self
                        .data
                        .get("ignore")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
                        .unwrap_or_default();
                    if !current.iter().any(|n| n.eq_ignore_ascii_case(&name)) {
                        let mut next = current;
                        next.push(name);
                        allowed.insert("ignore".into(), json!(next));
                    }
                }
                allowed.insert("outputFolder".into(), json!(abs.to_string_lossy()));
            }
            _ => {}
        }
        for (k, v) in allowed {
            self.data.insert(k, v);
        }
        self.save();
    }
}
