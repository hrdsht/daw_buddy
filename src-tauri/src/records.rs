//! notes.json — per-project records (favourite, note, detected key…).
//! Same file and rules as src/main/lib/notes.ts.

use serde_json::{json, Map, Value};
use std::path::PathBuf;

fn empty() -> Map<String, Value> {
    json!({
        "note": "", "noteFile": null, "stemsPath": null, "key": null, "camelot": null,
        "keyConfidence": 0, "keyAlternate": null, "tonic": null, "scale": null, "modal": false,
        "scaleConfidence": 0, "detectedBpm": null, "detectedTimeSignature": null, "detectedTala": null,
        "chordProgression": null, "analysis": null, "analysedFrom": null, "favourite": false,
        "customColor": null, "tuningA4": 440, "ragas": null, "updatedAt": null
    })
    .as_object()
    .cloned()
    .unwrap()
}

/// Fields the window may set, as in the records:set handler.
const ALLOWED: [&str; 20] = [
    "key", "camelot", "keyConfidence", "keyAlternate", "detectedBpm", "detectedTimeSignature", "detectedTala",
    "chordProgression", "analysis", "analysedFrom", "favourite", "customColor", "tonic", "scale", "modal",
    "scaleConfidence", "tuningA4", "ragas", "stemsPath", "note",
];

fn truthy(v: Option<&Value>) -> bool {
    match v {
        None | Some(Value::Null) => false,
        Some(Value::Bool(b)) => *b,
        Some(Value::Number(n)) => n.as_f64().map(|f| f != 0.0 && !f.is_nan()).unwrap_or(false),
        Some(Value::String(s)) => !s.is_empty(),
        Some(_) => true,
    }
}

pub struct Records {
    path: PathBuf,
    data: Map<String, Value>,
}

impl Records {
    pub fn load(path: PathBuf) -> Self {
        let mut data = Map::new();
        let mut upgraded = false;
        if let Ok(text) = std::fs::read_to_string(&path) {
            if let Ok(Value::Object(raw)) = serde_json::from_str::<Value>(&text) {
                for (key, value) in raw {
                    let mut rec = empty();
                    match value {
                        Value::String(note) => {
                            rec.insert("note".into(), json!(note));
                            upgraded = true;
                        }
                        Value::Object(o) => rec.extend(o),
                        _ => {}
                    }
                    data.insert(key, Value::Object(rec));
                }
            }
        }
        let r = Records { path, data };
        if upgraded {
            r.save();
        }
        r
    }

    pub fn all(&self) -> Value {
        Value::Object(self.data.clone())
    }

    fn save(&self) {
        if let Some(dir) = self.path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Ok(text) = serde_json::to_string_pretty(&Value::Object(self.data.clone())) {
            if let Err(e) = std::fs::write(&self.path, text) {
                eprintln!("[notes] Could not save notes.json: {e}");
            }
        }
    }

    pub fn set(&mut self, key: &str, patch: &Value) -> Value {
        let mut next = empty();
        if let Some(Value::Object(existing)) = self.data.get(key) {
            next.extend(existing.clone());
        }
        if let Some(p) = patch.as_object() {
            for field in ALLOWED {
                if let Some(v) = p.get(field) {
                    next.insert(field.into(), v.clone());
                }
            }
        }
        next.insert("updatedAt".into(), json!(crate::records::iso_now()));
        let is_empty = ["note", "stemsPath", "key", "favourite", "customColor", "tonic", "analysis", "detectedBpm"]
            .iter()
            .all(|f| !truthy(next.get(*f)));
        if is_empty {
            self.data.remove(key);
        } else {
            self.data.insert(key.into(), Value::Object(next));
        }
        self.save();
        self.data.get(key).cloned().unwrap_or_else(|| Value::Object(empty()))
    }
}

/// UTC ISO-8601 with milliseconds, like Date.prototype.toISOString.
pub fn iso_now() -> String {
    let ms = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_millis() as i64;
    let (days, rem) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + if m <= 2 { 1 } else { 0 };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}.{:03}Z", rem / 3_600_000, (rem / 60_000) % 60, (rem / 1000) % 60, rem % 1000)
}
